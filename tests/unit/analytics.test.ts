import { describe, expect, it } from "vitest";
import { analyticsConfig, hashAnalyticsId } from "@/lib/analytics/analytics-id";
import { assertNoForbiddenAnalyticsPayload } from "@/lib/analytics/forbidden-payload";
import {
  accessGrantedPropertiesSchema,
  analyticsEventRegistry,
  backendOperationFailedPropertiesSchema,
  checkoutStartedPropertiesSchema,
  orderCreatedPropertiesSchema,
  paidWithoutAccessDetectedPropertiesSchema,
  paidWithoutAccessResolvedPropertiesSchema,
  parseAnalyticsEvent,
  paymentConfirmedPropertiesSchema,
  paymentSessionCreatedPropertiesSchema,
  paymentPendingPropertiesSchema,
  paymentFailedPropertiesSchema,
  paymentCancelledPropertiesSchema,
  paymentExpiredPropertiesSchema,
  paymentReturnViewedPropertiesSchema
} from "@/lib/analytics/schemas";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);

const envelope = {
  event_id: "11111111-1111-4111-8111-111111111111",
  event_version: 1 as const,
  occurred_at: new Date("2026-07-12T12:00:00Z"),
  received_at: new Date("2026-07-12T12:00:01Z"),
  environment: "test" as const,
  traffic_class: "synthetic" as const,
  traffic_class_assignment_source: "test_fixture" as const,
  emitting_layer: "backend" as const
};

const paid = {
  order_public_id_hash: hash,
  payment_attempt_public_id_hash: otherHash,
  payment_provider: "fake" as const,
  payment_environment: "test" as const,
  payment_status: "paid" as const,
  verification_method: "fake_provider" as const
};

const access = {
  access_public_id_hash: hash,
  order_public_id_hash: otherHash,
  payment_attempt_public_id_hash: "c".repeat(64),
  product_id: "russian-2026",
  test_id: "russian-training-1",
  exam_mode: "rikz_russian_2026" as const,
  access_source: "paid" as const,
  grant_reason: "confirmed_payment" as const
};

describe("analytics event contracts", () => {
  it("registers all implemented event names", () => {
    expect(Object.keys(analyticsEventRegistry)).toEqual([
      "checkout_started", "order_created",
      "payment_confirmed", "access_granted", "paid_without_access_detected",
      "paid_without_access_resolved", "payment_validation_failed", "backend_operation_failed",
      "payment_session_created", "payment_pending",
      "payment_failed", "payment_cancelled", "payment_expired",
      "payment_return_viewed"
    ]);
  });

  it("accepts each strict event schema", () => {
    expect(parseAnalyticsEvent({
      ...envelope,
      event_name: "checkout_started",
      properties: {
        checkout_flow_id: "33333333-3333-4333-8333-333333333333",
        product_id: "russian-2026",
        test_id: "russian-training-1",
        exam_mode: "rikz_russian_2026"
      }
    }).event_name).toBe("checkout_started");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "order_created",
      properties: {
        checkout_flow_id: "33333333-3333-4333-8333-333333333333",
        order_public_id_hash: hash,
        product_id: "russian-2026",
        test_id: "russian-training-1",
        amount: 1000,
        currency: "BYN"
      }
    }).event_name).toBe("order_created");
    expect(parseAnalyticsEvent({ ...envelope, analytics_id_key_version: "v1", event_name: "payment_confirmed", properties: paid }).event_name).toBe("payment_confirmed");
    expect(parseAnalyticsEvent({ ...envelope, analytics_id_key_version: "v1", event_name: "access_granted", properties: access }).event_name).toBe("access_granted");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "paid_without_access_detected",
      properties: {
        order_public_id_hash: hash,
        payment_attempt_public_id_hash: otherHash,
        detection_source: "reconciliation",
        age_bucket: "60s_to_5m",
        support_required: true
      }
    }).event_name).toBe("paid_without_access_detected");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "paid_without_access_resolved",
      properties: {
        order_public_id_hash: hash,
        payment_attempt_public_id_hash: otherHash,
        access_public_id_hash: "c".repeat(64),
        resolution: "access_granted",
        resolution_time_bucket: "60s_to_5m"
      }
    }).event_name).toBe("paid_without_access_resolved");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "payment_validation_failed",
      properties: {
        order_public_id_hash: hash,
        payment_provider: "webpay",
        payment_environment: "sandbox",
        error_category: "payment_verification_error",
        validation_reason: "invalid_signature"
      }
    }).event_name).toBe("payment_validation_failed");
    expect(parseAnalyticsEvent({
      ...envelope,
      event_name: "backend_operation_failed",
      properties: {
        error_event_id: "22222222-2222-4222-8222-222222222222",
        error_category: "payment_provider_error",
        failure_stage: "checkout",
        error_code: "provider_unavailable",
        retryable: true,
        severity: "sev1"
      }
    }).event_name).toBe("backend_operation_failed");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "payment_session_created",
      properties: {
        order_public_id_hash: hash,
        payment_attempt_public_id_hash: otherHash,
        payment_provider: "webpay",
        payment_environment: "sandbox",
        amount: 1000,
        currency: "BYN"
      }
    }).event_name).toBe("payment_session_created");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "payment_pending",
      properties: {
        order_public_id_hash: hash,
        payment_attempt_public_id_hash: otherHash,
        payment_provider: "webpay",
        payment_environment: "sandbox"
      }
    }).event_name).toBe("payment_pending");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "payment_failed",
      properties: {
        order_public_id_hash: hash,
        payment_attempt_public_id_hash: otherHash,
        payment_provider: "webpay",
        payment_environment: "sandbox",
        terminal: true,
        failure_code: "payment_failed"
      }
    }).event_name).toBe("payment_failed");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "payment_cancelled",
      properties: {
        order_public_id_hash: hash,
        payment_attempt_public_id_hash: otherHash,
        payment_provider: "webpay",
        payment_environment: "sandbox",
        terminal: true
      }
    }).event_name).toBe("payment_cancelled");
    expect(parseAnalyticsEvent({
      ...envelope,
      analytics_id_key_version: "v1",
      event_name: "payment_expired",
      properties: {
        order_public_id_hash: hash,
        payment_attempt_public_id_hash: otherHash,
        payment_provider: "webpay",
        payment_environment: "sandbox",
        terminal: true
      }
    }).event_name).toBe("payment_expired");
    expect(parseAnalyticsEvent({
      ...envelope,
      event_name: "payment_return_viewed",
      properties: {
        return_result: "returned"
      }
    }).event_name).toBe("payment_return_viewed");
  });

  it("rejects unknown properties and schema_version", () => {
    expect(() => paymentConfirmedPropertiesSchema.parse({ ...paid, amount: 1000 })).toThrow();
    expect(() => parseAnalyticsEvent({ ...envelope, schema_version: 1, event_name: "payment_confirmed", properties: paid })).toThrow();
  });

  it("keeps checkout and order payloads closed", () => {
    const flow = {
      checkout_flow_id: "33333333-3333-4333-8333-333333333333",
      product_id: "russian-2026",
      test_id: "russian-training-1",
      exam_mode: "rikz_russian_2026"
    };
    const order = {
      checkout_flow_id: flow.checkout_flow_id,
      order_public_id_hash: hash,
      product_id: flow.product_id,
      test_id: flow.test_id,
      amount: 1000,
      currency: "BYN"
    };
    expect(checkoutStartedPropertiesSchema.parse(flow)).toEqual(flow);
    expect(orderCreatedPropertiesSchema.parse(order)).toEqual(order);
    expect(() => checkoutStartedPropertiesSchema.parse({ ...flow, email: "student@example.test" })).toThrow();
    expect(() => orderCreatedPropertiesSchema.parse({ ...order, email: "student@example.test" })).toThrow();
  });

  it("allows only authoritative verification methods", () => {
    for (const verification_method of ["callback", "status_api", "fake_provider"]) {
      expect(paymentConfirmedPropertiesSchema.parse({ ...paid, verification_method })).toBeTruthy();
    }
    expect(() => paymentConfirmedPropertiesSchema.parse({ ...paid, verification_method: "manual_authoritative" })).toThrow();
    expect(() => paymentConfirmedPropertiesSchema.parse({ ...paid, verification_method: "redirect" })).toThrow();
  });

  it("requires key version whenever entity hashes are present", () => {
    const validation = {
      order_public_id_hash: hash,
      payment_provider: "fake",
      payment_environment: "test",
      error_category: "payment_verification_error",
      validation_reason: "amount_mismatch"
    };
    expect(() => parseAnalyticsEvent({ ...envelope, event_name: "payment_validation_failed", properties: validation })).toThrow();
    expect(parseAnalyticsEvent({ ...envelope, event_name: "payment_validation_failed", properties: {
      payment_provider: "fake",
      payment_environment: "test",
      error_category: "payment_verification_error",
      validation_reason: "merchant_reference_mismatch"
    }})).toBeTruthy();
    expect(() => parseAnalyticsEvent({ ...envelope, analytics_id_key_version: "v1", event_name: "payment_validation_failed", properties: {
      payment_provider: "fake", payment_environment: "test", error_category: "payment_verification_error", validation_reason: "merchant_reference_mismatch"
    }})).toThrow();
    expect(() => parseAnalyticsEvent({ ...envelope, analytics_id_key_version: "v1", event_name: "payment_confirmed", properties: { ...paid, analytics_id_key_version: "v1" } })).toThrow();
  });

  it("does not allow client traffic classification in properties", () => {
    expect(() => accessGrantedPropertiesSchema.parse({ ...access, traffic_class: "internal_qa" })).toThrow();
  });

  it("keeps backend failure fields closed and free-text free", () => {
    expect(() => backendOperationFailedPropertiesSchema.parse({
      error_event_id: "22222222-2222-4222-8222-222222222222",
      error_category: "payment_provider_error",
      failure_stage: "checkout",
      error_code: "provider_unavailable",
      retryable: true,
      severity: "sev1",
      message: "raw provider error"
    })).toThrow();
  });

  it("keeps paid_without_access analytics closed and PII-free", () => {
    const detected = {
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      detection_source: "provider_replay",
      age_bucket: "lt_60s",
      support_required: false
    };
    const resolved = {
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      access_public_id_hash: "c".repeat(64),
      resolution: "access_granted",
      resolution_time_bucket: "lt_60s"
    };
    expect(paidWithoutAccessDetectedPropertiesSchema.parse(detected)).toEqual(detected);
    expect(paidWithoutAccessResolvedPropertiesSchema.parse(resolved)).toEqual(resolved);
    expect(() => paidWithoutAccessDetectedPropertiesSchema.parse({
      ...detected,
      email: "student@example.test"
    })).toThrow();
    expect(() => paidWithoutAccessResolvedPropertiesSchema.parse({
      ...resolved,
      provider_payment_id: "provider-secret"
    })).toThrow();
  });

  it("keeps payment session analytics closed and PII-free", () => {
    const session = {
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      payment_provider: "webpay" as const,
      payment_environment: "sandbox" as const,
      amount: 1000,
      currency: "BYN"
    };
    expect(paymentSessionCreatedPropertiesSchema.parse(session)).toEqual(session);
    expect(() => paymentSessionCreatedPropertiesSchema.parse({ ...session, email: "student@example.test" })).toThrow();
    expect(() => paymentSessionCreatedPropertiesSchema.parse({ ...session, signature: "sig" })).toThrow();

    const pending = {
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      payment_provider: "webpay" as const,
      payment_environment: "sandbox" as const
    };
    expect(paymentPendingPropertiesSchema.parse(pending)).toEqual(pending);
    expect(() => paymentPendingPropertiesSchema.parse({ ...pending, raw_body: "data" })).toThrow();
  });

  it("keeps payment terminal analytics closed and no-free-text", () => {
    expect(() => paymentFailedPropertiesSchema.parse({
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      payment_provider: "webpay",
      payment_environment: "sandbox",
      terminal: true,
      failure_code: "checkout_create_failed"
    })).not.toThrow();
    expect(() => paymentFailedPropertiesSchema.parse({
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      payment_provider: "webpay",
      payment_environment: "sandbox",
      terminal: true,
      failure_code: "free_text_error"
    })).toThrow();
    expect(() => paymentCancelledPropertiesSchema.parse({
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      payment_provider: "webpay",
      payment_environment: "sandbox",
      terminal: true,
      reason: "free text"
    })).toThrow();
    expect(() => paymentExpiredPropertiesSchema.parse({
      order_public_id_hash: hash,
      payment_attempt_public_id_hash: otherHash,
      payment_provider: "webpay",
      payment_environment: "sandbox",
      terminal: true
    })).not.toThrow();
  });

  it("keeps payment return viewed analytics closed", () => {
    expect(paymentReturnViewedPropertiesSchema.parse({ return_result: "returned" })).toEqual({ return_result: "returned" });
    expect(paymentReturnViewedPropertiesSchema.parse({ return_result: "cancelled" })).toEqual({ return_result: "cancelled" });
    expect(() => paymentReturnViewedPropertiesSchema.parse({ return_result: "paid" })).toThrow();
    expect(() => paymentReturnViewedPropertiesSchema.parse({ return_result: "returned", email: "test@example.test" })).toThrow();
  });

  it("produces payment_validation_failed without access hash", () => {
    expect(() => parseAnalyticsEvent({
      ...envelope,
      event_name: "payment_validation_failed",
      properties: {
        payment_provider: "fake",
        payment_environment: "test",
        error_category: "payment_verification_error" as const,
        validation_reason: "merchant_reference_mismatch" as const
      }
    })).not.toThrow();
  });
});

describe("analytics privacy guard", () => {
  it.each([
    [{ email: "student@example.test" }],
    [{ answers: ["A"] }],
    [{ question_text: "secret question" }],
    [{ correct_answer: "A" }],
    [{ primary_score: 37 }],
    [{ scaled_score: 82 }],
    [{ provider_payment_id: "provider-123" }],
    [{ signature: "signed" }]
  ])("rejects forbidden keys", (payload) => {
    expect(() => assertNoForbiddenAnalyticsPayload(payload)).toThrow(/ANALYTICS_FORBIDDEN_KEY/);
  });

  it.each([
    ["student@example.test"],
    ["Bearer abcdefghijklmnopqrstuvwxyz"],
    ["https://example.test/callback?token=secret"],
    ["x".repeat(257)]
  ])("rejects forbidden value patterns", (value) => {
    expect(() => assertNoForbiddenAnalyticsPayload({ safe: value })).toThrow(/ANALYTICS_FORBIDDEN_VALUE/);
  });

  it("accepts the allowlisted property examples", () => {
    expect(() => assertNoForbiddenAnalyticsPayload(paid)).not.toThrow();
    expect(() => assertNoForbiddenAnalyticsPayload(access)).not.toThrow();
  });
});

describe("analytics ID hashing", () => {
  const config = { enabled: true, hmacKey: "synthetic-test-key-that-is-at-least-32-characters", keyVersion: "v1" };

  it("is stable for the same opaque ID and key version", () => {
    expect(hashAnalyticsId("order", "opaque-order-1", config)).toBe(hashAnalyticsId("order", "opaque-order-1", config));
  });

  it("separates different IDs and entity namespaces", () => {
    expect(hashAnalyticsId("order", "opaque-order-1", config)).not.toBe(hashAnalyticsId("order", "opaque-order-2", config));
    expect(hashAnalyticsId("order", "same", config)).not.toBe(hashAnalyticsId("access", "same", config));
  });

  it("is disabled without analytics secrets and validates enabled configuration safely", () => {
    expect(analyticsConfig({ ANALYTICS_ENABLED: "false" })).toEqual({ enabled: false });
    expect(() => analyticsConfig({ ANALYTICS_ENABLED: "true", ANALYTICS_ID_HMAC_KEY: "short", ANALYTICS_ID_KEY_VERSION: "v1" }))
      .toThrow("ANALYTICS_CONFIGURATION_INVALID");
  });
});
