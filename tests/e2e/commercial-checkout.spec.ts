import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { POST as webPayNotify } from "@/app/api/payments/webpay/notify/route";
import type { CanonicalOrderCreatedEmitter } from "@/lib/analytics/order-created-callsite";
import { createCommercialCheckoutFlow, createCommercialOrder, createCommercialPaymentSession, processCommercialProviderNotification, recordCommercialPaymentValidationFailure } from "@/lib/commercial/commercial-service";
import { LocalFakeCommercialProvider, WebPaySandboxProvider } from "@/lib/commercial/providers";
import { hashLookupToken } from "@/lib/commercial/security";
import { assertNoForbiddenAnalyticsPayload } from "@/lib/analytics/forbidden-payload";
import type { AnalyticsWriter } from "@/lib/analytics/analytics-service";
import { hashLookupToken, lookupTokenMatches } from "@/lib/commercial/security";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide PostgreSQL to run commercial checkout integration.");

const prisma = new PrismaClient();
const suffix = Date.now().toString();
const suiteStartedAt = new Date();
const productCode = `commercial-e2e-${suffix}`;
const email = `commercial-e2e-${suffix}@example.test`;
const webPayEmail = `commercial-webpay-e2e-${suffix}@example.test`;
const stateEmail = `commercial-state-${suffix}@example.test`;
const raceEmail = `commercial-race-${suffix}@example.test`;
const doublePaidEmail = `commercial-double-paid-${suffix}@example.test`;
const reusedKeyEmail = `commercial-reused-key-${suffix}@example.test`;
const conflictEmail = `commercial-conflict-${suffix}@example.test`;
const conflictHolderEmail = `commercial-conflict-holder-${suffix}@example.test`;
const analyticsDisabledEmail = `commercial-analytics-disabled-${suffix}@example.test`;
const validationEmail = `commercial-validation-${suffix}@example.test`;
const analyticsFailureEmail = `commercial-analytics-failure-${suffix}@example.test`;
const checkoutFailureEmail = `commercial-checkout-failure-${suffix}@example.test`;
const linkageEmail = `commercial-linkage-${suffix}@example.test`;
const linkageRaceEmail = `commercial-linkage-race-${suffix}@example.test`;
const linkageFailureEmail = `commercial-linkage-failure-${suffix}@example.test`;
const tokenConflictEmail = `commercial-token-conflict-${suffix}@example.test`;
const tokenIntegrityEmail = `commercial-token-integrity-${suffix}@example.test`;
let productId = "";
let testId = "";
let authenticTestSlug = "";

async function createCheckoutOrder(input: Omit<Parameters<typeof createCommercialOrder>[0], "checkoutFlowId">) {
  const flow = await createCommercialCheckoutFlow({ productCode: input.productCode });
  return createCommercialOrder({ ...input, checkoutFlowId: flow.id });
}

function orderCreatedEventId(checkoutFlowId: string) {
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

async function createPendingFixture(fixtureEmail: string, key: string) {
  const created = await createCheckoutOrder({
    productCode,
    email: fixtureEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `${key}-${suffix}`
  });
  const attempt = await prisma.commercialPaymentAttempt.create({
    data: {
      commercialOrderId: created.order.id,
      provider: "LOCAL_FAKE",
      merchantReference: `${key}-reference-${suffix}`,
      status: "PENDING",
      amountMinor: 1000,
      currency: "BYN",
      checkoutIdempotencyKey: `${key}-checkout-${suffix}`
    }
  });
  await prisma.commercialOrder.update({ where: { id: created.order.id }, data: { status: "PENDING" } });
  return { order: created.order, attempt };
}

async function fakeEvent(input: {
  merchantReference: string;
  status: "pending" | "paid" | "failed" | "cancelled" | "expired";
  eventKey: string;
  paymentId?: string;
  signature?: string;
  marker?: string;
}) {
  const raw = JSON.stringify({
    merchant_reference: input.merchantReference,
    payment_id: input.paymentId ?? input.eventKey,
    event_key: input.eventKey,
    status: input.status,
    amount_minor: "1000",
    currency: "BYN",
    signature: input.signature ?? "local-fake-valid",
    marker: input.marker
  });
  const provider = new LocalFakeCommercialProvider();
  const notification = await provider.verifyNotification(raw);
  return {
    raw,
    notification,
    process: () => processCommercialProviderNotification({ notification, rawBody: raw, provider: provider.provider })
  };
}

test.beforeAll(async () => {
  process.env.LEGAL_BUNDLE_VERSION = "e2e-v1";
  process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY = "synthetic-e2e-commercial-order-token-key-32-bytes";
  process.env.ANALYTICS_ENABLED = "true";
  process.env.ANALYTICS_ID_HMAC_KEY = "synthetic-e2e-analytics-key-at-least-32-characters";
  process.env.ANALYTICS_ID_KEY_VERSION = "e2e-v1";
  const testRecord = await prisma.test.findFirst({
    where: { examMode: "RIKZ_RUSSIAN_2026", status: "PUBLISHED", deletedAt: null },
    select: { id: true, slug: true }
  });
  if (!testRecord) throw new Error("A published authentic test is required for commercial e2e.");
  testId = testRecord.id;
  authenticTestSlug = testRecord.slug;
  const product = await prisma.commercialProduct.create({
    data: {
      code: productCode,
      testId: testRecord.id,
      name: "Commercial e2e fixture",
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

test.afterAll(async () => {
  const orders = await prisma.commercialOrder.findMany({ where: { commercialProductId: productId }, select: { id: true } });
  const attempts = await prisma.commercialPaymentAttempt.findMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } }, select: { id: true } });
  const accesses = await prisma.access.findMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } }, select: { id: true } });
  const completedAttempts = await prisma.attempt.findMany({ where: { accessId: { in: accesses.map((access) => access.id) } }, select: { id: true } });
  await prisma.analyticsEvent.deleteMany({ where: { occurredAt: { gte: suiteStartedAt }, environment: "test" } });
  await prisma.commercialPaymentEvent.deleteMany({ where: { commercialPaymentAttemptId: { in: attempts.map((attempt) => attempt.id) } } });
  await prisma.answer.deleteMany({ where: { attemptId: { in: completedAttempts.map((attempt) => attempt.id) } } });
  await prisma.attempt.deleteMany({ where: { id: { in: completedAttempts.map((attempt) => attempt.id) } } });
  await prisma.access.deleteMany({ where: { id: { in: accesses.map((access) => access.id) } } });
  await prisma.commercialPaymentAttempt.deleteMany({ where: { id: { in: attempts.map((attempt) => attempt.id) } } });
  await prisma.commercialOrder.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
  await prisma.commercialCheckoutFlow.deleteMany({ where: { commercialProductId: productId } });
  await prisma.commercialProduct.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [email, webPayEmail, stateEmail, raceEmail, doublePaidEmail, reusedKeyEmail, conflictEmail, conflictHolderEmail, analyticsDisabledEmail, validationEmail, analyticsFailureEmail, checkoutFailureEmail, linkageEmail, linkageRaceEmail, linkageFailureEmail, tokenConflictEmail, tokenIntegrityEmail]
      }
    }
  });
  await prisma.$disconnect();
  process.env.ANALYTICS_ENABLED = "false";
});

test("checkout flow links exactly one checkout_started to exactly one order_created", async () => {
  const flow = await createCommercialCheckoutFlow({ productCode });
  const input = {
    productCode,
    checkoutFlowId: flow.id,
    email: linkageEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `linkage-order-${suffix}`
  };
  const created = await createCommercialOrder(input);
  const hashAfterCreate = (await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).lookupTokenHash;
  const retried = await createCommercialOrder(input);
  const hashAfterRetry = (await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).lookupTokenHash;

  expect(retried.order.id).toBe(created.order.id);
  expect(retried.idempotent).toBe(true);
  expect(retried.lookupToken).toBe(created.lookupToken);
  expect(hashAfterRetry).toBe(hashAfterCreate);
  expect(hashAfterCreate).toBe(hashLookupToken(created.lookupToken));
  expect(lookupTokenMatches(retried.lookupToken, hashAfterRetry)).toBe(true);
  expect(JSON.stringify(created.order)).not.toContain(created.lookupToken);
  expect(await prisma.commercialOrder.count({ where: { checkoutFlowId: flow.id } })).toBe(1);
  const events = await prisma.analyticsEvent.findMany({
    where: { transitionKey: { in: [`commercial-checkout-started:${flow.id}`, `order_created:${flow.id}`] } },
    orderBy: { occurredAt: "asc" }
  });
  expect(events).toHaveLength(2);
  expect(events.map((event) => event.eventName)).toEqual(["checkout_started", "order_created"]);
  expect(events.map((event) => (event.properties as Record<string, unknown>).checkout_flow_id)).toEqual([flow.id, flow.id]);
  expect(JSON.stringify(events)).not.toContain(created.lookupToken);
  expect(JSON.stringify(await prisma.eventLog.findMany({ where: { entityId: created.order.id } }))).not.toContain(created.lookupToken);
  const orderEvent = events.find((event) => event.eventName === "order_created");
  expect(orderEvent).toMatchObject({
    eventId: orderCreatedEventId(flow.id),
    transitionKey: `order_created:${flow.id}`,
    eventVersion: 1,
    occurredAt: created.order.createdAt,
    environment: "development",
    trafficClass: "external_user",
    trafficClassAssignmentSource: "default_external_user",
    emittingLayer: "backend",
    analyticsIdKeyVersion: "e2e-v1"
  });
  expect(orderEvent?.properties).toEqual({
    checkout_flow_id: flow.id,
    order_public_id_hash: expect.stringMatching(/^aid1\.[A-Za-z0-9_-]{43}$/),
    product_id: productCode,
    test_id: authenticTestSlug,
    exam_mode: "rikz_russian_2026",
    order_status: "created",
    access_source: "paid"
  });
  expect(Object.keys(orderEvent?.properties as Record<string, unknown>).sort()).toEqual([
    "access_source", "checkout_flow_id", "exam_mode", "order_public_id_hash", "order_status", "product_id", "test_id"
  ]);
  expect(orderEvent?.properties).not.toHaveProperty("amount");
  expect(orderEvent?.properties).not.toHaveProperty("currency");
  const serializedOrderEvent = JSON.stringify(orderEvent);
  for (const forbidden of [linkageEmail, created.lookupToken, created.order.id, created.order.publicId, productId, testId, input.idempotencyKey]) {
    expect(serializedOrderEvent).not.toContain(forbidden);
  }
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `order_created:${flow.id}` } })).toBe(1);
});

test("lookup token conflicts do not rotate the stored authorization hash", async () => {
  const flow = await createCommercialCheckoutFlow({ productCode });
  const idempotencyKey = `token-conflict-${suffix}`;
  const created = await createCommercialOrder({
    productCode,
    checkoutFlowId: flow.id,
    email: tokenConflictEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey
  });
  const originalHash = (await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).lookupTokenHash;

  await expect(createCommercialOrder({
    productCode,
    checkoutFlowId: flow.id,
    email: `wrong-${tokenConflictEmail}`,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey
  })).rejects.toMatchObject({ code: "CHECKOUT_FLOW_CONFLICT" });
  await expect(createCommercialOrder({
    productCode,
    checkoutFlowId: flow.id,
    email: tokenConflictEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `${idempotencyKey}-different`
  })).rejects.toMatchObject({ code: "CHECKOUT_FLOW_CONFLICT" });
  const otherFlow = await createCommercialCheckoutFlow({ productCode });
  await expect(createCommercialOrder({
    productCode,
    checkoutFlowId: otherFlow.id,
    email: tokenConflictEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey
  })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });

  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).lookupTokenHash).toBe(originalHash);
  expect(lookupTokenMatches(created.lookupToken, originalHash)).toBe(true);
});

test("lookup token hash mismatch fails safely without automatic rotation", async () => {
  const flow = await createCommercialCheckoutFlow({ productCode });
  const input = {
    productCode,
    checkoutFlowId: flow.id,
    email: tokenIntegrityEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `token-integrity-${suffix}`
  };
  const created = await createCommercialOrder(input);
  const invalidHash = "f".repeat(64);
  await prisma.commercialOrder.update({
    where: { id: created.order.id },
    data: { lookupTokenHash: invalidHash }
  });
  await expect(createCommercialOrder(input)).rejects.toMatchObject({ code: "ORDER_TOKEN_INTEGRITY_ERROR" });
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).lookupTokenHash).toBe(invalidHash);
});

test("invalid, unknown, and incompatible checkout flows are rejected", async () => {
  await expect(createCommercialOrder({
    productCode,
    checkoutFlowId: "not-a-uuid",
    email: `invalid-${suffix}@example.test`,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `invalid-flow-${suffix}`
  })).rejects.toMatchObject({ code: "INVALID_CHECKOUT_FLOW" });
  await expect(createCommercialOrder({
    productCode,
    checkoutFlowId: randomUUID(),
    email: `unknown-${suffix}@example.test`,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `unknown-flow-${suffix}`
  })).rejects.toMatchObject({ code: "CHECKOUT_FLOW_NOT_FOUND" });

  const flow = await createCommercialCheckoutFlow({ productCode });
  const product = await prisma.commercialProduct.findUniqueOrThrow({ where: { code: productCode } });
  const other = await prisma.commercialProduct.create({
    data: {
      code: `commercial-other-${suffix}`,
      testId: product.testId,
      name: "Other checkout context",
      priceMinor: 1000,
      currency: "BYN",
      attemptLimit: 1,
      startWindowDays: 90,
      resultRetentionDays: 365,
      isActive: true
    }
  });
  try {
    await expect(createCommercialOrder({
      productCode: other.code,
      checkoutFlowId: flow.id,
      email: `context-${suffix}@example.test`,
      adultBuyerConfirmed: true,
      legalBundleVersion: "e2e-v1",
      idempotencyKey: `context-flow-${suffix}`
    })).rejects.toMatchObject({ code: "CHECKOUT_FLOW_CONTEXT_MISMATCH" });
  } finally {
    await prisma.commercialProduct.delete({ where: { id: other.id } });
  }
});

test("concurrent retries create one order and one order_created event", async () => {
  const flow = await createCommercialCheckoutFlow({ productCode });
  const input = {
    productCode,
    checkoutFlowId: flow.id,
    email: linkageRaceEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `linkage-race-${suffix}`
  };
  const results = await Promise.all([createCommercialOrder(input), createCommercialOrder(input)]);
  expect(results[0].order.id).toBe(results[1].order.id);
  expect(results[0].lookupToken).toBe(results[1].lookupToken);
  expect(await prisma.commercialOrder.count({ where: { checkoutFlowId: flow.id } })).toBe(1);
  const stored = await prisma.commercialOrder.findUniqueOrThrow({ where: { checkoutFlowId: flow.id } });
  expect(lookupTokenMatches(results[0].lookupToken, stored.lookupTokenHash)).toBe(true);
  expect(lookupTokenMatches(results[1].lookupToken, stored.lookupTokenHash)).toBe(true);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `order_created:${flow.id}` } })).toBe(1);
});

test("analytics failure does not roll back a checkout flow or create a second order", async () => {
  const failingEmitter: CanonicalOrderCreatedEmitter = async () => { throw new Error("synthetic analytics persistence failure"); };
  const flow = await createCommercialCheckoutFlow({ productCode });
  const input = {
    productCode,
    checkoutFlowId: flow.id,
    email: linkageFailureEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `linkage-failure-${suffix}`,
    orderCreatedAnalyticsEmitter: failingEmitter
  };
  const created = await createCommercialOrder(input);
  const originalHash = (await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).lookupTokenHash;
  const retried = await createCommercialOrder(input);
  expect(retried.order.id).toBe(created.order.id);
  expect(retried.lookupToken).toBe(created.lookupToken);
  expect(await prisma.commercialCheckoutFlow.count({ where: { id: flow.id } })).toBe(1);
  expect(await prisma.commercialOrder.count({ where: { checkoutFlowId: flow.id } })).toBe(1);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).lookupTokenHash).toBe(originalHash);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `order_created:${flow.id}` } })).toBe(0);
});

test("fake provider grants one access and replay is a no-op", async () => {
  const created = await createCheckoutOrder({
    productCode,
    email,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `order-${suffix}-idempotency`
  });
  expect(created.order.priceMinor).toBe(1000);
  expect(created.order).toMatchObject({
    attemptLimitSnapshot: 1,
    startWindowDaysSnapshot: 90,
    durationMinutesSnapshot: 120,
    resultRetentionDaysSnapshot: 365,
    examModeSnapshot: "RIKZ_RUSSIAN_2026",
    resultDisplayModeSnapshot: "PRIMARY_ONLY",
    offerVersion: "e2e-v1",
    privacyVersion: "e2e-v1",
    refundPolicyVersion: "e2e-v1",
    disclaimerVersion: "e2e-v1"
  });

  const provider = new LocalFakeCommercialProvider();
  const payment = await createCommercialPaymentSession({
    publicId: created.order.publicId,
    idempotencyKey: `payment-${suffix}-idempotency`,
    provider,
    appUrl: "http://localhost:3000"
  });
  expect(payment.amountMinor).toBe(1000);
  const sameActive = await createCommercialPaymentSession({
    publicId: created.order.publicId,
    idempotencyKey: `payment-${suffix}-another-key`,
    provider,
    appUrl: "http://localhost:3000"
  });
  expect(sameActive.id).toBe(payment.id);
  await expect(createCheckoutOrder({
    productCode,
    email,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `order-${suffix}-different-key`
  })).rejects.toMatchObject({
    code: "ORDER_ALREADY_PENDING",
    nextAction: "WAIT_FOR_PAYMENT",
    publicOrderReference: created.order.publicId
  });
  expect((await prisma.commercialOrder.findUniqueOrThrow({
    where: { id: created.order.id }
  })).lookupTokenHash).toBe(hashLookupToken(created.lookupToken));

  const raw = JSON.stringify({
    merchant_reference: payment.merchantReference,
    payment_id: `fake-${suffix}`,
    event_key: `event-${suffix}`,
    status: "paid",
    amount_minor: "1000",
    currency: "BYN",
    signature: "local-fake-valid"
  });
  const notification = await provider.verifyNotification(raw);
  const providerMismatch = await processCommercialProviderNotification({ notification, rawBody: raw, provider: "WEBPAY_SANDBOX" });
  expect(providerMismatch.rejected).toBe(true);
  const product = await prisma.commercialProduct.findUniqueOrThrow({
    where: { id: productId },
    select: { testId: true }
  });
  await prisma.commercialProduct.update({
    where: { id: productId },
    data: { attemptLimit: 3, startWindowDays: 5, resultRetentionDays: 5 }
  });
  await prisma.test.update({
    where: { id: product.testId },
    data: { durationMinutes: 30 }
  });

  let first: Awaited<ReturnType<typeof processCommercialProviderNotification>>;
  let replay: Awaited<ReturnType<typeof processCommercialProviderNotification>>;
  try {
    first = await processCommercialProviderNotification({ notification, rawBody: raw, provider: provider.provider });
    replay = await processCommercialProviderNotification({ notification, rawBody: raw, provider: provider.provider });

    const immutableAccess = await prisma.access.findUniqueOrThrow({
      where: { commercialOrderId: created.order.id }
    });
    const expectedStartDeadline = new Date(immutableAccess.grantedAt!);
    expectedStartDeadline.setUTCDate(expectedStartDeadline.getUTCDate() + 90);
    expect(immutableAccess).toMatchObject({ attemptsTotal: 1, attemptsAvailable: 1 });
    expect(immutableAccess.startDeadlineAt).toEqual(expectedStartDeadline);
  } finally {
    await prisma.commercialProduct.update({
      where: { id: productId },
      data: { attemptLimit: 1, startWindowDays: 90, resultRetentionDays: 365 }
    });
    await prisma.test.update({
      where: { id: product.testId },
      data: { durationMinutes: 120 }
    });
  }

  expect(first.grantedAccess).toBe(true);
  expect(replay.duplicate).toBe(true);
  expect(await prisma.access.count({ where: { commercialOrderId: created.order.id } })).toBe(1);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).status).toBe("PAID");
  const paidAnalytics = await prisma.analyticsEvent.findMany({
    where: { transitionKey: { in: [`commercial-payment-paid:${payment.id}`, `commercial-access-granted:${created.order.id}`] } }
  });
  expect(paidAnalytics).toHaveLength(2);
  expect(paidAnalytics.find((event) => event.eventName === "payment_confirmed")?.properties).toMatchObject({
    payment_provider: "fake", payment_environment: "test", verification_method: "fake_provider"
  });
  expect(paidAnalytics.every((event) => event.analyticsIdKeyVersion === "e2e-v1")).toBe(true);
  expect(paidAnalytics.every((event) => !("analytics_id_key_version" in (event.properties as Record<string, unknown>)))).toBe(true);
  expect(paidAnalytics.find((event) => event.eventName === "access_granted")?.properties).toMatchObject({
    access_source: "paid", grant_reason: "confirmed_payment"
  });
  expect(JSON.stringify(paidAnalytics)).not.toContain(email);

  const access = await prisma.access.findUniqueOrThrow({ where: { commercialOrderId: created.order.id } });
  await prisma.access.update({ where: { id: access.id }, data: { attemptsAvailable: 0 } });
  const resultFinishedAt = new Date();
  const resultStartedAt = new Date(resultFinishedAt.getTime() - 60_000);
  await prisma.attempt.create({
    data: {
      userId: access.userId,
      testId: access.testId,
      accessId: access.id,
      status: "COMPLETED",
      startedAt: resultStartedAt,
      finishedAt: resultFinishedAt,
      durationSeconds: 60,
      rawScore: 60,
      maxRawScore: 80,
      percent: 75,
      testSnapshot: {
        testId: access.testId,
        subject: "russian",
        mode: "ce_ct",
        examMode: "rikz_russian_2026",
        durationMinutes: 120,
        maxRawScore: 80,
        questions: Array.from({ length: 40 }, (_, index) => ({
          snapshotQuestionId: `result-question-${index + 1}`,
          orderIndex: index,
          questionType: index < 18 ? "multi_select_five" : "short_answer_token",
          points: 2
        }))
      }
    }
  });
  await expect(createCheckoutOrder({
    productCode,
    email,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `order-${suffix}-after-completion`
  })).rejects.toMatchObject({ code: "EXISTING_ACCESS", nextAction: "VIEW_RESULT" });
  expect(await prisma.commercialOrder.count({
    where: { commercialProductId: productId, emailNormalized: email }
  })).toBe(1);
});

test("forged WebPay callback cannot pay, while an exact status response grants one access", async () => {
  process.env.WEBPAY_SANDBOX_STORE_ID = "e2e-store";
  process.env.WEBPAY_SANDBOX_SECRET_KEY = "e2e-secret";
  process.env.WEBPAY_SANDBOX_CHECKOUT_URL = "https://checkout.example.test";
  process.env.WEBPAY_SANDBOX_STATUS_URL = "https://status.example.test/payment";

  const created = await createCheckoutOrder({
    productCode,
    email: webPayEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `webpay-order-${suffix}`
  });
  const provider = new WebPaySandboxProvider();
  const payment = await createCommercialPaymentSession({
    publicId: created.order.publicId,
    idempotencyKey: `webpay-payment-${suffix}`,
    provider,
    appUrl: "http://localhost:3000"
  });
  const checkoutFields = payment.providerFields as Record<string, string>;
  const forgedCallback = new URLSearchParams({
    wsb_seed: checkoutFields.wsb_seed,
    wsb_storeid: checkoutFields.wsb_storeid,
    wsb_order_num: checkoutFields.wsb_order_num,
    wsb_test: checkoutFields.wsb_test,
    wsb_currency_id: checkoutFields.wsb_currency_id,
    wsb_total: checkoutFields.wsb_total,
    wsb_signature: checkoutFields.wsb_signature,
    wsb_result_code: "1",
    wsb_transaction_id: `forged-${suffix}`
  }).toString();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new URLSearchParams({
    wsb_order_num: payment.merchantReference,
    wsb_status: "pending",
    wsb_total: "10.00",
    wsb_currency_id: "BYN"
  }).toString(), { status: 200 });
  try {
    await webPayNotify(new Request("http://localhost:3000/api/payments/webpay/notify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: forgedCallback
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).status).toBe("PENDING");
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  expect(await prisma.access.count({ where: { commercialOrderId: created.order.id } })).toBe(0);

  globalThis.fetch = async () => new Response(new URLSearchParams({
    wsb_order_num: payment.merchantReference,
    wsb_result_code: "1",
    wsb_transaction_id: `authoritative-${suffix}`,
    wsb_total: "10.00",
    wsb_currency_id: "BYN"
  }).toString(), { status: 200 });
  let authoritative;
  try {
    authoritative = await provider.fetchPaymentStatus({ merchantReference: payment.merchantReference, providerPaymentId: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const processed = await processCommercialProviderNotification({
    notification: authoritative,
    rawBody: JSON.stringify(authoritative.redactedPayload),
    provider: provider.provider
  });

  expect(processed).toMatchObject({ rejected: false, grantedAccess: true });
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).status).toBe("PAID");
  expect(await prisma.access.count({ where: { commercialOrderId: created.order.id } })).toBe(1);
  expect((await prisma.analyticsEvent.findUniqueOrThrow({ where: { transitionKey: `commercial-payment-paid:${payment.id}` } })).properties).toMatchObject({
    verification_method: "status_api", payment_provider: "webpay", payment_environment: "sandbox"
  });
});

test("a paid order is not downgraded by callbacks for another payment attempt", async () => {
  const fixture = await createPendingFixture(stateEmail, "state-primary");
  const secondAttempt = await prisma.commercialPaymentAttempt.create({
    data: {
      commercialOrderId: fixture.order.id,
      provider: "LOCAL_FAKE",
      merchantReference: `state-secondary-reference-${suffix}`,
      status: "FAILED",
      amountMinor: 1000,
      currency: "BYN",
      checkoutIdempotencyKey: `state-secondary-checkout-${suffix}`
    }
  });
  const paid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `state-paid-${suffix}`
  });
  expect(await paid.process()).toMatchObject({ rejected: false, grantedAccess: true });

  for (const status of ["failed", "cancelled", "expired", "pending"] as const) {
    const late = await fakeEvent({
      merchantReference: secondAttempt.merchantReference,
      status,
      eventKey: `state-${status}-${suffix}`
    });
    expect(await late.process()).toMatchObject({ rejected: true, grantedAccess: false });
  }

  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PAID");
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: secondAttempt.id } })).status).toBe("FAILED");
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
});

test("parallel paid and failed callbacks cannot downgrade an already paid attempt", async () => {
  const fixture = await createPendingFixture(raceEmail, "race");
  const initialPaid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `race-initial-paid-${suffix}`,
    paymentId: `race-payment-${suffix}`
  });
  await initialPaid.process();
  const paid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `race-parallel-paid-${suffix}`,
    paymentId: `race-payment-${suffix}`,
    marker: "parallel-paid"
  });
  const failed = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "failed",
    eventKey: `race-parallel-failed-${suffix}`,
    paymentId: `race-payment-${suffix}`,
    marker: "parallel-failed"
  });
  await Promise.all([paid.process(), failed.process()]);

  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PAID");
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: fixture.attempt.id } })).status).toBe("PAID");
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
});

test("parallel paid callbacks with different event keys grant one access", async () => {
  const fixture = await createPendingFixture(doublePaidEmail, "double-paid");
  const first = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `double-paid-first-${suffix}`,
    paymentId: `double-paid-payment-${suffix}`,
    marker: "first"
  });
  const second = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `double-paid-second-${suffix}`,
    paymentId: `double-paid-payment-${suffix}`,
    marker: "second"
  });
  const results = await Promise.all([first.process(), second.process()]);

  expect(results.every((result) => !result.rejected)).toBe(true);
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PAID");
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-payment-paid:${fixture.attempt.id}` } })).toBe(1);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-access-granted:${fixture.order.id}` } })).toBe(1);
});

test("analytics disabled preserves the paid access outcome without events", async () => {
  const fixture = await createPendingFixture(analyticsDisabledEmail, "analytics-disabled");
  const paid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `analytics-disabled-paid-${suffix}`
  });
  process.env.ANALYTICS_ENABLED = "false";
  try {
    expect(await paid.process()).toMatchObject({ rejected: false, grantedAccess: true });
  } finally {
    process.env.ANALYTICS_ENABLED = "true";
  }
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-payment-paid:${fixture.attempt.id}` } })).toBe(0);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-access-granted:${fixture.order.id}` } })).toBe(0);
});

test("exact duplicate retries recover paid analytics without changing the domain state", async () => {
  const fixture = await createPendingFixture(analyticsFailureEmail, "analytics-failure");
  const provider = new LocalFakeCommercialProvider();
  const failingWriter: AnalyticsWriter = async () => { throw new Error("synthetic analytics persistence failure"); };
  const paid = await fakeEvent({ merchantReference: fixture.attempt.merchantReference, status: "paid", eventKey: `analytics-exact-retry-${suffix}`, paymentId: `analytics-paid-id-${suffix}` });
  const originalKey = process.env.ANALYTICS_ID_HMAC_KEY;
  process.env.ANALYTICS_ID_HMAC_KEY = "short";
  try {
    expect(await paid.process()).toMatchObject({ rejected: false, grantedAccess: true });
  } finally {
    process.env.ANALYTICS_ID_HMAC_KEY = originalKey;
  }
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PAID");
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-payment-paid:${fixture.attempt.id}` } })).toBe(0);

  expect(await processCommercialProviderNotification({ notification: paid.notification, rawBody: paid.raw, provider: provider.provider, analyticsWriter: failingWriter })).toMatchObject({ duplicate: true, rejected: false });
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-payment-paid:${fixture.attempt.id}` } })).toBe(0);

  expect(await paid.process()).toMatchObject({ duplicate: true, rejected: false });
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-payment-paid:${fixture.attempt.id}` } })).toBe(1);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-access-granted:${fixture.order.id}` } })).toBe(1);
  for (let index = 0; index < 3; index += 1) expect(await paid.process()).toMatchObject({ duplicate: true, rejected: false });
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-payment-paid:${fixture.attempt.id}` } })).toBe(1);
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-access-granted:${fixture.order.id}` } })).toBe(1);

  expect(await processCommercialProviderNotification({
    notification: { ...paid.notification, signatureValid: false }, rawBody: paid.raw, provider: provider.provider
  })).toMatchObject({ duplicate: true, rejected: false });
  expect(await prisma.analyticsEvent.count({ where: { transitionKey: `commercial-payment-paid:${fixture.attempt.id}` } })).toBe(1);
});

test("checkout provider error retains domain failure when analytics writer fails", async () => {
  const created = await createCheckoutOrder({
    productCode, email: checkoutFailureEmail, adultBuyerConfirmed: true, legalBundleVersion: "e2e-v1", idempotencyKey: `checkout-failure-order-${suffix}`
  });
  const brokenProvider = {
    provider: "LOCAL_FAKE" as const,
    createCheckout: async () => { throw new Error("ORIGINAL_PROVIDER_ERROR"); },
    verifyNotification: async () => { throw new Error("unused"); },
    fetchPaymentStatus: async () => { throw new Error("unused"); }
  };
  const failingWriter: AnalyticsWriter = async () => { throw new Error("synthetic analytics persistence failure"); };
  await expect(createCommercialPaymentSession({
    publicId: created.order.publicId, idempotencyKey: `checkout-failure-${suffix}`, provider: brokenProvider, appUrl: "http://localhost:3000", analyticsWriter: failingWriter
  })).rejects.toThrow("ORIGINAL_PROVIDER_ERROR");
  const order = await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } });
  const attempt = await prisma.commercialPaymentAttempt.findFirstOrThrow({ where: { commercialOrderId: created.order.id } });
  expect(order.status).toBe("FAILED");
  expect(attempt.status).toBe("FAILED");
});

test("an invalid event does not reserve its provider event key", async () => {
  const fixture = await createPendingFixture(reusedKeyEmail, "reused-key");
  const eventKey = `reused-transaction-${suffix}`;
  const invalid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey,
    paymentId: eventKey,
    signature: "invalid"
  });
  expect(await invalid.process()).toMatchObject({ rejected: true });
  expect(await prisma.analyticsEvent.count({
    where: { eventName: "payment_validation_failed", occurredAt: { gte: suiteStartedAt } }
  })).toBeGreaterThan(0);
  const valid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey,
    paymentId: eventKey,
    marker: "corrected"
  });
  expect(await valid.process()).toMatchObject({ rejected: false, grantedAccess: true });
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
});

test("invalid amount, currency, reference, and unavailable status emit only safe validation events", async () => {
  const fixture = await createPendingFixture(validationEmail, "validation");
  const provider = new LocalFakeCommercialProvider();
  const cases = [
    { reason: "amount_mismatch", body: { merchant_reference: fixture.attempt.merchantReference, amount_minor: "999", currency: "BYN" } },
    { reason: "currency_mismatch", body: { merchant_reference: fixture.attempt.merchantReference, amount_minor: "1000", currency: "USD" } },
    { reason: "merchant_reference_mismatch", body: { merchant_reference: `unknown-${suffix}`, amount_minor: "1000", currency: "BYN" } }
  ] as const;
  for (const [index, item] of cases.entries()) {
    const raw = JSON.stringify({
      ...item.body,
      payment_id: `validation-payment-${index}-${suffix}`,
      event_key: `validation-event-${index}-${suffix}`,
      status: "paid",
      signature: "local-fake-valid"
    });
    const notification = await provider.verifyNotification(raw);
    expect(await processCommercialProviderNotification({ notification, rawBody: raw, provider: provider.provider }))
      .toMatchObject({ rejected: true, grantedAccess: false });
  }
  await recordCommercialPaymentValidationFailure({
    provider: provider.provider,
    reason: "status_verification_unavailable",
    merchantReference: fixture.attempt.merchantReference
  });
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PENDING");
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(0);
  const failures = await prisma.analyticsEvent.findMany({
    where: { eventName: "payment_validation_failed", occurredAt: { gte: suiteStartedAt } },
    select: { properties: true }
  });
  const reasons = failures.map((event) => (event.properties as Record<string, unknown>).validation_reason);
  for (const item of [...cases, { reason: "status_verification_unavailable" }]) expect(reasons).toContain(item.reason);
  failures.forEach((event) => expect(() => assertNoForbiddenAnalyticsPayload(event.properties)).not.toThrow());
});

test("a provider payment id P2002 is not reported as a duplicate payment event", async () => {
  const target = await createPendingFixture(conflictEmail, "conflict-target");
  const holder = await createPendingFixture(conflictHolderEmail, "conflict-holder");
  const providerPaymentId = `provider-payment-conflict-${suffix}`;
  await prisma.commercialPaymentAttempt.update({
    where: { id: holder.attempt.id },
    data: { providerPaymentId }
  });
  const conflicting = await fakeEvent({
    merchantReference: target.attempt.merchantReference,
    status: "paid",
    eventKey: `conflict-event-${suffix}`,
    paymentId: providerPaymentId
  });

  await expect(conflicting.process()).rejects.toMatchObject({ code: "P2002" });
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: target.order.id } })).status).toBe("PENDING");
  expect(await prisma.access.count({ where: { commercialOrderId: target.order.id } })).toBe(0);
});
