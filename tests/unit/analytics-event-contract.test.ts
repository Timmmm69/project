import { describe, expect, it } from "vitest";
import {
  EXAM_MODES,
  analyticsEventNames,
  analyticsEventRegistry,
  backendAnalyticsEventNames,
  derivedAnalyticsEventNames,
  frontendAnalyticsEventNames,
  validateCanonicalAnalyticsEvent,
  validateFrontendAnalyticsInput,
  type AnalyticsEventName
} from "@/lib/analytics/event-contract";
import {
  ACCESS_CLAIM_FAILURE_REASON_CODES,
  ACCESS_GRANT_REASONS,
  ANALYTICS_FAILURE_STAGES,
  ANSWER_SAVE_MODES,
  ATTEMPT_RESUME_METHODS,
  BACKEND_OPERATION_ERROR_CODES,
  CHECKOUT_ENTRY_POINTS,
  CLIENT_ERROR_CODES,
  CLIENT_ERROR_REPEAT_BUCKETS,
  PAYMENT_CANCEL_SOURCES,
  PAYMENT_FAILURE_REASON_CODES,
  PRODUCT_CTA_SURFACES,
  PRODUCT_CTA_TYPES,
  RESULT_REOPEN_SEQUENCE_BUCKETS,
  RESULT_VIEW_CONTEXTS
} from "@/lib/analytics/event-taxonomy";
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

const taxonomyFieldCases = [
  { eventName: "product_cta_clicked", field: "cta_type", validValue: "buy_access" },
  { eventName: "product_cta_clicked", field: "surface", validValue: "product" },
  { eventName: "checkout_started", field: "entry_point", validValue: "product_page" },
  { eventName: "result_viewed", field: "result_view_context", validValue: "completion" },
  { eventName: "client_error_shown", field: "failure_stage", validValue: "checkout" },
  { eventName: "client_error_shown", field: "error_code", validValue: "request_failed" },
  { eventName: "client_error_shown", field: "repeat_bucket", validValue: "first" },
  { eventName: "payment_failed", field: "failure_reason_code", validValue: "provider_declined" },
  { eventName: "payment_cancelled", field: "cancel_source", validValue: "provider" },
  { eventName: "access_granted", field: "grant_reason", validValue: "confirmed_payment" },
  { eventName: "access_claim_failed", field: "failure_reason_code", validValue: "challenge_expired" },
  { eventName: "answer_save_succeeded", field: "save_mode", validValue: "autosave" },
  { eventName: "answer_save_failed", field: "save_mode", validValue: "autosave" },
  { eventName: "attempt_resumed", field: "resume_method", validValue: "recovery" },
  { eventName: "backend_operation_failed", field: "failure_stage", validValue: "payment" },
  { eventName: "backend_operation_failed", field: "error_code", validValue: "provider_unavailable" },
  { eventName: "result_reopened", field: "reopen_sequence_bucket", validValue: "second" },
  { eventName: "result_reopened", field: "result_view_context", validValue: "recovery" }
] as const;

const accessGrantPairs = [
  ["paid", "confirmed_payment"],
  ["manual_grant", "manual_grant"],
  ["access_code", "access_code_redeemed"],
  ["free", "free_access"],
  ["support_replacement", "support_replacement"],
  ["qa_fixture", "qa_fixture"]
] as const;

const accessGrantMismatches = accessGrantPairs.flatMap(([accessSource, expectedReason]) =>
  ACCESS_GRANT_REASONS
    .filter((grantReason) => grantReason !== expectedReason)
    .map((grantReason) => [accessSource, grantReason] as const)
);

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

function accessGrantedProperties(
  accessSource: (typeof accessGrantPairs)[number][0],
  grantReason: (typeof ACCESS_GRANT_REASONS)[number]
) {
  return {
    access_public_id_hash: hash("C"),
    ...product,
    access_source: accessSource,
    grant_reason: grantReason,
    ...(accessSource === "paid" ? { order_public_id_hash: hash("A") } : {})
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

  it("exports the exact closed taxonomy values", () => {
    expect(PRODUCT_CTA_TYPES).toEqual(["open_product", "buy_access", "existing_access"]);
    expect(PRODUCT_CTA_SURFACES).toEqual(["catalog", "product"]);
    expect(CHECKOUT_ENTRY_POINTS).toEqual(["product_page", "checkout_restart"]);
    expect(RESULT_VIEW_CONTEXTS).toEqual(["completion", "recovery", "direct"]);
    expect(RESULT_REOPEN_SEQUENCE_BUCKETS).toEqual(["second", "third_to_fifth", "sixth_plus"]);
    expect(ANALYTICS_FAILURE_STAGES).toEqual([
      "catalog", "product", "checkout", "payment", "access_grant", "access_claim",
      "attempt_start", "answer_save", "attempt_resume", "attempt_completion", "result", "recovery"
    ]);
    expect(CLIENT_ERROR_CODES).toEqual([
      "request_failed", "load_failed", "validation_failed", "network_unavailable", "save_failed",
      "payment_status_unavailable", "access_unavailable", "attempt_unavailable", "completion_failed",
      "result_unavailable", "rate_limited", "unknown_sanitized"
    ]);
    expect(BACKEND_OPERATION_ERROR_CODES).toEqual([
      "provider_unavailable", "payment_state_changed", "payment_verification_failed", "access_grant_failed",
      "database_operation_failed", "attempt_state_conflict", "save_failed", "completion_failed",
      "recovery_failed", "rate_limited", "unknown_sanitized"
    ]);
    expect(CLIENT_ERROR_REPEAT_BUCKETS).toEqual(["first", "2_3", "4_10", "gt_10"]);
    expect(PAYMENT_FAILURE_REASON_CODES).toEqual([
      "provider_declined", "provider_processing_failed", "provider_timeout", "unknown_sanitized"
    ]);
    expect(PAYMENT_CANCEL_SOURCES).toEqual(["user", "provider", "system"]);
    expect(ACCESS_GRANT_REASONS).toEqual([
      "confirmed_payment", "manual_grant", "access_code_redeemed", "free_access", "support_replacement", "qa_fixture"
    ]);
    expect(ACCESS_CLAIM_FAILURE_REASON_CODES).toEqual([
      "invalid_challenge", "challenge_expired", "challenge_locked", "challenge_replay", "rate_limited",
      "access_unavailable", "verification_unavailable", "unknown_sanitized"
    ]);
    expect(ANSWER_SAVE_MODES).toEqual(["autosave", "manual_retry", "completion_flush", "timer_expiry_flush"]);
    expect(ATTEMPT_RESUME_METHODS).toEqual(["reload", "recovery", "access_code", "verified_session"]);
  });

  it.each(taxonomyFieldCases)("accepts a closed taxonomy value for $eventName.$field", ({ eventName, field, validValue }) => {
    const properties = { ...positiveProperties[eventName], [field]: validValue };
    expect(validateCanonicalAnalyticsEvent(canonicalEvent(eventName, properties)).success).toBe(true);
  });

  it.each(taxonomyFieldCases)("rejects made_up_value for $eventName.$field", ({ eventName, field }) => {
    const properties = { ...positiveProperties[eventName], [field]: "made_up_value" };
    expect(validateCanonicalAnalyticsEvent(canonicalEvent(eventName, properties)).success).toBe(false);
  });

  it("does not reflect a rejected taxonomy value in validation output", () => {
    const properties = { ...positiveProperties.product_cta_clicked, cta_type: "made_up_value" };
    const result = validateCanonicalAnalyticsEvent(canonicalEvent("product_cta_clicked", properties));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain("made_up_value");
  });

  it.each(accessGrantPairs)("accepts access_source=%s with grant_reason=%s", (accessSource, grantReason) => {
    expect(validateCanonicalAnalyticsEvent(
      canonicalEvent("access_granted", accessGrantedProperties(accessSource, grantReason))
    ).success).toBe(true);
  });

  it.each(accessGrantMismatches)("rejects access_source=%s with mismatched grant_reason=%s", (accessSource, grantReason) => {
    expect(validateCanonicalAnalyticsEvent(
      canonicalEvent("access_granted", accessGrantedProperties(accessSource, grantReason))
    ).success).toBe(false);
  });

  it.each(EXAM_MODES)("keeps exam_mode=%s distinct and valid", (examMode) => {
    const properties = { ...positiveProperties.product_viewed, exam_mode: examMode };
    expect(validateCanonicalAnalyticsEvent(canonicalEvent("product_viewed", properties)).success).toBe(true);
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

  it.each(["environment", "emitting_layer"])("requires canonical %s", (field) => {
    const valid = canonicalEvent("catalog_viewed");
    const missing = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
    expect(validateCanonicalAnalyticsEvent(missing).success).toBe(false);
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
      ...(hasEntityId ? { analytics_id_key_version: "v1" } : {}),
      properties
    }).success).toBe(true);
  });

  it.each(["received_at", "traffic_class", "traffic_class_assignment_source"])("rejects client-owned %s", (field) => {
    expect(validateFrontendAnalyticsInput({ ...frontend, [field]: "untrusted" }).success).toBe(false);
  });

  it.each([
    ["environment", "production"],
    ["emitting_layer", "frontend"]
  ])("rejects client-owned %s", (field, value) => {
    expect(validateFrontendAnalyticsInput({ ...frontend, [field]: value }).success).toBe(false);
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
