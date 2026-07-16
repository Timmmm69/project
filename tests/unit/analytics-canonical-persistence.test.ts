import { describe, expect, expectTypeOf, it } from "vitest";
import {
  persistCanonicalAnalyticsEvent,
  type CanonicalAnalyticsEventRow,
  type CanonicalAnalyticsEventStore,
  type CanonicalAnalyticsPersistenceInput,
  type CanonicalAnalyticsPersistenceResult
} from "@/lib/analytics/canonical-persistence";
import {
  AnalyticsContractError,
  type CanonicalAnalyticsEvent
} from "@/lib/analytics/event-contract";

const eventId = "11111111-1111-4111-8111-111111111111";
const anonymousSessionId = "22222222-2222-4222-8222-222222222222";
const checkoutFlowId = "33333333-3333-4333-8333-333333333333";
const occurredAt = "2026-07-15T12:00:00.000Z";
const receivedAt = "2026-07-15T12:00:01.000Z";
const entityId = `aid1.${"A".repeat(43)}`;
const secondEntityId = `aid1.${"B".repeat(43)}`;

const orderProperties = Object.freeze({
  checkout_flow_id: checkoutFlowId,
  order_public_id_hash: entityId,
  product_id: "russian-2026",
  test_id: "russian-training-1",
  exam_mode: "rikz_russian_2026" as const,
  order_status: "created" as const,
  access_source: "paid" as const
});

const catalogProperties = Object.freeze({
  anonymous_session_id: anonymousSessionId,
  surface: "catalog" as const,
  device_class: "desktop" as const,
  viewport_bucket: "gte_1024" as const,
  locale: "ru" as const
});

const resultReopenedProperties = Object.freeze({
  attempt_public_id_hash: entityId,
  access_public_id_hash: secondEntityId,
  exam_mode: "generic" as const,
  reopen_sequence_bucket: "second" as const,
  result_view_context: "completion" as const
});

function backendEvent(): CanonicalAnalyticsEvent<"order_created"> {
  return Object.freeze({
    event_id: eventId,
    event_name: "order_created",
    event_version: 1,
    occurred_at: occurredAt,
    received_at: receivedAt,
    environment: "test",
    traffic_class: "internal_qa",
    traffic_class_assignment_source: "trusted_server_session",
    emitting_layer: "backend",
    analytics_id_key_version: "v1",
    properties: orderProperties
  });
}

function frontendEvent(): CanonicalAnalyticsEvent<"catalog_viewed"> {
  return Object.freeze({
    event_id: eventId,
    event_name: "catalog_viewed",
    event_version: 1,
    occurred_at: occurredAt,
    received_at: receivedAt,
    environment: "sandbox",
    traffic_class: "external_user",
    traffic_class_assignment_source: "default_external_user",
    emitting_layer: "frontend",
    properties: catalogProperties
  });
}

function derivedEvent(): CanonicalAnalyticsEvent<"result_reopened"> {
  return Object.freeze({
    event_id: eventId,
    event_name: "result_reopened",
    event_version: 1,
    occurred_at: occurredAt,
    received_at: receivedAt,
    environment: "production",
    traffic_class: "external_user",
    traffic_class_assignment_source: "default_external_user",
    emitting_layer: "derived",
    analytics_id_key_version: "v1",
    properties: resultReopenedProperties
  });
}

function fakeStore(count = 1) {
  const calls: Array<{
    data: readonly CanonicalAnalyticsEventRow[];
    skipDuplicates: true;
  }> = [];
  const store: CanonicalAnalyticsEventStore = {
    async createMany(input) {
      calls.push(input);
      return { count };
    }
  };
  return { store, calls };
}

function invalidEvent(event: unknown) {
  return event as CanonicalAnalyticsEvent;
}

async function expectRejectedBeforeStore(event: unknown) {
  const { store, calls } = fakeStore();
  await expect(persistCanonicalAnalyticsEvent({
    transitionKey: "transition-safe-fixture",
    event: invalidEvent(event)
  }, store)).rejects.toBeInstanceOf(AnalyticsContractError);
  expect(calls).toHaveLength(0);
}

describe("canonical analytics persistence mapping", () => {
  it("maps a backend event exactly into one existing Prisma model row", async () => {
    const event = backendEvent();
    const { store, calls } = fakeStore();

    await expect(persistCanonicalAnalyticsEvent({
      transitionKey: "order-created:fixture",
      event
    }, store)).resolves.toEqual({ inserted: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: [{
        eventId,
        transitionKey: "order-created:fixture",
        eventName: "order_created",
        eventVersion: 1,
        occurredAt: new Date(occurredAt),
        receivedAt: new Date(receivedAt),
        environment: "test",
        trafficClass: "internal_qa",
        trafficClassAssignmentSource: "trusted_server_session",
        emittingLayer: "backend",
        analyticsIdKeyVersion: "v1",
        properties: orderProperties
      }],
      skipDuplicates: true
    });
    expect(calls[0]?.data).toHaveLength(1);
  });

  it("accepts a canonical frontend event without inventing a key version", async () => {
    const { store, calls } = fakeStore();

    await persistCanonicalAnalyticsEvent({
      transitionKey: "catalog-viewed:fixture",
      event: frontendEvent()
    }, store);

    expect(calls[0]?.data[0]).toMatchObject({
      eventName: "catalog_viewed",
      emittingLayer: "frontend",
      environment: "sandbox",
      properties: catalogProperties
    });
    expect(calls[0]?.data[0]).not.toHaveProperty("analyticsIdKeyVersion");
  });

  it("accepts a canonical derived event", async () => {
    const { store, calls } = fakeStore();

    await persistCanonicalAnalyticsEvent({
      transitionKey: "result-reopened:fixture",
      event: derivedEvent()
    }, store);

    expect(calls[0]?.data[0]).toMatchObject({
      eventName: "result_reopened",
      emittingLayer: "derived",
      analyticsIdKeyVersion: "v1",
      properties: resultReopenedProperties
    });
  });

  it.each([
    [1, true],
    [0, false]
  ] as const)("maps store count %i to inserted %s", async (count, inserted) => {
    const { store, calls } = fakeStore(count);

    await expect(persistCanonicalAnalyticsEvent({
      transitionKey: "dedupe:fixture",
      event: backendEvent()
    }, store)).resolves.toEqual({ inserted });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.skipDuplicates).toBe(true);
    expect(calls[0]?.data).toHaveLength(1);
  });

  it.each(["generic", "rikz_russian_2026"] as const)(
    "preserves supported exam mode %s",
    async (exam_mode) => {
      const event = Object.freeze({
        ...backendEvent(),
        properties: Object.freeze({ ...orderProperties, exam_mode })
      });
      const { store, calls } = fakeStore();

      await persistCanonicalAnalyticsEvent({ transitionKey: `exam-mode:${exam_mode}`, event }, store);

      expect(calls[0]?.data[0]?.properties).toMatchObject({ exam_mode });
    }
  );
});

describe("canonical analytics persistence validation", () => {
  it("rejects an unknown event before the store", async () => {
    await expectRejectedBeforeStore({ ...backendEvent(), event_name: "unknown_event" });
  });

  it("rejects invalid event properties before the store", async () => {
    await expectRejectedBeforeStore({
      ...backendEvent(),
      properties: { ...orderProperties, order_status: "paid" }
    });
  });

  it("rejects forbidden privacy data before the store", async () => {
    await expectRejectedBeforeStore({
      ...frontendEvent(),
      properties: { ...catalogProperties, student_email: "student@example.com" }
    });
  });

  it("rejects an invalid traffic assignment before the store", async () => {
    await expectRejectedBeforeStore({
      ...backendEvent(),
      traffic_class: "admin",
      traffic_class_assignment_source: "default_external_user"
    });
  });

  it("rejects a mismatched emitting layer before the store", async () => {
    await expectRejectedBeforeStore({ ...backendEvent(), emitting_layer: "frontend" });
  });

  it("rejects an entity analytics ID without its key version", async () => {
    const event = { ...backendEvent() } as Record<string, unknown>;
    delete event.analytics_id_key_version;
    await expectRejectedBeforeStore(event);
  });

  it("rejects a key version without an entity analytics ID", async () => {
    await expectRejectedBeforeStore({
      ...frontendEvent(),
      analytics_id_key_version: "v1"
    });
  });

  it("requires the complete receiver-owned canonical envelope", async () => {
    const event = { ...backendEvent() } as Record<string, unknown>;
    delete event.received_at;
    await expectRejectedBeforeStore(event);
  });
});

describe("canonical analytics persistence transition key", () => {
  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
    ["length 257", "x".repeat(257)],
    ["non-string", 42]
  ])("rejects %s input before the store", async (_label, transitionKey) => {
    const { store, calls } = fakeStore();

    await expect(persistCanonicalAnalyticsEvent({
      transitionKey,
      event: backendEvent()
    } as unknown as CanonicalAnalyticsPersistenceInput, store)).rejects.toBeInstanceOf(AnalyticsContractError);
    expect(calls).toHaveLength(0);
  });

  it.each(["x", "x".repeat(256)])("accepts valid boundary key %s", async (transitionKey) => {
    const { store, calls } = fakeStore();

    await persistCanonicalAnalyticsEvent({ transitionKey, event: backendEvent() }, store);

    expect(calls[0]?.data[0]?.transitionKey).toBe(transitionKey);
  });

  it("preserves a valid transition key without normalization", async () => {
    const transitionKey = "  valid-transition-key  ";
    const { store, calls } = fakeStore();

    await persistCanonicalAnalyticsEvent({ transitionKey, event: backendEvent() }, store);

    expect(calls[0]?.data[0]?.transitionKey).toBe(transitionKey);
  });
});

describe("canonical analytics persistence safety", () => {
  it("does not reflect sensitive fixtures or payload data in rejection errors", async () => {
    const email = "student@example.com";
    const token = "Bearer synthetic-secret-token";
    const url = "https://example.com/result?token=synthetic";
    const transitionKey = "sensitive-transition-key-fixture";
    const properties = {
      ...catalogProperties,
      student_email: email,
      auth_token: token,
      return_url: url
    };

    let rejection: unknown;
    try {
      await persistCanonicalAnalyticsEvent({
        transitionKey,
        event: invalidEvent({ ...frontendEvent(), properties })
      }, fakeStore().store);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(AnalyticsContractError);
    const message = String(rejection);
    expect(message).not.toContain(email);
    expect(message).not.toContain(token);
    expect(message).not.toContain(url);
    expect(message).not.toContain(transitionKey);
    expect(message).not.toContain(JSON.stringify(properties));
  });

  it("propagates store errors unchanged", async () => {
    const storeError = new Error("store unavailable");
    const store: CanonicalAnalyticsEventStore = {
      async createMany() {
        throw storeError;
      }
    };

    let rejection: unknown;
    try {
      await persistCanonicalAnalyticsEvent({
        transitionKey: "store-error:fixture",
        event: backendEvent()
      }, store);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBe(storeError);
  });

  it.each([-1, 2, 99])("fails closed for unexpected store count %i without payload reflection", async (count) => {
    const transitionKey = "unexpected-count-secret-transition";
    const event = backendEvent();

    let rejection: unknown;
    try {
      await persistCanonicalAnalyticsEvent({ transitionKey, event }, fakeStore(count).store);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    expect(String(rejection)).toBe("Error: ANALYTICS_PERSISTENCE_INVALID_STORE_COUNT");
    expect(String(rejection)).not.toContain(transitionKey);
    expect(String(rejection)).not.toContain(eventId);
    expect(String(rejection)).not.toContain(JSON.stringify(event.properties));
  });
});

describe("canonical analytics persistence immutability", () => {
  it("accepts frozen input and properties without mutation", async () => {
    const event = backendEvent();
    const input = Object.freeze({ transitionKey: "frozen:fixture", event });
    const inputBefore = { ...input, event: { ...event, properties: { ...event.properties } } };
    const { store } = fakeStore();

    await persistCanonicalAnalyticsEvent(input, store);

    expect(input).toEqual(inputBefore);
    expect(event.properties).toEqual(orderProperties);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.properties)).toBe(true);
  });

  it("does not mutate store input after handing it off", async () => {
    let captured: Parameters<CanonicalAnalyticsEventStore["createMany"]>[0] | undefined;
    const store: CanonicalAnalyticsEventStore = {
      async createMany(input) {
        captured = input;
        Object.freeze(input.data[0]);
        Object.freeze(input.data);
        Object.freeze(input);
        return { count: 1 };
      }
    };

    await persistCanonicalAnalyticsEvent({
      transitionKey: "frozen-store-input:fixture",
      event: backendEvent()
    }, store);

    expect(captured?.data).toHaveLength(1);
  });

  it("repeatedly maps the same event to equivalent deterministic row values", async () => {
    const event = backendEvent();
    const first = fakeStore();
    const second = fakeStore();

    await persistCanonicalAnalyticsEvent({ transitionKey: "repeat:fixture", event }, first.store);
    await persistCanonicalAnalyticsEvent({ transitionKey: "repeat:fixture", event }, second.store);

    expect(first.calls[0]).toEqual(second.calls[0]);
    expect(first.calls[0]?.data[0]).toMatchObject({
      eventId,
      occurredAt: new Date(occurredAt),
      receivedAt: new Date(receivedAt),
      environment: "test",
      trafficClass: "internal_qa"
    });
  });

  it("exports the required persistence API types", () => {
    expectTypeOf<CanonicalAnalyticsPersistenceInput>().toMatchTypeOf<Readonly<{
      transitionKey: string;
      event: CanonicalAnalyticsEvent;
    }>>();
    expectTypeOf<CanonicalAnalyticsPersistenceResult>().toEqualTypeOf<Readonly<{
      inserted: boolean;
    }>>();
    expectTypeOf(persistCanonicalAnalyticsEvent).returns.resolves.toEqualTypeOf<
      CanonicalAnalyticsPersistenceResult
    >();
  });
});
