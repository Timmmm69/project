import { z } from "zod";

const bounded = z.string().min(1).max(128);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const keyVersion = z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/);
const provider = z.enum(["fake", "webpay"]);
const paymentEnvironment = z.enum(["test", "sandbox", "production", "not_applicable"]);

const entityHashFields = {
  order_public_id_hash: hash.optional(),
  payment_attempt_public_id_hash: hash.optional(),
  access_public_id_hash: hash.optional()
};

export const paymentConfirmedPropertiesSchema = z.object({
  order_public_id_hash: hash,
  payment_attempt_public_id_hash: hash,
  payment_provider: provider,
  payment_environment: paymentEnvironment,
  payment_status: z.literal("paid"),
  verification_method: z.enum(["callback", "status_api", "fake_provider"])
}).strict();

export const accessGrantedPropertiesSchema = z.object({
  access_public_id_hash: hash,
  order_public_id_hash: hash,
  payment_attempt_public_id_hash: hash,
  product_id: bounded,
  test_id: bounded,
  exam_mode: z.enum(["generic", "rikz_russian_2026"]),
  access_source: z.literal("paid"),
  grant_reason: z.literal("confirmed_payment")
}).strict();

export const checkoutStartedPropertiesSchema = z.object({
  checkout_flow_id: z.string().uuid(),
  product_id: bounded,
  test_id: bounded,
  exam_mode: z.enum(["generic", "rikz_russian_2026"])
}).strict();

export const orderCreatedPropertiesSchema = z.object({
  checkout_flow_id: z.string().uuid(),
  order_public_id_hash: hash,
  product_id: bounded,
  test_id: bounded,
  amount: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/)
}).strict();

export const paymentValidationFailedPropertiesSchema = z.object({
  ...entityHashFields,
  access_public_id_hash: z.never().optional(),
  payment_provider: provider,
  payment_environment: paymentEnvironment,
  error_category: z.literal("payment_verification_error"),
  validation_reason: z.enum([
    "invalid_callback_signal", "invalid_signature", "merchant_reference_mismatch", "provider_mismatch",
    "amount_mismatch", "currency_mismatch", "provider_payment_id_conflict", "illegal_status_transition",
    "status_verification_unavailable"
  ])
}).strict();

export const backendOperationFailedPropertiesSchema = z.object({
  ...entityHashFields,
  error_event_id: z.string().uuid(),
  error_category: z.enum(["payment_provider_error", "payment_processing_error", "access_grant_error"]),
  failure_stage: z.enum(["checkout", "payment", "access_grant"]),
  error_code: z.enum(["provider_unavailable", "payment_state_changed", "access_grant_failed", "database_operation_failed"]),
  retryable: z.boolean(),
  severity: z.enum(["sev1", "sev2", "sev3"])
}).strict();

const envelope = {
  event_id: z.string().uuid(),
  event_version: z.literal(1),
  occurred_at: z.date(),
  received_at: z.date(),
  environment: z.enum(["development", "test", "sandbox", "production"]),
  traffic_class: z.enum(["external_user", "synthetic"]),
  traffic_class_assignment_source: z.enum(["default_external_user", "test_fixture"]),
  emitting_layer: z.literal("backend"),
  analytics_id_key_version: keyVersion.optional()
};

function eventSchema<T extends z.ZodType>(eventName: string, properties: T) {
  return z.object({ ...envelope, event_name: z.literal(eventName), properties }).strict().superRefine((value, ctx) => {
    const record = value as { properties: Record<string, unknown>; analytics_id_key_version?: string };
    const props = record.properties;
    const hasHash = Object.entries(props).some(([key, item]) => key.endsWith("_public_id_hash") && item !== undefined);
    if (hasHash !== Boolean(record.analytics_id_key_version)) {
      ctx.addIssue({ code: "custom", message: "analytics_id_key_version must accompany entity hashes", path: ["analytics_id_key_version"] });
    }
  });
}

export const analyticsEventRegistry = {
  checkout_started: eventSchema("checkout_started", checkoutStartedPropertiesSchema),
  order_created: eventSchema("order_created", orderCreatedPropertiesSchema),
  payment_confirmed: eventSchema("payment_confirmed", paymentConfirmedPropertiesSchema),
  access_granted: eventSchema("access_granted", accessGrantedPropertiesSchema),
  payment_validation_failed: eventSchema("payment_validation_failed", paymentValidationFailedPropertiesSchema),
  backend_operation_failed: eventSchema("backend_operation_failed", backendOperationFailedPropertiesSchema)
} as const;

export type AnalyticsEventName = keyof typeof analyticsEventRegistry;

export function parseAnalyticsEvent(event: { event_name: AnalyticsEventName } & Record<string, unknown>) {
  return analyticsEventRegistry[event.event_name].parse(event);
}
