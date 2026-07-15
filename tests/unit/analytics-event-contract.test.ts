import { describe, expect, it } from "vitest";
import {
  analyticsEventNames,
  analyticsEventRegistry,
  backendAnalyticsEventNames,
  derivedAnalyticsEventNames,
  frontendAnalyticsEventNames,
  validateCanonicalAnalyticsEvent,
  validateFrontendAnalyticsInput,
  type AnalyticsEventName
} from "@/lib/analytics/event-contract";
import { assignAnalyticsTrafficClass } from "@/lib/analytics/traffic-class";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";
const flowUuid = "33333333-3333-4333-8333-333333333333";
const hash = (letter: string) => `aid1.${letter.repeat(43)}`;

const product = { product_id: "russian-2026", test_id: "russian-training-1", exam_mode: "rikz_russian_2026" };
const client = { anonymous_session_id: uuid };
const device = { device_class: "desktop", viewport_bucket: "gte_1024" };
const payment = {
  order_public_id_hash: hash("A"),
  payment_attempt_public_id_hash: hash("B"),
  payment_provider: "fake",
  payment_environment: "test"
};
const counts = { questions_answered_count: 30, questions_skipped_count: 10 };

const positiveProperties = {
  catalog_viewed: { ...client, surface: "catalog", ...device, locale: "ru" },
  product_viewed: { ...client, ...product, ...device, locale: "ru" },
  product_cta_clicked: { ...client, ...product, cta_type: "buy_access", surface: "product" },
  checkout_started: { ...client, checkout_flow_id: flowUuid, ...product, entry_point: "product_page", ...device },
  payment_return_viewed: { ...client, order_public_id_hash: hash("A"), payment_provider: "fake", payment_environment: "test", payment_status: "pending" },
  access_claim_started: { ...client, ...product, claim_method: "recovery" },
  attempt_submit_started: { ...client, attempt_public_id_hash: hash("D"), exam_mode: "rikz_russian_2026", ...counts },
  result_viewed: { ...client, attempt_public_id_hash: hash("D"), access_public_id_hash: hash("C"), ...product, result_view_context: "completion", ...device },
  client_error_shown: { ...client, error_category: "network_error", failure_stage: "checkout", error_code: "request_failed", retry_available: true, ...device },
  order_created: { checkout_flow_id: flowUuid, order_public_id_hash: hash("A"), ...product, order_status: "created", access_source: "paid" },
  payment_session_created: { ...payment, payment_status: "pending" },
  payment_pending: { ...payment, payment_status: "pending" },
  payment_confirmed: { ...payment, payment_status: "paid", verification_method: "fake_provider" },
  payment_failed: { ...payment, payment_status: "failed", failure_reason_code: "provider_declined" },
  payment_cancelled: { ...payment, payment_status: "cancelled", cancel_source: "provider" },
  payment_expired: { ...payment, payment_status: "expired" },
  payment_validation_failed: { order_public_id_hash: hash("A"), payment_provider: "fake", payment_environment: "test", error_category: "payment_verification_error", validation_reason: "invalid_signature" },
  access_granted: { access_public_id_hash: hash("C"), order_public_id_hash: hash("A"), ...product, access_source: "paid", grant_reason: "confirmed_payment" },
  access_claim_completed: { access_public_id_hash: hash("C"), ...product, claim_method: "recovery", access_source: "paid" },
  access_claim_failed: { ...product, claim_method: "recovery", error_category: "recovery_error", failure_reason_code: "challenge_expired" },
  existing_access_detected: { access_public_id_hash: hash("C"), ...product, access_source: "paid", attempt_public_id_hash: hash("D"), attempt_status: "active" },
  attempt_started: { access_public_id_hash: hash("C"), attempt_public_id_hash: hash("D"), ...product, access_source: "paid", attempt_status: "active", ...device },
  answer_save_succeeded: { attempt_public_id_hash: hash("D"), save_operation_id: otherUuid, save_mode: "autosave", attempt_status: "active", latency_bucket: "lt_10s" },
  answer_save_failed: { attempt_public_id_hash: hash("D"), save_operation_id: otherUuid, save_mode: "autosave", error_category: "save_error", failure_stage: "answer_save" },
  attempt_resumed: { access_public_id_hash: hash("C"), attempt_public_id_hash: hash("D"), ...product, attempt_status: "active", resume_method: "recovery" },
  attempt_expired: { attempt_public_id_hash: hash("D"), access_public_id_hash: hash("C"), exam_mode: "rikz_russian_2026", attempt_status: "expired", completion_reason: "timer_expired", ...counts },
  attempt_completed: { attempt_public_id_hash: hash("D"), access_public_id_hash: hash("C"), ...product, attempt_status: "completed", completion_reason: "user_submit", duration_bucket: "61_90m", ...counts },
  attempt_completion_failed: { attempt_public_id_hash: hash("D"), access_public_id_hash: hash("C"), exam_mode: "rikz_russian_2026", error_category: "completion_error", failure_stage: "attempt_completion", completion_reason: "user_submit", error_event_id: otherUuid },
  backend_operation_failed: { error_event_id: otherUuid, order_public_id_hash: hash("A"), error_category: "payment_provider_error", failure_stage: "payment", error_code: "provider_unavailable", retryable: true, severity: "sev1" },
  paid_without_access_detected: { ...payment, failure_stage: "access_grant", detection_delay_bucket: "2_5m" },
  paid_without_access_resolved: { ...payment, access_public_id_hash: hash("C"), resolution_type: "access_granted", resolution_delay_bucket: "lt_5m" },
  result_reopened: { attempt_public_id_hash: hash("D"), access_public_id_hash: hash("C"), exam_mode: "rikz_russian_2026", reopen_sequence_bucket: "second", result_view_context: "recovery" }
} satisfies Record<AnalyticsEventName, Record<string, unknown>>;

function canonicalEvent(
  eventName: AnalyticsEventName,
  properties: Record<string, unknown> = positiveProperties[eventName]
) {
  const definition = analyticsEventRegistry[eventName];
  const hasEntityId = Object.keys(properties).some((key) => key.endsWith("_public_id_hash"));
  return {
    event_id: uuid,
    event_name: eventName,
    event_version: 1,
    occurred_at: "2026-07-12T12:00:00.000Z",
    received_at: "2026-07-12T12:00:01.000Z",
    environment: "test",
    traffic_class: "synthetic",
    traffic_class_assignment_source: "test_fixture",
    emitting_layer: definition.emittingLayer,
    ...(hasEntityId ? { analytics_id_key_version: "v1" } : {}),
    properties
  };
}

describe("analytics registry integrity", () => {
  it("contains exactly the approved 32 unique events and exact layer counts", () => {
    expect(analyticsEventNames).toHaveLength(32);
    expect(new Set(analyticsEventNames)).toHaveLength(32);
    expect(frontendAnalyticsEventNames).toHaveLength(9);
    expect(backendAnalyticsEventNames).toHaveLength(20);
    expect(derivedAnalyticsEventNames).toHaveLength(3);
    expect(Object.keys(positiveProperties)).toEqual(analyticsEventNames);
  });

  it.each(analyticsEventNames)("accepts the positive canonical fixture for %s", (eventName) => {
    expect(validateCanonicalAnalyticsEvent(canonicalEvent(eventName))).toMatchObject({ success: true });
  });
});

describe("canonical collected-event contract", () => {
  it("rejects missing, unknown and alternate version fields", () => {
    const valid = canonicalEvent("catalog_viewed");
    const missing = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "received_at"));
    expect(validateCanonicalAnalyticsEvent(missing).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent({ ...valid, metadata: {} }).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent({ ...valid, event_version: 2 }).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent({ ...valid, schema_version: 1 }).success).toBe(false);
  });

  it("requires strict UTC timestamps and exact registry layer", () => {
    const valid = canonicalEvent("order_created");
    expect(validateCanonicalAnalyticsEvent({ ...valid, occurred_at: "2026-07-12 12:00:00" }).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent({ ...valid, occurred_at: "2026-07-12T15:00:00+03:00" }).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent({ ...valid, emitting_layer: "frontend" }).success).toBe(false);
  });

  it("requires key version exactly when an entity analytics ID is present", () => {
    const withId = canonicalEvent("order_created");
    const missingVersion = Object.fromEntries(Object.entries(withId).filter(([key]) => key !== "analytics_id_key_version"));
    expect(validateCanonicalAnalyticsEvent(missingVersion).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent({ ...canonicalEvent("catalog_viewed"), analytics_id_key_version: "v1" }).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent(canonicalEvent("order_created", { ...positiveProperties.order_created, order_public_id_hash: "malformed" })).success).toBe(false);
  });

  it("restricts checkout_flow_id to checkout_started and order_created", () => {
    for (const eventName of ["checkout_started", "order_created"] as const) {
      const missing = Object.fromEntries(Object.entries(positiveProperties[eventName]).filter(([key]) => key !== "checkout_flow_id"));
      expect(validateCanonicalAnalyticsEvent(canonicalEvent(eventName, missing)).success).toBe(false);
    }
    expect(validateCanonicalAnalyticsEvent(canonicalEvent("product_viewed", { ...positiveProperties.product_viewed, checkout_flow_id: flowUuid })).success).toBe(false);
    expect(validateCanonicalAnalyticsEvent(canonicalEvent("checkout_started", { ...positiveProperties.checkout_started, checkout_flow_id: "not-a-uuid" })).success).toBe(false);
  });

  it.each(["callback", "status_api", "fake_provider"])("accepts authoritative payment verification %s", (verification_method) => {
    expect(validateCanonicalAnalyticsEvent(canonicalEvent("payment_confirmed", { ...positiveProperties.payment_confirmed, verification_method })).success).toBe(true);
  });

  it.each(["manual", "support", "screenshot", "redirect", "return_page", "provider_cabinet"])("rejects non-authoritative payment verification %s", (verification_method) => {
    expect(validateCanonicalAnalyticsEvent(canonicalEvent("payment_confirmed", { ...positiveProperties.payment_confirmed, verification_method })).success).toBe(false);
  });

  it("does not reinterpret payment_return_viewed as backend success", () => {
    expect(validateCanonicalAnalyticsEvent({ ...canonicalEvent("payment_return_viewed"), event_name: "payment_confirmed", emitting_layer: "backend" }).success).toBe(false);
  });
});

describe("frontend authority and traffic classification", () => {
  const frontend = {
    event_id: uuid,
    event_name: "catalog_viewed",
    event_version: 1,
    occurred_at: "2026-07-12T12:00:00.000Z",
    environment: "test",
    emitting_layer: "frontend",
    traffic_class_hint: "internal_qa",
    properties: positiveProperties.catalog_viewed
  };

  it("accepts frontend input without receiver-owned fields", () => {
    expect(validateFrontendAnalyticsInput(frontend).success).toBe(true);
  });

  it.each(frontendAnalyticsEventNames)("accepts the frontend fixture for %s with conditional key version", (eventName) => {
    const properties = positiveProperties[eventName];
    const hasEntityId = Object.keys(properties).some((key) => key.endsWith("_public_id_hash"));
    expect(validateFrontendAnalyticsInput({
      event_id: uuid,
      event_name: eventName,
      event_version: 1,
      occurred_at: "2026-07-12T12:00:00.000Z",
      environment: "test",
      emitting_layer: "frontend",
      ...(hasEntityId ? { analytics_id_key_version: "v1" } : {}),
      properties
    }).success).toBe(true);
  });

  it.each(["received_at", "traffic_class", "traffic_class_assignment_source"])("rejects client-owned %s", (field) => {
    expect(validateFrontendAnalyticsInput({ ...frontend, [field]: "untrusted" }).success).toBe(false);
  });

  it("rejects backend and derived names at the frontend boundary", () => {
    expect(validateFrontendAnalyticsInput({ ...frontend, event_name: "payment_confirmed" }).success).toBe(false);
    expect(validateFrontendAnalyticsInput({ ...frontend, event_name: "result_reopened" }).success).toBe(false);
  });

  it("never elevates an untrusted hint and accepts typed trusted contexts", () => {
    expect(assignAnalyticsTrafficClass({ clientHint: "admin" })).toEqual({ traffic_class: "external_user", traffic_class_assignment_source: "default_external_user" });
    expect(assignAnalyticsTrafficClass({ trustedContext: { kind: "trusted_server_session", trafficClass: "admin" } })).toEqual({ traffic_class: "admin", traffic_class_assignment_source: "trusted_server_session" });
    expect(assignAnalyticsTrafficClass({ trustedContext: { kind: "test_fixture", trafficClass: "synthetic" } })).toEqual({ traffic_class: "synthetic", traffic_class_assignment_source: "test_fixture" });
  });
});
