import { describe, expect, it } from "vitest";
import { analyticsConfig, hashAnalyticsId } from "@/lib/analytics/analytics-id";
import { assertNoForbiddenAnalyticsPayload } from "@/lib/analytics/forbidden-payload";
import {
  accessGrantedPropertiesSchema,
  analyticsEventRegistry,
  backendOperationFailedPropertiesSchema,
  parseAnalyticsEvent,
  paymentConfirmedPropertiesSchema
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
  it("registers only the four implemented event names", () => {
    expect(Object.keys(analyticsEventRegistry)).toEqual([
      "payment_confirmed", "access_granted", "payment_validation_failed", "backend_operation_failed"
    ]);
  });

  it("accepts each strict event schema", () => {
    expect(parseAnalyticsEvent({ ...envelope, analytics_id_key_version: "v1", event_name: "payment_confirmed", properties: paid }).event_name).toBe("payment_confirmed");
    expect(parseAnalyticsEvent({ ...envelope, analytics_id_key_version: "v1", event_name: "access_granted", properties: access }).event_name).toBe("access_granted");
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
  });

  it("rejects unknown properties and schema_version", () => {
    expect(() => paymentConfirmedPropertiesSchema.parse({ ...paid, amount: 1000 })).toThrow();
    expect(() => parseAnalyticsEvent({ ...envelope, schema_version: 1, event_name: "payment_confirmed", properties: paid })).toThrow();
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
