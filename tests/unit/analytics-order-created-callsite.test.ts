import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  emitCanonicalOrderCreated,
  type CanonicalOrderCreatedDependencies,
  type CanonicalOrderCreatedEmissionResult,
  type CanonicalOrderCreatedEmitter,
  type CanonicalOrderCreatedFacts
} from "@/lib/analytics/order-created-callsite";
import type { CanonicalBackendRuntimeInput } from "@/lib/analytics/canonical-runtime";

const checkoutFlowId = "22222222-2222-4222-8222-222222222222";
const otherCheckoutFlowId = "33333333-3333-4333-8333-333333333333";
const occurredAt = new Date("2026-07-16T09:00:00.000Z");
const receivedAt = new Date("2026-07-16T09:00:01.000Z");
const expectedEventId = "02d76e90-89a2-59c9-b09a-3f7113d184f3";
const fixedEntityId = `aid1.${"A".repeat(43)}` as const;
const fixedEventId = "11111111-1111-5111-8111-111111111111";
const enabledEnvironment = Object.freeze({
  ANALYTICS_ENABLED: "true",
  ANALYTICS_ID_HMAC_KEY: "synthetic-order-created-key-material-32-bytes",
  ANALYTICS_ID_KEY_VERSION: "test-v1",
  NODE_ENV: "test"
});

function facts(
  examMode: CanonicalOrderCreatedFacts["examMode"] = "RIKZ_RUSSIAN_2026",
  flowId = checkoutFlowId
): CanonicalOrderCreatedFacts {
  return {
    checkoutFlowId: flowId,
    orderPublicId: "cm-order-public-0001",
    occurredAt,
    productId: "russian-2026",
    testId: "russian-training-1",
    examMode
  };
}

function captureRuntime(
  runtimeResult: Readonly<{ accepted: true; inserted: boolean }> | Readonly<{ accepted: false; inserted: false }> = {
    accepted: true,
    inserted: true
  },
  environment: Readonly<Record<string, string | undefined>> = enabledEnvironment
) {
  const calls: CanonicalBackendRuntimeInput<"order_created">[] = [];
  const dependencies: CanonicalOrderCreatedDependencies = {
    environment,
    receiverClock: () => receivedAt,
    canonicalRuntime: async (input) => {
      calls.push(input);
      return runtimeResult;
    }
  };
  return { calls, dependencies };
}

describe("canonical order_created callsite feature gate", () => {
  it("returns the exact disabled result without entity-ID or runtime work", async () => {
    let entityCalls = 0;
    let runtimeCalls = 0;
    const result = await emitCanonicalOrderCreated(facts(), {
      environment: { ANALYTICS_ENABLED: " FALSE " },
      entityId: (() => {
        entityCalls += 1;
        return fixedEntityId;
      }) as CanonicalOrderCreatedDependencies["entityId"],
      canonicalRuntime: async () => {
        runtimeCalls += 1;
        return { accepted: true, inserted: true };
      }
    });

    expect(result).toEqual({ enabled: false, accepted: false, inserted: false });
    expect(Object.keys(result)).toEqual(["enabled", "accepted", "inserted"]);
    expect(entityCalls).toBe(0);
    expect(runtimeCalls).toBe(0);
  });

  it.each([undefined, "", "yes", "1", " true-ish "])(
    "keeps analytics disabled for gate value %s",
    async (ANALYTICS_ENABLED) => {
      await expect(emitCanonicalOrderCreated(facts(), {
        environment: { ANALYTICS_ENABLED }
      })).resolves.toEqual({ enabled: false, accepted: false, inserted: false });
    }
  );
});

describe("canonical order_created producer composition", () => {
  it("produces the exact canonical event, transition, and receiver context", async () => {
    const names: string[] = [];
    const { calls, dependencies } = captureRuntime();
    const result = await emitCanonicalOrderCreated(facts(), {
      ...dependencies,
      entityId: (() => fixedEntityId) as CanonicalOrderCreatedDependencies["entityId"],
      deterministicEventId(name) {
        names.push(name);
        return fixedEventId;
      }
    });

    expect(result).toEqual({ enabled: true, accepted: true, inserted: true });
    expect(names).toEqual([`order_created:${checkoutFlowId}`]);
    expect(calls).toEqual([{
      transitionKey: `order_created:${checkoutFlowId}`,
      producerEvent: {
        event_id: fixedEventId,
        event_name: "order_created",
        event_version: 1,
        occurred_at: "2026-07-16T09:00:00.000Z",
        analytics_id_key_version: "test-v1",
        properties: {
          checkout_flow_id: checkoutFlowId,
          order_public_id_hash: fixedEntityId,
          product_id: "russian-2026",
          test_id: "russian-training-1",
          exam_mode: "rikz_russian_2026",
          order_status: "created",
          access_source: "paid"
        }
      },
      receiverContext: {
        environment: "test",
        receivedAt: "2026-07-16T09:00:01.000Z",
        trustedTrafficContext: { kind: "test_fixture", trafficClass: "synthetic" }
      }
    }]);
  });

  it("uses exactly seven properties without legacy amount or currency", async () => {
    const { calls, dependencies } = captureRuntime();
    await emitCanonicalOrderCreated(facts(), dependencies);
    const properties = calls[0]?.producerEvent.properties as Record<string, unknown>;

    expect(Object.keys(properties).sort()).toEqual([
      "access_source",
      "checkout_flow_id",
      "exam_mode",
      "order_public_id_hash",
      "order_status",
      "product_id",
      "test_id"
    ]);
    expect(properties).not.toHaveProperty("amount");
    expect(properties).not.toHaveProperty("currency");
    expect(properties).not.toHaveProperty("analytics_id_key_version");
  });

  it("creates the stable RFC 4122 UUIDv5 event ID and changes it for another flow", async () => {
    const first = captureRuntime();
    const retry = captureRuntime();
    const other = captureRuntime();
    await emitCanonicalOrderCreated(facts(), first.dependencies);
    await emitCanonicalOrderCreated(facts(), retry.dependencies);
    await emitCanonicalOrderCreated(facts("RIKZ_RUSSIAN_2026", otherCheckoutFlowId), other.dependencies);

    expect(first.calls[0]?.producerEvent.event_id).toBe(expectedEventId);
    expect(retry.calls[0]?.producerEvent.event_id).toBe(expectedEventId);
    expect(other.calls[0]?.producerEvent.event_id).toBe("6e90abfd-bfb5-5b58-8a18-131c55f022ce");
    expect(other.calls[0]?.producerEvent.event_id).not.toBe(expectedEventId);
    expect(first.calls[0]?.producerEvent.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it.each([
    ["GENERIC", "generic"],
    ["generic", "generic"],
    ["RIKZ_RUSSIAN_2026", "rikz_russian_2026"],
    ["rikz_russian_2026", "rikz_russian_2026"]
  ] as const)("normalizes exam mode %s", async (examMode, expected) => {
    const { calls, dependencies } = captureRuntime();
    await emitCanonicalOrderCreated(facts(examMode), dependencies);
    expect(calls[0]?.producerEvent.properties.exam_mode).toBe(expected);
  });

  it("creates a canonical aid1 entity ID with a single validated key", async () => {
    const { calls, dependencies } = captureRuntime();
    let keyRingSize = 0;
    let keyBytes = 0;
    await emitCanonicalOrderCreated(facts(), {
      ...dependencies,
      entityId(input) {
        keyRingSize = input.keys.size;
        keyBytes = input.keys.get(input.keyVersion)?.byteLength ?? 0;
        const value = [...input.keys.values()][0];
        expect(input).toMatchObject({
          entity: "order",
          publicId: "cm-order-public-0001",
          keyVersion: "test-v1"
        });
        expect(value).toBeDefined();
        return fixedEntityId;
      }
    });

    expect(keyRingSize).toBe(1);
    expect(keyBytes).toBeGreaterThanOrEqual(32);
    expect(calls[0]?.producerEvent.properties.order_public_id_hash).toMatch(/^aid1\.[A-Za-z0-9_-]{43}$/);
  });

  it.each([
    [
      "development without deployment labels",
      { NODE_ENV: "development" },
      "development",
      undefined
    ],
    [
      "test without deployment labels",
      { NODE_ENV: "test" },
      "test",
      { kind: "test_fixture", trafficClass: "synthetic" }
    ],
    [
      "test with a matching deployment label",
      { NODE_ENV: "test", APP_ENV: "test" },
      "test",
      { kind: "test_fixture", trafficClass: "synthetic" }
    ],
    [
      "staging from APP_ENV",
      { NODE_ENV: "production", APP_ENV: "staging" },
      "sandbox",
      undefined
    ],
    [
      "staging from VERCEL_ENV=preview",
      { NODE_ENV: "production", VERCEL_ENV: "preview" },
      "sandbox",
      undefined
    ],
    [
      "production with a matching deployment label",
      { NODE_ENV: "production", APP_ENV: "production" },
      "production",
      undefined
    ],
    [
      "production without deployment labels",
      { NODE_ENV: "production" },
      "production",
      undefined
    ]
  ] as const)("maps valid runtime environment: %s", async (_label, labels, expected, trusted) => {
    const environment: Readonly<Record<string, string | undefined>> = {
      ...enabledEnvironment,
      ...labels
    };
    const { calls, dependencies } = captureRuntime({ accepted: true, inserted: true }, environment);
    await emitCanonicalOrderCreated(facts(), dependencies);

    expect(calls[0]?.receiverContext.environment).toBe(expected);
    expect(calls[0]?.receiverContext.trustedTrafficContext).toEqual(trusted);
  });

  it("does not let the producer set receiver fields or client traffic input", async () => {
    const { calls, dependencies } = captureRuntime();
    await emitCanonicalOrderCreated(facts(), dependencies);
    const producer = calls[0]?.producerEvent as unknown as Record<string, unknown>;

    for (const field of [
      "received_at",
      "environment",
      "traffic_class",
      "traffic_class_assignment_source",
      "emitting_layer",
      "traffic_class_hint"
    ]) {
      expect(producer).not.toHaveProperty(field);
    }
  });
});

describe("canonical order_created fail-closed validation", () => {
  it.each([
    ["missing NODE_ENV", { NODE_ENV: undefined }],
    ["NODE_ENV=staging", { NODE_ENV: "staging" }],
    ["unknown NODE_ENV", { NODE_ENV: "unknown" }],
    ["test execution with staging deployment", { NODE_ENV: "test", APP_ENV: "staging" }],
    [
      "conflicting staging and production deployments",
      { NODE_ENV: "production", APP_ENV: "staging", VERCEL_ENV: "production" }
    ],
    ["unknown deployment label", { NODE_ENV: "production", DEPLOYMENT_ENV: "unknown" }]
  ] as const)("rejects invalid runtime environment safely: %s", async (_label, labels) => {
    let entityCalls = 0;
    let runtimeCalls = 0;
    const environment: Readonly<Record<string, string | undefined>> = {
      ...enabledEnvironment,
      ...labels
    };
    const resultPromise = emitCanonicalOrderCreated(facts(), {
      environment,
      entityId: (() => {
        entityCalls += 1;
        throw new Error("RAW_RUNTIME_ENVIRONMENT_MUST_NOT_ESCAPE");
      }) as CanonicalOrderCreatedDependencies["entityId"],
      canonicalRuntime: async () => {
        runtimeCalls += 1;
        throw new Error("RAW_RUNTIME_ENVIRONMENT_MUST_NOT_ESCAPE");
      }
    });

    await expect(resultPromise).resolves.toEqual({
      enabled: true,
      accepted: false,
      inserted: false
    });
    const result = await resultPromise;
    const serialized = JSON.stringify(result);
    const rawLabels = [
      environment.NODE_ENV,
      environment.APP_ENV,
      environment.DEPLOYMENT_ENV,
      environment.VERCEL_ENV
    ].filter((value): value is string => value !== undefined);

    expect(entityCalls).toBe(0);
    expect(runtimeCalls).toBe(0);
    expect(serialized).not.toContain("RAW_RUNTIME_ENVIRONMENT_MUST_NOT_ESCAPE");
    for (const rawLabel of rawLabels) {
      expect(serialized).not.toContain(rawLabel);
    }
  });

  it.each([
    ["invalid exam mode", { ...facts(), examMode: "training" }],
    ["invalid checkout flow", { ...facts(), checkoutFlowId: "not-a-uuid" }],
    ["invalid order public ID", { ...facts(), orderPublicId: "student@example.test" }],
    ["short order public ID", { ...facts(), orderPublicId: "short" }]
  ])("rejects %s safely before runtime", async (_label, value) => {
    const { calls, dependencies } = captureRuntime();
    const result = await emitCanonicalOrderCreated(
      value as unknown as CanonicalOrderCreatedFacts,
      dependencies
    );

    expect(result).toEqual({ enabled: true, accepted: false, inserted: false });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["missing key", undefined, "test-v1"],
    ["short key", "short", "test-v1"],
    ["oversized key", "x".repeat(129), "test-v1"],
    ["oversized UTF-8 key", "😀".repeat(33), "test-v1"],
    ["missing key version", enabledEnvironment.ANALYTICS_ID_HMAC_KEY, undefined],
    ["invalid key version", enabledEnvironment.ANALYTICS_ID_HMAC_KEY, "INVALID.VERSION"]
  ])("rejects %s without runtime disclosure", async (_label, key, version) => {
    const { calls, dependencies } = captureRuntime({ accepted: true, inserted: true }, {
      ANALYTICS_ENABLED: "true",
      ANALYTICS_ID_HMAC_KEY: key,
      ANALYTICS_ID_KEY_VERSION: version,
      NODE_ENV: "test"
    });
    const result = await emitCanonicalOrderCreated(facts(), dependencies);

    expect(result).toEqual({ enabled: true, accepted: false, inserted: false });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["email", "student@example.test"],
    ["email_hash", "a".repeat(64)],
    ["ip", "127.0.0.1"],
    ["user_agent", "Mozilla/5.0"],
    ["raw_url", "https://example.test/private"],
    ["query", "?token=private"],
    ["request_body", { private: true }],
    ["answer", "private answer"],
    ["question_text", "private question"],
    ["correct_answer", "private key"],
    ["accepted_answers", ["private"]],
    ["explanation", "private explanation"],
    ["raw_score", 42],
    ["primary_score", 42],
    ["scaled_score", 91],
    ["lookup", "private lookup"],
    ["provider_reference", "private provider ref"],
    ["token", "private token"],
    ["cookie", "private cookie"],
    ["signature", "private signature"],
    ["metadata", { arbitrary: "private" }]
  ])("rejects extra privacy fixture %s before runtime", async (key, value) => {
    const { calls, dependencies } = captureRuntime();
    const input = { ...facts(), [key]: value } as unknown as CanonicalOrderCreatedFacts;
    const result = await emitCanonicalOrderCreated(input, dependencies);

    expect(result).toEqual({ enabled: true, accepted: false, inserted: false });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(String(value));
  });
});

describe("canonical order_created runtime and isolation semantics", () => {
  it.each([
    [{ accepted: true, inserted: true } as const, { enabled: true, accepted: true, inserted: true }],
    [{ accepted: true, inserted: false } as const, { enabled: true, accepted: true, inserted: false }],
    [{ accepted: false, inserted: false } as const, { enabled: true, accepted: false, inserted: false }]
  ])("maps canonical runtime result %j", async (runtimeResult, expected) => {
    const { dependencies } = captureRuntime(runtimeResult);
    await expect(emitCanonicalOrderCreated(facts(), dependencies)).resolves.toEqual(expected);
  });

  it("suppresses a runtime throw without revealing error, event, transition, IDs, or fixture", async () => {
    const privateMessage = "private persistence error";
    const result = await emitCanonicalOrderCreated(facts(), {
      environment: enabledEnvironment,
      receiverClock: () => receivedAt,
      canonicalRuntime: async () => {
        throw new Error(privateMessage);
      }
    });
    const serialized = JSON.stringify(result);

    expect(result).toEqual({ enabled: true, accepted: false, inserted: false });
    expect(Object.keys(result)).toEqual(["enabled", "accepted", "inserted"]);
    expect(serialized).not.toContain(privateMessage);
    expect(serialized).not.toContain(checkoutFlowId);
    expect(serialized).not.toContain("order_created:");
    expect(serialized).not.toContain("cm-order-public-0001");
  });

  it("does not mutate frozen facts or nested Date", async () => {
    const input = Object.freeze({ ...facts(), occurredAt: Object.freeze(occurredAt) });
    const before = JSON.stringify(input);
    const { dependencies } = captureRuntime();

    await emitCanonicalOrderCreated(input, dependencies);

    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.occurredAt)).toBe(true);
  });

  it("imports only crypto, canonical analytics boundaries, and the runtime classifier", () => {
    const sourcePath = fileURLToPath(new URL(
      "../../src/lib/analytics/order-created-callsite.ts",
      import.meta.url
    ));
    const source = readFileSync(sourcePath, "utf8");
    const importSpecifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1]);

    expect(importSpecifiers).toEqual([
      "node:crypto",
      "@/lib/analytics/canonical-runtime",
      "@/lib/analytics/entity-id",
      "@/server/runtime-config/runtime-environment"
    ]);
    expect(source).not.toMatch(/analytics-service|analytics-id|\/schemas|@prisma|@\/server\/db|\bprisma\b/i);
    expect(source).not.toMatch(/\bRequest\b|cookies\(|headers\(|user-agent|x-forwarded-for/i);
  });

  it("exports the semantic emitter API", () => {
    expectTypeOf<CanonicalOrderCreatedFacts["examMode"]>().toEqualTypeOf<
      "GENERIC" | "RIKZ_RUSSIAN_2026" | "generic" | "rikz_russian_2026"
    >();
    expectTypeOf<CanonicalOrderCreatedEmitter>().returns.resolves.toEqualTypeOf<
      CanonicalOrderCreatedEmissionResult
    >();
    expectTypeOf(emitCanonicalOrderCreated).returns.resolves.toEqualTypeOf<
      CanonicalOrderCreatedEmissionResult
    >();
  });
});
