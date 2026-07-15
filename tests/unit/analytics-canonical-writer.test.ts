import { describe, expect, expectTypeOf, it } from "vitest";
import {
  buildCanonicalBackendAnalyticsEvent,
  buildCanonicalFrontendAnalyticsEvent,
  type AnalyticsReceiverContext,
  type BackendAnalyticsEventName,
  type TrustedBackendAnalyticsInput
} from "@/lib/analytics/canonical-writer";
import {
  analyticsEventNames,
  analyticsEventRegistry,
  backendAnalyticsEventNames,
  derivedAnalyticsEventNames,
  frontendAnalyticsEventNames,
  validateCanonicalAnalyticsEvent,
  type AnalyticsEventName,
  type CanonicalAnalyticsEvent,
  type FrontendAnalyticsInput
} from "@/lib/analytics/event-contract";

const eventId = "11111111-1111-4111-8111-111111111111";
const checkoutFlowId = "22222222-2222-4222-8222-222222222222";
const errorEventId = "33333333-3333-4333-8333-333333333333";
const occurredAt = "2026-07-15T12:00:00.000Z";
const receivedAt = "2026-07-15T12:00:01.000Z";
const entityId = `aid1.${"A".repeat(43)}`;

const catalogProperties = {
  anonymous_session_id: eventId,
  surface: "catalog",
  device_class: "desktop",
  viewport_bucket: "gte_1024",
  locale: "ru"
} as const;

const orderProperties = {
  checkout_flow_id: checkoutFlowId,
  order_public_id_hash: entityId,
  product_id: "russian-2026",
  test_id: "russian-training-1",
  exam_mode: "rikz_russian_2026",
  order_status: "created",
  access_source: "paid"
} as const;

const receiverContext: AnalyticsReceiverContext = {
  environment: "test",
  receivedAt
};

function catalogInput(): FrontendAnalyticsInput<"catalog_viewed"> {
  return {
    event_id: eventId,
    event_name: "catalog_viewed",
    event_version: 1,
    occurred_at: occurredAt,
    traffic_class_hint: "internal_qa",
    properties: catalogProperties
  };
}

function orderInput(): TrustedBackendAnalyticsInput<"order_created"> {
  return {
    event_id: eventId,
    event_name: "order_created",
    event_version: 1,
    occurred_at: occurredAt,
    analytics_id_key_version: "v1",
    properties: orderProperties
  };
}

function backendOperationInput(): TrustedBackendAnalyticsInput<"backend_operation_failed"> {
  return {
    event_id: eventId,
    event_name: "backend_operation_failed",
    event_version: 1,
    occurred_at: occurredAt,
    properties: {
      error_event_id: errorEventId,
      error_category: "payment_provider_error",
      failure_stage: "payment",
      error_code: "provider_unavailable",
      retryable: true,
      severity: "sev1"
    }
  };
}

const forbiddenProducerFields = [
  "received_at",
  "environment",
  "emitting_layer",
  "traffic_class",
  "traffic_class_assignment_source",
  "traffic_class_hint"
] as const;

describe("canonical analytics writer frontend boundary", () => {
  it("builds a canonical catalog_viewed event and preserves producer-owned fields", () => {
    const input = catalogInput();
    const result = buildCanonicalFrontendAnalyticsEvent(input, receiverContext);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      event_id: input.event_id,
      event_name: input.event_name,
      event_version: input.event_version,
      occurred_at: input.occurred_at,
      received_at: receivedAt,
      environment: "test",
      emitting_layer: "frontend",
      properties: input.properties
    });
    expect(result.data).not.toHaveProperty("traffic_class_hint");
  });

  it("does not elevate an internal_qa client hint without trusted context", () => {
    const result = buildCanonicalFrontendAnalyticsEvent(catalogInput(), receiverContext);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.traffic_class).toBe("external_user");
    expect(result.data.traffic_class_assignment_source).toBe("default_external_user");
  });

  it.each(["internal_qa", "admin"] as const)(
    "uses trusted server session class %s",
    (trafficClass) => {
      const result = buildCanonicalFrontendAnalyticsEvent(catalogInput(), {
        ...receiverContext,
        trustedTrafficContext: { kind: "trusted_server_session", trafficClass }
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.traffic_class).toBe(trafficClass);
      expect(result.data.traffic_class_assignment_source).toBe("trusted_server_session");
    }
  );

  it("uses a signed internal context for an allowed class", () => {
    const result = buildCanonicalFrontendAnalyticsEvent(catalogInput(), {
      ...receiverContext,
      trustedTrafficContext: { kind: "signed_internal_context", trafficClass: "synthetic" }
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.traffic_class).toBe("synthetic");
    expect(result.data.traffic_class_assignment_source).toBe("signed_internal_context");
  });

  it.each(forbiddenProducerFields.slice(0, 5))("rejects receiver-owned frontend field %s", (field) => {
    const result = buildCanonicalFrontendAnalyticsEvent(
      { ...catalogInput(), [field]: "untrusted" },
      receiverContext
    );
    expect(result.success).toBe(false);
  });

  it("rejects a backend event name", () => {
    const result = buildCanonicalFrontendAnalyticsEvent(
      { ...catalogInput(), event_name: "order_created" },
      receiverContext
    );
    expect(result).toEqual({
      success: false,
      error: { code: "UNKNOWN_EVENT", category: "contract", path: "$.event_name" }
    });
  });

  it("rejects a derived event name", () => {
    const result = buildCanonicalFrontendAnalyticsEvent(
      { ...catalogInput(), event_name: "result_reopened" },
      receiverContext
    );
    expect(result).toEqual({
      success: false,
      error: { code: "UNKNOWN_EVENT", category: "contract", path: "$.event_name" }
    });
  });

  it("rejects forbidden privacy data", () => {
    const rejectedIdentity = "student@example.com";
    const result = buildCanonicalFrontendAnalyticsEvent(
      { ...catalogInput(), properties: { ...catalogProperties, student_email: rejectedIdentity } },
      receiverContext
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("PRIVACY_REJECTED");
    expect(JSON.stringify(result)).not.toContain(rejectedIdentity);
  });

  it("rejects invalid event properties", () => {
    const result = buildCanonicalFrontendAnalyticsEvent(
      { ...catalogInput(), properties: { ...catalogProperties, surface: "made_up_value" } },
      receiverContext
    );
    expect(result.success).toBe(false);
  });

  it("rejects analytics_id_key_version without an entity analytics ID", () => {
    const result = buildCanonicalFrontendAnalyticsEvent(
      { ...catalogInput(), analytics_id_key_version: "v1" },
      receiverContext
    );
    expect(result.success).toBe(false);
  });

  it("returns output accepted by canonical validation", () => {
    const result = buildCanonicalFrontendAnalyticsEvent(catalogInput(), receiverContext);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(validateCanonicalAnalyticsEvent(result.data).success).toBe(true);
  });
});

describe("canonical analytics writer backend boundary", () => {
  it("builds a canonical order_created event with backend layer and default traffic", () => {
    const input = orderInput();
    const result = buildCanonicalBackendAnalyticsEvent(input, receiverContext);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      event_id: input.event_id,
      event_name: input.event_name,
      event_version: input.event_version,
      occurred_at: input.occurred_at,
      analytics_id_key_version: input.analytics_id_key_version,
      properties: input.properties,
      received_at: receivedAt,
      environment: "test",
      emitting_layer: "backend",
      traffic_class: "external_user",
      traffic_class_assignment_source: "default_external_user"
    });
  });

  it("uses a trusted admin server session", () => {
    const result = buildCanonicalBackendAnalyticsEvent(orderInput(), {
      ...receiverContext,
      trustedTrafficContext: { kind: "trusted_server_session", trafficClass: "admin" }
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.traffic_class).toBe("admin");
    expect(result.data.traffic_class_assignment_source).toBe("trusted_server_session");
  });

  it("uses a synthetic test fixture classification", () => {
    const result = buildCanonicalBackendAnalyticsEvent(orderInput(), {
      ...receiverContext,
      trustedTrafficContext: { kind: "test_fixture", trafficClass: "synthetic" }
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.traffic_class).toBe("synthetic");
    expect(result.data.traffic_class_assignment_source).toBe("test_fixture");
  });

  it.each(["catalog_viewed", "result_reopened", "made_up_event"])(
    "rejects non-backend event name %s",
    (event_name) => {
      const result = buildCanonicalBackendAnalyticsEvent(
        { ...orderInput(), event_name },
        receiverContext
      );
      expect(result).toEqual({
        success: false,
        error: { code: "UNKNOWN_EVENT", category: "contract", path: "$.event_name" }
      });
    }
  );

  it.each(forbiddenProducerFields)("rejects producer-owned field %s", (field) => {
    const result = buildCanonicalBackendAnalyticsEvent(
      { ...orderInput(), [field]: "untrusted" },
      receiverContext
    );
    expect(result).toEqual({
      success: false,
      error: {
        code: "INVALID_EVENT",
        category: "contract",
        eventName: "order_created",
        path: `$.${field}`
      }
    });
  });

  it.each(forbiddenProducerFields)("rejects present producer-owned field %s even when undefined", (field) => {
    const result = buildCanonicalBackendAnalyticsEvent(
      { ...orderInput(), [field]: undefined },
      receiverContext
    );
    expect(result).toEqual({
      success: false,
      error: {
        code: "INVALID_EVENT",
        category: "contract",
        eventName: "order_created",
        path: `$.${field}`
      }
    });
  });

  it("uses stable forbidden-field precedence", () => {
    const result = buildCanonicalBackendAnalyticsEvent(
      {
        ...orderInput(),
        traffic_class_hint: "internal_qa",
        traffic_class: "admin",
        received_at: receivedAt
      },
      receiverContext
    );
    expect(result).toMatchObject({ success: false, error: { path: "$.received_at" } });
  });

  it("privacy-scans the original input before forbidden-field handling", () => {
    const rejectedIdentity = "private@example.com";
    const result = buildCanonicalBackendAnalyticsEvent(
      { ...orderInput(), environment: rejectedIdentity },
      receiverContext
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({
      code: "PRIVACY_REJECTED",
      category: "privacy",
      eventName: "order_created",
      path: "$.environment"
    });
    expect(JSON.stringify(result)).not.toContain(rejectedIdentity);
  });

  it("rejects invalid receiver environment during canonical revalidation", () => {
    const result = buildCanonicalBackendAnalyticsEvent(orderInput(), {
      ...receiverContext,
      environment: "invalid"
    } as unknown as AnalyticsReceiverContext);
    expect(result.success).toBe(false);
  });

  it("rejects invalid receiver timestamp during canonical revalidation", () => {
    const result = buildCanonicalBackendAnalyticsEvent(orderInput(), {
      ...receiverContext,
      receivedAt: "2026-07-15 12:00:01"
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid event ID", () => {
    const result = buildCanonicalBackendAnalyticsEvent(
      { ...orderInput(), event_id: "invalid" },
      receiverContext
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid backend event properties", () => {
    const result = buildCanonicalBackendAnalyticsEvent(
      { ...orderInput(), properties: { ...orderProperties, order_status: "paid" } },
      receiverContext
    );
    expect(result.success).toBe(false);
  });

  it("rejects an entity analytics ID without analytics_id_key_version", () => {
    const withoutKeyVersion = Object.fromEntries(
      Object.entries(orderInput()).filter(([key]) => key !== "analytics_id_key_version")
    );
    const result = buildCanonicalBackendAnalyticsEvent(withoutKeyVersion, receiverContext);
    expect(result.success).toBe(false);
  });

  it("rejects analytics_id_key_version without an entity analytics ID", () => {
    const result = buildCanonicalBackendAnalyticsEvent(
      { ...backendOperationInput(), analytics_id_key_version: "v1" },
      receiverContext
    );
    expect(result.success).toBe(false);
  });

  it("returns output accepted by canonical validation", () => {
    const result = buildCanonicalBackendAnalyticsEvent(orderInput(), receiverContext);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(validateCanonicalAnalyticsEvent(result.data).success).toBe(true);
  });
});

describe("canonical analytics writer regressions", () => {
  it("derives BackendAnalyticsEventName from the registry type", () => {
    type RegistryBackendEventName = {
      [Name in AnalyticsEventName]: (typeof analyticsEventRegistry)[Name]["emittingLayer"] extends "backend" ? Name : never
    }[AnalyticsEventName];

    expectTypeOf<BackendAnalyticsEventName>().toEqualTypeOf<RegistryBackendEventName>();
    expectTypeOf<TrustedBackendAnalyticsInput<"order_created">["event_name"]>().toEqualTypeOf<"order_created">();
  });

  it("preserves exact registry and layer counts", () => {
    expect(analyticsEventNames).toHaveLength(32);
    expect(frontendAnalyticsEventNames).toHaveLength(9);
    expect(backendAnalyticsEventNames).toHaveLength(20);
    expect(derivedAnalyticsEventNames).toHaveLength(3);
  });

  it.each(["generic", "rikz_russian_2026"] as const)("keeps exam mode %s valid", (exam_mode) => {
    const result = buildCanonicalBackendAnalyticsEvent(
      { ...orderInput(), properties: { ...orderProperties, exam_mode } },
      receiverContext
    );
    expect(result.success).toBe(true);
  });

  it("does not mutate frozen frontend input, nested properties, or receiver context", () => {
    const properties = Object.freeze({ ...catalogProperties });
    const input = Object.freeze({ ...catalogInput(), properties });
    const trustedTrafficContext = Object.freeze({
      kind: "trusted_server_session" as const,
      trafficClass: "internal_qa" as const
    });
    const context = Object.freeze({ ...receiverContext, trustedTrafficContext });
    const inputBefore = { ...input, properties: { ...properties } };
    const contextBefore = { ...context, trustedTrafficContext: { ...trustedTrafficContext } };

    const result = buildCanonicalFrontendAnalyticsEvent(input, context);

    expect(result.success).toBe(true);
    expect(input).toEqual(inputBefore);
    expect(context).toEqual(contextBefore);
  });

  it("does not mutate frozen backend input, nested properties, or receiver context", () => {
    const properties = Object.freeze({ ...orderProperties });
    const input = Object.freeze({ ...orderInput(), properties });
    const trustedTrafficContext = Object.freeze({
      kind: "test_fixture" as const,
      trafficClass: "synthetic" as const
    });
    const context = Object.freeze({ ...receiverContext, trustedTrafficContext });
    const inputBefore = { ...input, properties: { ...properties } };
    const contextBefore = { ...context, trustedTrafficContext: { ...trustedTrafficContext } };

    const result = buildCanonicalBackendAnalyticsEvent(input, context);

    expect(result.success).toBe(true);
    expect(input).toEqual(inputBefore);
    expect(context).toEqual(contextBefore);
  });

  it.each([
    "student@example.com",
    "Bearer synthetic-token-value",
    "https://example.com/path?token=synthetic"
  ])("does not reflect rejected privacy value %s", (rejectedValue) => {
    const result = buildCanonicalFrontendAnalyticsEvent(
      { ...catalogInput(), properties: { ...catalogProperties, safe_extra: rejectedValue } },
      receiverContext
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(rejectedValue);
  });

  it("does not reflect a rejected taxonomy value", () => {
    const rejectedValue = "made_up_value";
    const result = buildCanonicalFrontendAnalyticsEvent(
      {
        event_id: eventId,
        event_name: "product_cta_clicked",
        event_version: 1,
        occurred_at: occurredAt,
        properties: {
          anonymous_session_id: eventId,
          product_id: "russian-2026",
          test_id: "russian-training-1",
          exam_mode: "rikz_russian_2026",
          cta_type: rejectedValue,
          surface: "product"
        }
      },
      receiverContext
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(rejectedValue);
  });

  it("does not throw for expected frontend or backend validation failures", () => {
    expect(() => buildCanonicalFrontendAnalyticsEvent(null, receiverContext)).not.toThrow();
    expect(() => buildCanonicalBackendAnalyticsEvent(null, receiverContext)).not.toThrow();
    expect(() => buildCanonicalBackendAnalyticsEvent(
      { ...orderInput(), traffic_class_hint: undefined },
      receiverContext
    )).not.toThrow();
  });

  it("returns typed canonical validation results", () => {
    const frontendResult = buildCanonicalFrontendAnalyticsEvent(catalogInput(), receiverContext);
    const backendResult = buildCanonicalBackendAnalyticsEvent(orderInput(), receiverContext);

    expectTypeOf(frontendResult).toMatchTypeOf<
      { success: true; data: CanonicalAnalyticsEvent } | { success: false; error: unknown }
    >();
    expectTypeOf(backendResult).toMatchTypeOf<
      { success: true; data: CanonicalAnalyticsEvent } | { success: false; error: unknown }
    >();
  });
});
