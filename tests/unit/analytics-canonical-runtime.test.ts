import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  safelyWriteCanonicalBackendAnalyticsEvent,
  writeCanonicalBackendAnalyticsEvent,
  type CanonicalBackendRuntimeDependencies,
  type CanonicalBackendRuntimeInput,
  type CanonicalBackendRuntimeResult,
  type SafeCanonicalBackendRuntimeResult
} from "@/lib/analytics/canonical-runtime";
import { buildCanonicalBackendAnalyticsEvent } from "@/lib/analytics/canonical-writer";
import {
  AnalyticsContractError,
  type CanonicalAnalyticsEvent
} from "@/lib/analytics/event-contract";

const eventId = "11111111-1111-4111-8111-111111111111";
const checkoutFlowId = "22222222-2222-4222-8222-222222222222";
const occurredAt = "2026-07-16T09:00:00.000Z";
const receivedAt = "2026-07-16T09:00:01.000Z";
const entityId = `aid1.${"A".repeat(43)}`;
const transitionKey = "  order-created:canonical-runtime:fixture  ";

const orderProperties = Object.freeze({
  checkout_flow_id: checkoutFlowId,
  order_public_id_hash: entityId,
  product_id: "russian-2026",
  test_id: "russian-training-1",
  exam_mode: "rikz_russian_2026" as const,
  order_status: "created" as const,
  access_source: "paid" as const
});

const receiverContext = Object.freeze({
  environment: "test" as const,
  receivedAt
});

function producerEvent(examMode: "generic" | "rikz_russian_2026" = "rikz_russian_2026") {
  return {
    event_id: eventId,
    event_name: "order_created" as const,
    event_version: 1 as const,
    occurred_at: occurredAt,
    analytics_id_key_version: "v1",
    properties: { ...orderProperties, exam_mode: examMode }
  };
}

function runtimeInput(
  event = producerEvent(),
  context = receiverContext
): CanonicalBackendRuntimeInput<"order_created"> {
  return { transitionKey, producerEvent: event, receiverContext: context };
}

function canonicalEvent(
  event = producerEvent(),
  context = receiverContext
): CanonicalAnalyticsEvent {
  const result = buildCanonicalBackendAnalyticsEvent(event, context);
  if (!result.success) throw new Error("INVALID_TEST_FIXTURE");
  return result.data;
}

function persistenceStub(
  calls: CanonicalAnalyticsEvent[] = [],
  inserted = true
): CanonicalBackendRuntimeDependencies["persistCanonicalAnalyticsEvent"] {
  return async (input) => {
    calls.push(input.event);
    return { inserted };
  };
}

async function expectContractRejection(event: unknown) {
  let persistenceCalls = 0;
  const dependencies: CanonicalBackendRuntimeDependencies = {
    buildCanonicalBackendAnalyticsEvent,
    async persistCanonicalAnalyticsEvent() {
      persistenceCalls += 1;
      return { inserted: true };
    }
  };
  const input = {
    transitionKey,
    producerEvent: event,
    receiverContext
  } as unknown as CanonicalBackendRuntimeInput;

  const rejection = await writeCanonicalBackendAnalyticsEvent(input, dependencies)
    .catch((error: unknown) => error);

  expect(rejection).toBeInstanceOf(AnalyticsContractError);
  expect(persistenceCalls).toBe(0);
  return rejection as AnalyticsContractError;
}

describe("canonical backend analytics runtime composition", () => {
  it.each([true, false] as const)(
    "passes exact inputs through writer and persistence for inserted=%s",
    async (inserted) => {
      const event = producerEvent();
      const context = receiverContext;
      const built = canonicalEvent(event, context);
      const writerCalls: Array<readonly [unknown, typeof context]> = [];
      const persistenceCalls: Array<{ transitionKey: string; event: CanonicalAnalyticsEvent }> = [];
      const dependencies: CanonicalBackendRuntimeDependencies = {
        buildCanonicalBackendAnalyticsEvent(value, receiver) {
          writerCalls.push([value, receiver as typeof context]);
          return { success: true, data: built };
        },
        async persistCanonicalAnalyticsEvent(input) {
          persistenceCalls.push(input);
          return { inserted };
        }
      };

      await expect(writeCanonicalBackendAnalyticsEvent(
        { transitionKey, producerEvent: event, receiverContext: context },
        dependencies
      )).resolves.toEqual({ inserted });

      expect(writerCalls).toHaveLength(1);
      expect(writerCalls[0]?.[0]).toBe(event);
      expect(writerCalls[0]?.[1]).toBe(context);
      expect(persistenceCalls).toEqual([{ transitionKey, event: built }]);
      expect(persistenceCalls[0]?.transitionKey).toBe(transitionKey);
    }
  );

  it.each([
    [undefined, "external_user", "default_external_user"],
    [{ kind: "trusted_server_session", trafficClass: "internal_qa" } as const, "internal_qa", "trusted_server_session"],
    [{ kind: "trusted_server_session", trafficClass: "admin" } as const, "admin", "trusted_server_session"],
    [{ kind: "test_fixture", trafficClass: "synthetic" } as const, "synthetic", "test_fixture"],
    [{ kind: "signed_internal_context", trafficClass: "admin" } as const, "admin", "signed_internal_context"]
  ] as const)(
    "preserves receiver traffic authority for %s",
    async (trustedTrafficContext, expectedClass, expectedSource) => {
      const persisted: CanonicalAnalyticsEvent[] = [];
      const context = trustedTrafficContext
        ? Object.freeze({ ...receiverContext, trustedTrafficContext })
        : receiverContext;
      const dependencies: CanonicalBackendRuntimeDependencies = {
        buildCanonicalBackendAnalyticsEvent,
        persistCanonicalAnalyticsEvent: persistenceStub(persisted)
      };

      await writeCanonicalBackendAnalyticsEvent(runtimeInput(producerEvent(), context), dependencies);

      expect(persisted[0]).toMatchObject({
        traffic_class: expectedClass,
        traffic_class_assignment_source: expectedSource
      });
    }
  );

  it.each(["generic", "rikz_russian_2026"] as const)(
    "preserves the supported %s registry mode",
    async (examMode) => {
      const persisted: CanonicalAnalyticsEvent[] = [];
      await writeCanonicalBackendAnalyticsEvent(runtimeInput(producerEvent(examMode)), {
        buildCanonicalBackendAnalyticsEvent,
        persistCanonicalAnalyticsEvent: persistenceStub(persisted)
      });
      expect(persisted[0]?.properties).toMatchObject({ exam_mode: examMode });
    }
  );
});

describe("canonical backend analytics runtime validation", () => {
  it.each([
    ["unknown", { ...producerEvent(), event_name: "unknown_event" }],
    ["frontend", { ...producerEvent(), event_name: "catalog_viewed" }],
    ["derived", { ...producerEvent(), event_name: "result_reopened" }]
  ])("rejects a %s event name before persistence", async (_label, event) => {
    const error = await expectContractRejection(event);
    expect(error.detail).toEqual({
      code: "UNKNOWN_EVENT",
      category: "contract",
      path: "$.event_name"
    });
  });

  it("rejects receiver-owned field overrides before persistence", async () => {
    const error = await expectContractRejection({
      ...producerEvent(),
      received_at: "2020-01-01T00:00:00.000Z"
    });
    expect(error.detail.path).toBe("$.received_at");
  });

  it("rejects invalid properties before persistence", async () => {
    const error = await expectContractRejection({
      ...producerEvent(),
      properties: { ...orderProperties, order_status: "paid" }
    });
    expect(error.detail.path).toContain("$.properties");
  });

  it.each([
    ["email", { student_email: "student@example.test" }],
    ["answer", { selected_answer: "private answer" }],
    ["question", { question_text: "private question" }],
    ["answer key", { correct_answer: "private key" }],
    ["score", { raw_score: 42 }],
    ["lookup", { lookup_value: 91 }],
    ["raw URL", { raw_url: "https://example.test/callback?token=private" }],
    ["token", { token: "private-token-value" }],
    ["provider secret", { provider_secret: "provider-private-value" }]
  ])("rejects forbidden %s fixtures before persistence", async (_label, forbidden) => {
    const error = await expectContractRejection({
      ...producerEvent(),
      properties: { ...orderProperties, ...forbidden }
    });
    expect(error.detail.code).toBe("PRIVACY_REJECTED");
  });

  it.each([
    ["missing key version", (() => {
      const event = { ...producerEvent() } as Record<string, unknown>;
      delete event.analytics_id_key_version;
      return event;
    })()],
    ["malformed entity ID", {
      ...producerEvent(),
      properties: { ...orderProperties, order_public_id_hash: "plain-hex-id" }
    }]
  ])("rejects analytics key-version/entity-ID mismatch: %s", async (_label, event) => {
    const error = await expectContractRejection(event);
    expect(error.detail.code).toBe("INVALID_EVENT");
  });
});

describe("canonical backend analytics runtime error semantics", () => {
  it("propagates the persistence error unchanged and does not retry", async () => {
    const storeError = new Error("synthetic store unavailable");
    let writerCalls = 0;
    let persistenceCalls = 0;
    const dependencies: CanonicalBackendRuntimeDependencies = {
      buildCanonicalBackendAnalyticsEvent(value, context) {
        writerCalls += 1;
        return buildCanonicalBackendAnalyticsEvent(value, context);
      },
      async persistCanonicalAnalyticsEvent() {
        persistenceCalls += 1;
        throw storeError;
      }
    };

    const rejection = await writeCanonicalBackendAnalyticsEvent(runtimeInput(), dependencies)
      .catch((error: unknown) => error);

    expect(rejection).toBe(storeError);
    expect(writerCalls).toBe(1);
    expect(persistenceCalls).toBe(1);
  });

  it("safe wrapper suppresses contract errors with one writer call and no persistence", async () => {
    const sensitive = "student@example.test";
    const secretTransition = "secret-transition-key";
    let writerCalls = 0;
    let persistenceCalls = 0;
    const dependencies: CanonicalBackendRuntimeDependencies = {
      buildCanonicalBackendAnalyticsEvent(value, context) {
        writerCalls += 1;
        return buildCanonicalBackendAnalyticsEvent(value, context);
      },
      async persistCanonicalAnalyticsEvent() {
        persistenceCalls += 1;
        return { inserted: true };
      }
    };
    const input = {
      transitionKey: secretTransition,
      producerEvent: {
        ...producerEvent(),
        properties: { ...orderProperties, student_email: sensitive }
      },
      receiverContext
    } as unknown as CanonicalBackendRuntimeInput;

    const first = await safelyWriteCanonicalBackendAnalyticsEvent(input, dependencies);
    const second = await safelyWriteCanonicalBackendAnalyticsEvent(input, dependencies);

    expect(first).toEqual({ accepted: false, inserted: false });
    expect(Object.keys(first)).toEqual(["accepted", "inserted"]);
    expect(first).toBe(second);
    expect(JSON.stringify(first)).not.toContain(sensitive);
    expect(JSON.stringify(first)).not.toContain(secretTransition);
    expect(writerCalls).toBe(2);
    expect(persistenceCalls).toBe(0);
  });

  it("safe wrapper suppresses persistence errors without retry or disclosure", async () => {
    const sensitiveMessage = "private store error message";
    const secretTransition = "private-transition-key";
    let writerCalls = 0;
    let persistenceCalls = 0;
    const dependencies: CanonicalBackendRuntimeDependencies = {
      buildCanonicalBackendAnalyticsEvent(value, context) {
        writerCalls += 1;
        return buildCanonicalBackendAnalyticsEvent(value, context);
      },
      async persistCanonicalAnalyticsEvent() {
        persistenceCalls += 1;
        throw new Error(sensitiveMessage);
      }
    };

    const result = await safelyWriteCanonicalBackendAnalyticsEvent(
      { ...runtimeInput(), transitionKey: secretTransition },
      dependencies
    );

    expect(result).toEqual({ accepted: false, inserted: false });
    expect(JSON.stringify(result)).not.toContain(sensitiveMessage);
    expect(JSON.stringify(result)).not.toContain(secretTransition);
    expect(JSON.stringify(result)).not.toContain(eventId);
    expect(writerCalls).toBe(1);
    expect(persistenceCalls).toBe(1);
  });

  it.each([true, false])("safe wrapper returns the actual inserted=%s result", async (inserted) => {
    await expect(safelyWriteCanonicalBackendAnalyticsEvent(runtimeInput(), {
      buildCanonicalBackendAnalyticsEvent,
      persistCanonicalAnalyticsEvent: persistenceStub([], inserted)
    })).resolves.toEqual({ accepted: true, inserted });
  });
});

describe("canonical backend analytics runtime immutability and authority", () => {
  it("accepts frozen input and nested properties without mutation", async () => {
    const properties = Object.freeze({ ...orderProperties });
    const event = Object.freeze({ ...producerEvent(), properties });
    const trustedTrafficContext = Object.freeze({
      kind: "test_fixture" as const,
      trafficClass: "synthetic" as const
    });
    const context = Object.freeze({ ...receiverContext, trustedTrafficContext });
    const input = Object.freeze({ transitionKey, producerEvent: event, receiverContext: context });
    const before = JSON.stringify(input);

    await writeCanonicalBackendAnalyticsEvent(input, {
      buildCanonicalBackendAnalyticsEvent,
      persistCanonicalAnalyticsEvent: persistenceStub()
    });

    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(properties)).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("makes equivalent dependency calls for repeated identical inputs", async () => {
    const input = runtimeInput();
    const writerCalls: Array<readonly [unknown, unknown]> = [];
    const persistenceCalls: unknown[] = [];
    const dependencies: CanonicalBackendRuntimeDependencies = {
      buildCanonicalBackendAnalyticsEvent(value, context) {
        writerCalls.push([value, context]);
        return buildCanonicalBackendAnalyticsEvent(value, context);
      },
      async persistCanonicalAnalyticsEvent(value) {
        persistenceCalls.push(value);
        return { inserted: true };
      }
    };

    await writeCanonicalBackendAnalyticsEvent(input, dependencies);
    await writeCanonicalBackendAnalyticsEvent(input, dependencies);

    expect(writerCalls).toHaveLength(2);
    expect(writerCalls[0]?.[0]).toBe(input.producerEvent);
    expect(writerCalls[1]?.[0]).toBe(input.producerEvent);
    expect(writerCalls[0]?.[1]).toBe(input.receiverContext);
    expect(writerCalls[1]?.[1]).toBe(input.receiverContext);
    expect(persistenceCalls[0]).toEqual(persistenceCalls[1]);
  });

  it("contains no hidden generation, configuration, domain, or legacy runtime access", () => {
    const sourcePath = fileURLToPath(new URL(
      "../../src/lib/analytics/canonical-runtime.ts",
      import.meta.url
    ));
    const source = readFileSync(sourcePath, "utf8");
    const importSpecifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1]);

    expect(importSpecifiers).toEqual([
      "@/lib/analytics/canonical-persistence",
      "@/lib/analytics/canonical-writer",
      "@/lib/analytics/event-contract"
    ]);
    expect(source).not.toMatch(/analytics-service|analytics-id|schemas|assertNoForbiddenAnalyticsPayload/);
    expect(source).not.toMatch(/randomUUID|randomBytes|crypto|Date\.now|new Date|process\.env/);
    expect(source).not.toMatch(/createAnalyticsEntityId|@\/server\/db|\bprisma\b|cookies\(|headers\(/);
  });

  it("exports the semantic runtime API with event-name-to-properties typing", () => {
    expectTypeOf<CanonicalBackendRuntimeInput<"order_created">["producerEvent"]["event_name"]>()
      .toEqualTypeOf<"order_created">();
    expectTypeOf<CanonicalBackendRuntimeResult>().toEqualTypeOf<Readonly<{ inserted: boolean }>>();
    expectTypeOf<SafeCanonicalBackendRuntimeResult>().toEqualTypeOf<
      | Readonly<{ accepted: true; inserted: boolean }>
      | Readonly<{ accepted: false; inserted: false }>
    >();
    expectTypeOf(writeCanonicalBackendAnalyticsEvent).returns.resolves.toEqualTypeOf<
      CanonicalBackendRuntimeResult
    >();
  });
});
