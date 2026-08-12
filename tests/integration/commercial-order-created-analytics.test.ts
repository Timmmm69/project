import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  emitCanonicalOrderCreated,
  type CanonicalOrderCreatedEmitter,
  type CanonicalOrderCreatedEmissionResult
} from "@/lib/analytics/order-created-callsite";
import {
  createCommercialCheckoutFlow,
  createCommercialOrder
} from "@/lib/commercial/commercial-service";
import { prisma } from "@/server/db/client";

const shouldRun = process.env.RUN_ANA_02A_ORDER_CREATED_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const productCode = `ana-02a-product-${suffix}`;
const testSlug = `ana-02a-test-${suffix}`;
const legalVersion = "ana-02a-v1";
const originalCommercialEnvironment = {
  LEGAL_BUNDLE_VERSION: process.env.LEGAL_BUNDLE_VERSION,
  COMMERCIAL_ORDER_TOKEN_HMAC_KEY: process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY
};
let testId = "";
let productId = "";

const propertyAllowlist = [
  "access_source",
  "checkout_flow_id",
  "exam_mode",
  "order_public_id_hash",
  "order_status",
  "product_id",
  "test_id"
];

function assertDedicatedLocalTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ANA_02A_INTEGRATION_DATABASE_URL_REQUIRED");

  const parsed = new URL(databaseUrl);
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("ANA_02A_INTEGRATION_REQUIRES_POSTGRESQL");
  }
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname)) {
    throw new Error("ANA_02A_INTEGRATION_REQUIRES_LOCAL_DATABASE");
  }

  const schema = parsed.searchParams.get("schema");
  if (!schema || !/^ana_02a_order_created_[a-z0-9_]+$/.test(schema)) {
    throw new Error("ANA_02A_INTEGRATION_REQUIRES_DEDICATED_SCHEMA");
  }
  if (/prod/i.test(`${parsed.pathname}:${schema}`)) {
    throw new Error("ANA_02A_INTEGRATION_REJECTS_PRODUCTION_DATABASE");
  }
}

function uuidV5ForCheckoutFlow(checkoutFlowId: string) {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(`order_created:${checkoutFlowId}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function orderInput(
  checkoutFlowId: string,
  label: string,
  orderCreatedAnalyticsEmitter?: CanonicalOrderCreatedEmitter
) {
  return {
    productCode,
    checkoutFlowId,
    email: `ana-02a-${label}-${suffix}@example.test`,
    adultBuyerConfirmed: true,
    legalBundleVersion: legalVersion,
    idempotencyKey: `ana-02a-${label}-${suffix}`,
    ...(orderCreatedAnalyticsEmitter ? { orderCreatedAnalyticsEmitter } : {})
  };
}

function capturingEmitter(results: CanonicalOrderCreatedEmissionResult[]): CanonicalOrderCreatedEmitter {
  return async (facts) => {
    const result = await emitCanonicalOrderCreated(facts);
    results.push(result);
    return result;
  };
}

const runtimeEnvironmentNames = [
  "NODE_ENV",
  "APP_ENV",
  "DEPLOYMENT_ENV",
  "VERCEL_ENV"
] as const;

async function withRuntimeEnvironment<T>(
  labels: Readonly<Partial<Record<(typeof runtimeEnvironmentNames)[number], string>>>,
  operation: () => Promise<T>
) {
  const mutableEnvironment = process.env as unknown as Record<string, string | undefined>;
  const original = new Map(runtimeEnvironmentNames.map((name) => [name, mutableEnvironment[name]]));
  for (const name of runtimeEnvironmentNames) {
    const value = labels[name];
    if (value === undefined) {
      delete mutableEnvironment[name];
    } else {
      mutableEnvironment[name] = value;
    }
  }

  try {
    return await operation();
  } finally {
    for (const name of runtimeEnvironmentNames) {
      const value = original.get(name);
      if (value === undefined) {
        delete mutableEnvironment[name];
      } else {
        mutableEnvironment[name] = value;
      }
    }
  }
}

async function canonicalRows(checkoutFlowId: string) {
  return prisma.analyticsEvent.findMany({
    where: {
      OR: [
        { eventId: uuidV5ForCheckoutFlow(checkoutFlowId) },
        { transitionKey: `order_created:${checkoutFlowId}` }
      ]
    }
  });
}

async function cleanSyntheticFixtures() {
  if (!productId) return;
  const flows = await prisma.commercialCheckoutFlow.findMany({
    where: { commercialProductId: productId },
    select: { id: true }
  });
  const flowIds = flows.map((flow) => flow.id);
  const orders = await prisma.commercialOrder.findMany({
    where: { commercialProductId: productId },
    select: { id: true }
  });
  const orderIds = orders.map((order) => order.id);
  const transitionKeys = flowIds.flatMap((flowId) => [
    `order_created:${flowId}`,
    `commercial-checkout-started:${flowId}`
  ]);

  if (transitionKeys.length > 0) {
    await prisma.analyticsEvent.deleteMany({ where: { transitionKey: { in: transitionKeys } } });
  }
  if (orderIds.length > 0) {
    await prisma.eventLog.deleteMany({ where: { entityId: { in: orderIds } } });
    await prisma.commercialOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (flowIds.length > 0) {
    await prisma.commercialCheckoutFlow.deleteMany({ where: { id: { in: flowIds } } });
  }
  await prisma.commercialProduct.deleteMany({ where: { id: productId } });
  if (testId) await prisma.test.deleteMany({ where: { id: testId } });
}

describeWithDatabase("ANA-02A commercial Order canonical analytics integration", () => {
  beforeAll(async () => {
    assertDedicatedLocalTestDatabase();
    process.env.LEGAL_BUNDLE_VERSION = legalVersion;
    process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY =
      "synthetic-ana-02a-order-token-key-at-least-32-bytes";

    const testRecord = await prisma.test.create({
      data: {
        title: "ANA-02A authentic test fixture",
        slug: testSlug,
        mode: "CE_CT",
        examMode: "RIKZ_RUSSIAN_2026",
        subjectCode: "russian",
        officialYear: 2026,
        price: 1000,
        currency: "BYN",
        durationMinutes: 120,
        status: "PUBLISHED",
        publishedAt: new Date()
      }
    });
    testId = testRecord.id;
    const product = await prisma.commercialProduct.create({
      data: {
        code: productCode,
        testId,
        name: "ANA-02A commercial product fixture",
        priceMinor: 1000,
        currency: "BYN",
        attemptLimit: 1,
        startWindowDays: 90,
        resultRetentionDays: 365,
        isActive: true
      }
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (shouldRun) await cleanSyntheticFixtures();
    if (originalCommercialEnvironment.LEGAL_BUNDLE_VERSION === undefined) {
      delete process.env.LEGAL_BUNDLE_VERSION;
    } else {
      process.env.LEGAL_BUNDLE_VERSION = originalCommercialEnvironment.LEGAL_BUNDLE_VERSION;
    }
    if (originalCommercialEnvironment.COMMERCIAL_ORDER_TOKEN_HMAC_KEY === undefined) {
      delete process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY;
    } else {
      process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY =
        originalCommercialEnvironment.COMMERCIAL_ORDER_TOKEN_HMAC_KEY;
    }
    await prisma.$disconnect();
  });

  it("persists one exact canonical order_created row with physical privacy absence", async () => {
    const flow = await createCommercialCheckoutFlow({ productCode });
    const input = orderInput(flow.id, "normal");
    const created = await createCommercialOrder(input);
    const persistedOrder = await prisma.commercialOrder.findUniqueOrThrow({
      where: { id: created.order.id }
    });
    const rows = await canonicalRows(flow.id);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const properties = row.properties as Record<string, unknown>;
    expect(persistedOrder.checkoutFlowId).toBe(flow.id);
    expect(row).toMatchObject({
      eventId: uuidV5ForCheckoutFlow(flow.id),
      transitionKey: `order_created:${flow.id}`,
      eventName: "order_created",
      eventVersion: 1,
      occurredAt: persistedOrder.createdAt,
      environment: "test",
      trafficClass: "synthetic",
      trafficClassAssignmentSource: "test_fixture",
      emittingLayer: "backend",
      analyticsIdKeyVersion: process.env.ANALYTICS_ID_KEY_VERSION
    });
    expect(Object.keys(properties).sort()).toEqual(propertyAllowlist);
    expect(properties).toEqual({
      checkout_flow_id: flow.id,
      order_public_id_hash: expect.stringMatching(/^aid1\.[A-Za-z0-9_-]{43}$/),
      product_id: productCode,
      test_id: testSlug,
      exam_mode: "rikz_russian_2026",
      order_status: "created",
      access_source: "paid"
    });
    expect(properties).not.toHaveProperty("amount");
    expect(properties).not.toHaveProperty("currency");

    const serializedRow = JSON.stringify({
      eventId: row.eventId,
      transitionKey: row.transitionKey,
      eventName: row.eventName,
      eventVersion: row.eventVersion,
      occurredAt: row.occurredAt,
      receivedAt: row.receivedAt,
      environment: row.environment,
      trafficClass: row.trafficClass,
      trafficClassAssignmentSource: row.trafficClassAssignmentSource,
      emittingLayer: row.emittingLayer,
      analyticsIdKeyVersion: row.analyticsIdKeyVersion,
      properties: row.properties
    });
    for (const value of [
      input.email,
      input.email.trim().toLowerCase(),
      input.idempotencyKey,
      created.lookupToken,
      created.order.id,
      created.order.publicId,
      productId,
      testId
    ]) {
      expect(serializedRow).not.toContain(value);
    }
    for (const forbiddenKey of [
      "email",
      "emailNormalized",
      "email_hash",
      "ip",
      "x-forwarded-for",
      "user_agent",
      "raw_url",
      "query",
      "request_body",
      "Idempotency-Key",
      "lookup_token",
      "provider_reference",
      "answers",
      "question_text",
      "correct_answer",
      "accepted_answers",
      "explanation",
      "raw_score",
      "scaled_score",
      "lookup_data",
      "raw_error",
      "free_text"
    ]) {
      expect(serializedRow.toLowerCase()).not.toContain(forbiddenKey.toLowerCase());
    }
  });

  it("keeps Order creation successful while analytics is disabled", async () => {
    const originalGate = process.env.ANALYTICS_ENABLED;
    const flow = await createCommercialCheckoutFlow({ productCode });
    let created: Awaited<ReturnType<typeof createCommercialOrder>>;
    process.env.ANALYTICS_ENABLED = "false";
    try {
      created = await createCommercialOrder(orderInput(flow.id, "disabled"));
    } finally {
      if (originalGate === undefined) {
        delete process.env.ANALYTICS_ENABLED;
      } else {
        process.env.ANALYTICS_ENABLED = originalGate;
      }
    }

    expect(created.order.checkoutFlowId).toBe(flow.id);
    expect(await prisma.commercialOrder.count({ where: { id: created.order.id } })).toBe(1);
    expect(await canonicalRows(flow.id)).toHaveLength(0);
  });

  it("persists staging deployment analytics as one sandbox external-user row on retry", async () => {
    const flow = await createCommercialCheckoutFlow({ productCode });
    const emissions: CanonicalOrderCreatedEmissionResult[] = [];
    const input = orderInput(flow.id, "staging-sandbox", capturingEmitter(emissions));
    const { created, retried, rows } = await withRuntimeEnvironment(
      { NODE_ENV: "production", APP_ENV: "staging" },
      async () => {
        const created = await createCommercialOrder(input);
        const retried = await createCommercialOrder(input);
        return { created, retried, rows: await canonicalRows(flow.id) };
      }
    );

    expect(retried.order.id).toBe(created.order.id);
    expect(retried.order.checkoutFlowId).toBe(flow.id);
    expect(retried.idempotent).toBe(true);
    expect(emissions).toEqual([
      { enabled: true, accepted: true, inserted: true },
      { enabled: true, accepted: true, inserted: false }
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const properties = row.properties as Record<string, unknown>;
    expect(row).toMatchObject({
      eventId: uuidV5ForCheckoutFlow(flow.id),
      transitionKey: `order_created:${flow.id}`,
      eventName: "order_created",
      environment: "sandbox",
      trafficClass: "external_user",
      trafficClassAssignmentSource: "default_external_user"
    });
    expect(row.environment).not.toBe("production");
    expect(Object.keys(properties).sort()).toEqual(propertyAllowlist);
    expect(properties).toEqual({
      checkout_flow_id: flow.id,
      order_public_id_hash: expect.stringMatching(/^aid1\.[A-Za-z0-9_-]{43}$/),
      product_id: productCode,
      test_id: testSlug,
      exam_mode: "rikz_russian_2026",
      order_status: "created",
      access_source: "paid"
    });
  });

  it("re-emits an exact retry and reports the canonical duplicate path", async () => {
    const flow = await createCommercialCheckoutFlow({ productCode });
    const emissions: CanonicalOrderCreatedEmissionResult[] = [];
    const input = orderInput(flow.id, "retry", capturingEmitter(emissions));
    const created = await createCommercialOrder(input);
    const retried = await createCommercialOrder(input);

    expect(retried.order.id).toBe(created.order.id);
    expect(retried.lookupToken).toBe(created.lookupToken);
    expect(retried.idempotent).toBe(true);
    expect(emissions).toEqual([
      { enabled: true, accepted: true, inserted: true },
      { enabled: true, accepted: true, inserted: false }
    ]);
    expect(await canonicalRows(flow.id)).toHaveLength(1);
  });

  it("repairs an unknown post-commit analytics result on Order retry", async () => {
    const flow = await createCommercialCheckoutFlow({ productCode });
    const failingEmitter: CanonicalOrderCreatedEmitter = async () => {
      throw new Error("synthetic unknown analytics result");
    };
    const first = await createCommercialOrder(orderInput(flow.id, "repair", failingEmitter));
    expect(await canonicalRows(flow.id)).toHaveLength(0);

    const emissions: CanonicalOrderCreatedEmissionResult[] = [];
    const retried = await createCommercialOrder(
      orderInput(flow.id, "repair", capturingEmitter(emissions))
    );

    expect(retried.order.id).toBe(first.order.id);
    expect(retried.idempotent).toBe(true);
    expect(emissions).toEqual([{ enabled: true, accepted: true, inserted: true }]);
    expect(await canonicalRows(flow.id)).toHaveLength(1);
  });

  it("converges concurrent winner and recovered loser on one canonical row", async () => {
    const flow = await createCommercialCheckoutFlow({ productCode });
    const emissions: CanonicalOrderCreatedEmissionResult[] = [];
    const input = orderInput(flow.id, "concurrency", capturingEmitter(emissions));
    const results = await Promise.all([
      createCommercialOrder(input),
      createCommercialOrder(input)
    ]);

    expect(results[0].order.id).toBe(results[1].order.id);
    expect(results[0].lookupToken).toBe(results[1].lookupToken);
    expect(await prisma.commercialOrder.count({ where: { checkoutFlowId: flow.id } })).toBe(1);
    expect(await canonicalRows(flow.id)).toHaveLength(1);
    expect(emissions).toHaveLength(2);
    expect(emissions.map((result) => result.inserted).sort()).toEqual([false, true]);
  });

  it("keeps a committed Order when the canonical emitter rejects validation", async () => {
    let emitterCalls = 0;
    const rejectingEmitter: CanonicalOrderCreatedEmitter = async () => {
      emitterCalls += 1;
      return { enabled: true, accepted: false, inserted: false };
    };
    const flow = await createCommercialCheckoutFlow({ productCode });
    const created = await createCommercialOrder(
      orderInput(flow.id, "rejected", rejectingEmitter)
    );

    expect(emitterCalls).toBe(1);
    expect(await prisma.commercialOrder.count({ where: { id: created.order.id } })).toBe(1);
    expect(await canonicalRows(flow.id)).toHaveLength(0);
  });

  it("isolates emitter persistence failure and keeps retry idempotent", async () => {
    let emitterCalls = 0;
    const throwingEmitter: CanonicalOrderCreatedEmitter = async () => {
      emitterCalls += 1;
      throw new Error("synthetic canonical persistence failure");
    };
    const flow = await createCommercialCheckoutFlow({ productCode });
    const input = orderInput(flow.id, "persistence-failure", throwingEmitter);
    const created = await createCommercialOrder(input);
    const retried = await createCommercialOrder(input);

    expect(retried.order.id).toBe(created.order.id);
    expect(retried.idempotent).toBe(true);
    expect(emitterCalls).toBe(2);
    expect(await prisma.commercialOrder.count({ where: { checkoutFlowId: flow.id } })).toBe(1);
    expect(await canonicalRows(flow.id)).toHaveLength(0);
  });
});
