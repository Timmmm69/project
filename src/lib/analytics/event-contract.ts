import { z } from "zod";
import { ANALYTICS_ENTITY_ID_PATTERN, ANALYTICS_ID_KEY_VERSION_PATTERN } from "@/lib/analytics/entity-id";
import { scanAnalyticsPrivacy } from "@/lib/analytics/privacy-scan";
import {
  isValidAnalyticsTrafficAssignment,
  TRAFFIC_CLASSES,
  TRAFFIC_CLASS_ASSIGNMENT_SOURCES
} from "@/lib/analytics/traffic-class";

export const ANALYTICS_EVENT_VERSION = 1 as const;
export const ANALYTICS_ENVIRONMENTS = ["development", "test", "sandbox", "production"] as const;
export const ANALYTICS_EMITTING_LAYERS = ["frontend", "backend", "derived"] as const;
export const EXAM_MODES = ["generic", "rikz_russian_2026"] as const;
export const ACCESS_SOURCES = ["paid", "manual_grant", "access_code", "free", "support_replacement", "qa_fixture"] as const;
export const PAYMENT_PROVIDERS = ["fake", "webpay", "none"] as const;
export const PAYMENT_ENVIRONMENTS = ["test", "sandbox", "production", "not_applicable"] as const;
export const PAYMENT_STATUSES = ["created", "pending", "paid", "failed", "cancelled", "expired", "refunded"] as const;
export const ATTEMPT_STATUSES = ["not_started", "active", "expired", "completed", "invalidated"] as const;
export const DEVICE_CLASSES = ["mobile", "tablet", "desktop", "unknown"] as const;
export const VIEWPORT_BUCKETS = ["lt_360", "360_389", "390_429", "430_767", "768_1023", "gte_1024", "unknown"] as const;
export const VERIFICATION_METHODS = ["callback", "status_api", "fake_provider"] as const;
export const COMPLETION_REASONS = ["user_submit", "timer_expired", "support_recovery"] as const;
export const RESOLUTION_TYPES = ["access_granted", "refund_confirmed", "false_positive_documented"] as const;
export const ERROR_CATEGORIES = [
  "validation_error",
  "network_error",
  "save_error",
  "payment_provider_error",
  "payment_verification_error",
  "access_grant_error",
  "attempt_state_error",
  "completion_error",
  "recovery_error",
  "rate_limit",
  "unknown_sanitized"
] as const;

const environmentSchema = z.enum(ANALYTICS_ENVIRONMENTS);
const trafficClassSchema = z.enum(TRAFFIC_CLASSES);
const assignmentSourceSchema = z.enum(TRAFFIC_CLASS_ASSIGNMENT_SOURCES);
const examModeSchema = z.enum(EXAM_MODES);
const accessSourceSchema = z.enum(ACCESS_SOURCES);
const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
const paymentEnvironmentSchema = z.enum(PAYMENT_ENVIRONMENTS);
const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
const deviceClassSchema = z.enum(DEVICE_CLASSES);
const viewportBucketSchema = z.enum(VIEWPORT_BUCKETS);
const verificationMethodSchema = z.enum(VERIFICATION_METHODS);
const completionReasonSchema = z.enum(COMPLETION_REASONS);
const resolutionTypeSchema = z.enum(RESOLUTION_TYPES);
const errorCategorySchema = z.enum(ERROR_CATEGORIES);

const uuidSchema = z.string().uuid();
const utcIsoTimestampSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
  "UTC ISO timestamp required"
).refine((value) => !Number.isNaN(Date.parse(value)), "UTC ISO timestamp required");
const publicCodeSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const safeCodeSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_]*$/);
const analyticsEntityIdSchema = z.string().regex(ANALYTICS_ENTITY_ID_PATTERN);
const analyticsIdKeyVersionSchema = z.string().regex(ANALYTICS_ID_KEY_VERSION_PATTERN);
const countSchema = z.number().int().min(0).max(1000);
const localeSchema = z.literal("ru");
const booleanSchema = z.boolean();

const latencyBucketSchema = z.enum(["lt_10s", "10_59s", "1_2m", "2_5m", "5_15m", "gt_15m"]);
const durationBucketSchema = z.enum(["lt_15m", "15_30m", "31_60m", "61_90m", "91_120m", "gt_120m_anomaly"]);
const resolutionDelayBucketSchema = z.enum(["lt_5m", "5_15m", "15_60m", "1_24h", "gt_24h"]);

const entityFields = {
  order_public_id_hash: analyticsEntityIdSchema,
  payment_attempt_public_id_hash: analyticsEntityIdSchema,
  access_public_id_hash: analyticsEntityIdSchema,
  attempt_public_id_hash: analyticsEntityIdSchema
} as const;
type EntityFieldName = keyof typeof entityFields;

type Layer = (typeof ANALYTICS_EMITTING_LAYERS)[number];
type Shape = z.ZodRawShape;

function optionalShape<T extends Shape>(shape: T) {
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).optional()])) as unknown as {
    [K in keyof T]: z.ZodOptional<T[K]>;
  };
}

function defineEvent<
  const Name extends string,
  const EventLayer extends Layer,
  const Required extends Shape,
  const Optional extends Shape = Record<never, never>
>(input: Readonly<{
  eventName: Name;
  emittingLayer: EventLayer;
  required: Required;
  optional?: Optional;
  refine?: (value: Record<string, unknown>, ctx: z.RefinementCtx) => void;
}>) {
  const optional = (input.optional ?? {}) as Optional;
  const basePropertiesSchema = z.object({ ...input.required, ...optionalShape(optional) }).strict();
  const propertiesSchema = input.refine
    ? basePropertiesSchema.superRefine((value, ctx) => input.refine!(value as Record<string, unknown>, ctx))
    : basePropertiesSchema;
  const requiredProperties = Object.keys(input.required);
  const optionalProperties = Object.keys(optional);
  const allProperties = [...requiredProperties, ...optionalProperties];
  const entityAnalyticsIds = allProperties.filter((name): name is EntityFieldName => name in entityFields);
  return {
    eventName: input.eventName,
    event_name: input.eventName,
    emittingLayer: input.emittingLayer,
    emitting_layer: input.emittingLayer,
    requiredProperties,
    optionalProperties,
    propertiesSchema,
    entityAnalyticsIds,
    analyticsIdKeyVersion: entityAnalyticsIds.length > 0 ? "when_entity_id_present" as const : "forbidden" as const,
    allowsAnonymousSessionId: allProperties.includes("anonymous_session_id"),
    allowsCheckoutFlowId: allProperties.includes("checkout_flow_id"),
    requiresCheckoutFlowId: requiredProperties.includes("checkout_flow_id")
  } as const;
}

const clientBase = {
  anonymous_session_id: uuidSchema
};
const productBase = {
  product_id: publicCodeSchema,
  test_id: publicCodeSchema,
  exam_mode: examModeSchema
};
const clientDevice = {
  device_class: deviceClassSchema,
  viewport_bucket: viewportBucketSchema
};
const paymentBase = {
  order_public_id_hash: entityFields.order_public_id_hash,
  payment_attempt_public_id_hash: entityFields.payment_attempt_public_id_hash,
  payment_provider: paymentProviderSchema,
  payment_environment: paymentEnvironmentSchema
};
const attemptCounts = {
  questions_answered_count: countSchema,
  questions_skipped_count: countSchema
};
export const analyticsEventRegistry = {
  catalog_viewed: defineEvent({
    eventName: "catalog_viewed", emittingLayer: "frontend",
    required: { ...clientBase, surface: z.literal("catalog"), ...clientDevice, locale: localeSchema }
  }),
  product_viewed: defineEvent({
    eventName: "product_viewed", emittingLayer: "frontend",
    required: { ...clientBase, ...productBase, ...clientDevice, locale: localeSchema }
  }),
  product_cta_clicked: defineEvent({
    eventName: "product_cta_clicked", emittingLayer: "frontend",
    required: { ...clientBase, ...productBase, cta_type: safeCodeSchema, surface: safeCodeSchema }
  }),
  checkout_started: defineEvent({
    eventName: "checkout_started", emittingLayer: "frontend",
    required: { ...clientBase, checkout_flow_id: uuidSchema, ...productBase, entry_point: safeCodeSchema, ...clientDevice }
  }),
  payment_return_viewed: defineEvent({
    eventName: "payment_return_viewed", emittingLayer: "frontend",
    required: { ...clientBase, order_public_id_hash: entityFields.order_public_id_hash, payment_provider: paymentProviderSchema, payment_environment: paymentEnvironmentSchema, payment_status: paymentStatusSchema },
    optional: { payment_attempt_public_id_hash: entityFields.payment_attempt_public_id_hash }
  }),
  access_claim_started: defineEvent({
    eventName: "access_claim_started", emittingLayer: "frontend",
    required: { ...clientBase, ...productBase, claim_method: z.enum(["access_code", "recovery"]) }
  }),
  attempt_submit_started: defineEvent({
    eventName: "attempt_submit_started", emittingLayer: "frontend",
    required: { ...clientBase, attempt_public_id_hash: entityFields.attempt_public_id_hash, exam_mode: examModeSchema, ...attemptCounts }
  }),
  result_viewed: defineEvent({
    eventName: "result_viewed", emittingLayer: "frontend",
    required: { ...clientBase, attempt_public_id_hash: entityFields.attempt_public_id_hash, access_public_id_hash: entityFields.access_public_id_hash, ...productBase, result_view_context: safeCodeSchema, ...clientDevice }
  }),
  client_error_shown: defineEvent({
    eventName: "client_error_shown", emittingLayer: "frontend",
    required: { ...clientBase, error_category: errorCategorySchema, failure_stage: safeCodeSchema, error_code: safeCodeSchema, retry_available: booleanSchema, ...clientDevice },
    optional: { ...entityFields, repeat_bucket: safeCodeSchema }
  }),

  order_created: defineEvent({
    eventName: "order_created", emittingLayer: "backend",
    required: { checkout_flow_id: uuidSchema, order_public_id_hash: entityFields.order_public_id_hash, ...productBase, order_status: z.literal("created"), access_source: z.literal("paid") }
  }),
  payment_session_created: defineEvent({
    eventName: "payment_session_created", emittingLayer: "backend",
    required: { ...paymentBase, payment_status: z.literal("pending") }
  }),
  payment_pending: defineEvent({
    eventName: "payment_pending", emittingLayer: "backend",
    required: { ...paymentBase, payment_status: z.literal("pending") }
  }),
  payment_confirmed: defineEvent({
    eventName: "payment_confirmed", emittingLayer: "backend",
    required: { ...paymentBase, payment_status: z.literal("paid"), verification_method: verificationMethodSchema }
  }),
  payment_failed: defineEvent({
    eventName: "payment_failed", emittingLayer: "backend",
    required: { ...paymentBase, payment_status: z.literal("failed"), failure_reason_code: safeCodeSchema }
  }),
  payment_cancelled: defineEvent({
    eventName: "payment_cancelled", emittingLayer: "backend",
    required: { ...paymentBase, payment_status: z.literal("cancelled"), cancel_source: safeCodeSchema }
  }),
  payment_expired: defineEvent({
    eventName: "payment_expired", emittingLayer: "backend",
    required: { ...paymentBase, payment_status: z.literal("expired") }
  }),
  payment_validation_failed: defineEvent({
    eventName: "payment_validation_failed", emittingLayer: "backend",
    required: { payment_provider: paymentProviderSchema, payment_environment: paymentEnvironmentSchema, error_category: z.literal("payment_verification_error"), validation_reason: z.enum(["invalid_callback_signal", "invalid_signature", "merchant_reference_mismatch", "provider_mismatch", "amount_mismatch", "currency_mismatch", "provider_payment_id_conflict", "illegal_status_transition", "status_verification_unavailable"]) },
    optional: { order_public_id_hash: entityFields.order_public_id_hash, payment_attempt_public_id_hash: entityFields.payment_attempt_public_id_hash }
  }),
  access_granted: defineEvent({
    eventName: "access_granted", emittingLayer: "backend",
    required: { access_public_id_hash: entityFields.access_public_id_hash, ...productBase, access_source: accessSourceSchema, grant_reason: safeCodeSchema },
    optional: { order_public_id_hash: entityFields.order_public_id_hash, payment_attempt_public_id_hash: entityFields.payment_attempt_public_id_hash },
    refine: (value, ctx) => {
      const paid = value.access_source === "paid";
      if (paid !== (value.order_public_id_hash !== undefined)) {
        ctx.addIssue({ code: "custom", message: "paid access requires exactly one order link", path: ["order_public_id_hash"] });
      }
      if (!paid && value.payment_attempt_public_id_hash !== undefined) {
        ctx.addIssue({ code: "custom", message: "non-paid access cannot include payment link", path: ["payment_attempt_public_id_hash"] });
      }
    }
  }),
  access_claim_completed: defineEvent({
    eventName: "access_claim_completed", emittingLayer: "backend",
    required: { access_public_id_hash: entityFields.access_public_id_hash, ...productBase, claim_method: z.enum(["access_code", "recovery"]), access_source: accessSourceSchema }
  }),
  access_claim_failed: defineEvent({
    eventName: "access_claim_failed", emittingLayer: "backend",
    required: { ...productBase, claim_method: z.enum(["access_code", "recovery"]), error_category: errorCategorySchema, failure_reason_code: safeCodeSchema },
    optional: { access_public_id_hash: entityFields.access_public_id_hash }
  }),
  existing_access_detected: defineEvent({
    eventName: "existing_access_detected", emittingLayer: "backend",
    required: { access_public_id_hash: entityFields.access_public_id_hash, ...productBase, access_source: accessSourceSchema },
    optional: { attempt_public_id_hash: entityFields.attempt_public_id_hash, attempt_status: attemptStatusSchema }
  }),
  attempt_started: defineEvent({
    eventName: "attempt_started", emittingLayer: "backend",
    required: { access_public_id_hash: entityFields.access_public_id_hash, attempt_public_id_hash: entityFields.attempt_public_id_hash, ...productBase, access_source: accessSourceSchema, attempt_status: z.literal("active"), ...clientDevice }
  }),
  answer_save_succeeded: defineEvent({
    eventName: "answer_save_succeeded", emittingLayer: "backend",
    required: { attempt_public_id_hash: entityFields.attempt_public_id_hash, save_operation_id: uuidSchema, save_mode: safeCodeSchema, attempt_status: z.literal("active") },
    optional: { latency_bucket: latencyBucketSchema }
  }),
  answer_save_failed: defineEvent({
    eventName: "answer_save_failed", emittingLayer: "backend",
    required: { attempt_public_id_hash: entityFields.attempt_public_id_hash, save_operation_id: uuidSchema, save_mode: safeCodeSchema, error_category: errorCategorySchema, failure_stage: z.literal("answer_save") }
  }),
  attempt_resumed: defineEvent({
    eventName: "attempt_resumed", emittingLayer: "backend",
    required: { access_public_id_hash: entityFields.access_public_id_hash, attempt_public_id_hash: entityFields.attempt_public_id_hash, ...productBase, attempt_status: z.literal("active"), resume_method: safeCodeSchema }
  }),
  attempt_expired: defineEvent({
    eventName: "attempt_expired", emittingLayer: "backend",
    required: { attempt_public_id_hash: entityFields.attempt_public_id_hash, access_public_id_hash: entityFields.access_public_id_hash, exam_mode: examModeSchema, attempt_status: z.literal("expired"), completion_reason: z.literal("timer_expired"), ...attemptCounts }
  }),
  attempt_completed: defineEvent({
    eventName: "attempt_completed", emittingLayer: "backend",
    required: { attempt_public_id_hash: entityFields.attempt_public_id_hash, access_public_id_hash: entityFields.access_public_id_hash, ...productBase, attempt_status: z.literal("completed"), completion_reason: completionReasonSchema, duration_bucket: durationBucketSchema, ...attemptCounts }
  }),
  attempt_completion_failed: defineEvent({
    eventName: "attempt_completion_failed", emittingLayer: "backend",
    required: { attempt_public_id_hash: entityFields.attempt_public_id_hash, access_public_id_hash: entityFields.access_public_id_hash, exam_mode: examModeSchema, error_category: errorCategorySchema, failure_stage: z.literal("attempt_completion"), completion_reason: completionReasonSchema, error_event_id: uuidSchema }
  }),
  backend_operation_failed: defineEvent({
    eventName: "backend_operation_failed", emittingLayer: "backend",
    required: { error_event_id: uuidSchema, error_category: errorCategorySchema, failure_stage: safeCodeSchema, error_code: safeCodeSchema, retryable: booleanSchema, severity: z.enum(["sev0", "sev1", "sev2", "sev3"]) },
    optional: entityFields
  }),

  paid_without_access_detected: defineEvent({
    eventName: "paid_without_access_detected", emittingLayer: "derived",
    required: { ...paymentBase, failure_stage: z.literal("access_grant"), detection_delay_bucket: latencyBucketSchema }
  }),
  paid_without_access_resolved: defineEvent({
    eventName: "paid_without_access_resolved", emittingLayer: "derived",
    required: { ...paymentBase, resolution_type: resolutionTypeSchema, resolution_delay_bucket: resolutionDelayBucketSchema },
    optional: { access_public_id_hash: entityFields.access_public_id_hash }
  }),
  result_reopened: defineEvent({
    eventName: "result_reopened", emittingLayer: "derived",
    required: { attempt_public_id_hash: entityFields.attempt_public_id_hash, access_public_id_hash: entityFields.access_public_id_hash, exam_mode: examModeSchema, reopen_sequence_bucket: safeCodeSchema, result_view_context: safeCodeSchema }
  })
} as const;

export type AnalyticsEventName = keyof typeof analyticsEventRegistry;
export type AnalyticsEmittingLayer = Layer;
export type AnalyticsEventProperties<Name extends AnalyticsEventName> =
  z.infer<(typeof analyticsEventRegistry)[Name]["propertiesSchema"]>;
export type CanonicalAnalyticsEvent<Name extends AnalyticsEventName = AnalyticsEventName> = Name extends AnalyticsEventName
  ? Readonly<{
      event_id: string;
      event_name: Name;
      event_version: typeof ANALYTICS_EVENT_VERSION;
      occurred_at: string;
      received_at: string;
      environment: (typeof ANALYTICS_ENVIRONMENTS)[number];
      traffic_class: (typeof TRAFFIC_CLASSES)[number];
      traffic_class_assignment_source: (typeof TRAFFIC_CLASS_ASSIGNMENT_SOURCES)[number];
      emitting_layer: (typeof analyticsEventRegistry)[Name]["emittingLayer"];
      analytics_id_key_version?: string;
      properties: AnalyticsEventProperties<Name>;
    }>
  : never;
export type FrontendAnalyticsEventName = {
  [Name in AnalyticsEventName]: (typeof analyticsEventRegistry)[Name]["emittingLayer"] extends "frontend" ? Name : never
}[AnalyticsEventName];
export type FrontendAnalyticsInput<Name extends FrontendAnalyticsEventName = FrontendAnalyticsEventName> =
  Omit<CanonicalAnalyticsEvent<Name>, "received_at" | "traffic_class" | "traffic_class_assignment_source"> &
  Readonly<{ traffic_class_hint?: (typeof TRAFFIC_CLASSES)[number] }>;

export const analyticsEventNames = Object.freeze(Object.keys(analyticsEventRegistry) as AnalyticsEventName[]);
export const frontendAnalyticsEventNames = Object.freeze(analyticsEventNames.filter((name) => analyticsEventRegistry[name].emittingLayer === "frontend"));
export const backendAnalyticsEventNames = Object.freeze(analyticsEventNames.filter((name) => analyticsEventRegistry[name].emittingLayer === "backend"));
export const derivedAnalyticsEventNames = Object.freeze(analyticsEventNames.filter((name) => analyticsEventRegistry[name].emittingLayer === "derived"));

export type AnalyticsValidationErrorCategory = "contract" | "privacy";
export type AnalyticsValidationError = Readonly<{
  code: "UNKNOWN_EVENT" | "INVALID_EVENT" | "PRIVACY_REJECTED";
  category: AnalyticsValidationErrorCategory;
  eventName?: AnalyticsEventName;
  path: string;
}>;
export type AnalyticsValidationResult<T = unknown> =
  | Readonly<{ success: true; data: T }>
  | Readonly<{ success: false; error: AnalyticsValidationError }>;

export class AnalyticsContractError extends Error {
  constructor(readonly detail: AnalyticsValidationError) {
    super(`ANALYTICS_EVENT_REJECTED:${detail.code}:${detail.path}`);
    this.name = "AnalyticsContractError";
  }
}

function recognizedEventName(value: unknown): AnalyticsEventName | undefined {
  if (!value || typeof value !== "object") return undefined;
  const name = (value as Record<string, unknown>).event_name;
  return typeof name === "string" && name in analyticsEventRegistry ? name as AnalyticsEventName : undefined;
}

function safeZodPath(error: z.ZodError) {
  const path = error.issues[0]?.path ?? [];
  return path.length === 0 ? "$" : `$.${path.map((segment) => typeof segment === "number" ? `[${segment}]` : segment).join(".")}`;
}

function validateProperties(name: AnalyticsEventName, properties: unknown) {
  return analyticsEventRegistry[name].propertiesSchema.safeParse(properties);
}

const canonicalEnvelopeSchema = z.object({
  event_id: uuidSchema,
  event_name: z.string(),
  event_version: z.literal(ANALYTICS_EVENT_VERSION),
  occurred_at: utcIsoTimestampSchema,
  received_at: utcIsoTimestampSchema,
  environment: environmentSchema,
  traffic_class: trafficClassSchema,
  traffic_class_assignment_source: assignmentSourceSchema,
  emitting_layer: z.enum(ANALYTICS_EMITTING_LAYERS),
  analytics_id_key_version: analyticsIdKeyVersionSchema.optional(),
  properties: z.unknown()
}).strict();

const frontendEnvelopeSchema = z.object({
  event_id: uuidSchema,
  event_name: z.string(),
  event_version: z.literal(ANALYTICS_EVENT_VERSION),
  occurred_at: utcIsoTimestampSchema,
  environment: environmentSchema,
  emitting_layer: z.literal("frontend"),
  traffic_class_hint: trafficClassSchema.optional(),
  analytics_id_key_version: analyticsIdKeyVersionSchema.optional(),
  properties: z.unknown()
}).strict();

function entityVersionIsValid(definition: (typeof analyticsEventRegistry)[AnalyticsEventName], event: Record<string, unknown>) {
  const properties = event.properties as Record<string, unknown>;
  const hasEntityId = definition.entityAnalyticsIds.some((key) => properties[key] !== undefined);
  return hasEntityId === (event.analytics_id_key_version !== undefined);
}

function privacyFailure(value: unknown, eventName?: AnalyticsEventName): AnalyticsValidationResult | null {
  const privacy = scanAnalyticsPrivacy(value);
  if (privacy.success) return null;
  return { success: false, error: { code: "PRIVACY_REJECTED", category: "privacy", eventName, path: privacy.error.path } };
}

export function validateCanonicalAnalyticsEvent(value: unknown): AnalyticsValidationResult {
  const eventName = recognizedEventName(value);
  const privacy = privacyFailure(value, eventName);
  if (privacy) return privacy;
  if (!eventName) {
    return { success: false, error: { code: "UNKNOWN_EVENT", category: "contract", path: "$.event_name" } };
  }
  const envelope = canonicalEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return { success: false, error: { code: "INVALID_EVENT", category: "contract", eventName, path: safeZodPath(envelope.error) } };
  }
  const definition = analyticsEventRegistry[eventName];
  if (envelope.data.emitting_layer !== definition.emittingLayer ||
      !isValidAnalyticsTrafficAssignment(envelope.data.traffic_class, envelope.data.traffic_class_assignment_source)) {
    return { success: false, error: { code: "INVALID_EVENT", category: "contract", eventName, path: "$.emitting_layer" } };
  }
  const properties = validateProperties(eventName, envelope.data.properties);
  if (!properties.success) {
    return { success: false, error: { code: "INVALID_EVENT", category: "contract", eventName, path: `$.properties${safeZodPath(properties.error).slice(1)}` } };
  }
  if (!entityVersionIsValid(definition, envelope.data)) {
    return { success: false, error: { code: "INVALID_EVENT", category: "contract", eventName, path: "$.analytics_id_key_version" } };
  }
  return { success: true, data: { ...envelope.data, event_name: eventName, properties: properties.data } };
}

export function validateFrontendAnalyticsInput(value: unknown): AnalyticsValidationResult {
  const eventName = recognizedEventName(value);
  const privacy = privacyFailure(value, eventName);
  if (privacy) return privacy;
  if (!eventName || analyticsEventRegistry[eventName].emittingLayer !== "frontend") {
    return { success: false, error: { code: "UNKNOWN_EVENT", category: "contract", path: "$.event_name" } };
  }
  const envelope = frontendEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return { success: false, error: { code: "INVALID_EVENT", category: "contract", eventName, path: safeZodPath(envelope.error) } };
  }
  const properties = validateProperties(eventName, envelope.data.properties);
  if (!properties.success) {
    return { success: false, error: { code: "INVALID_EVENT", category: "contract", eventName, path: `$.properties${safeZodPath(properties.error).slice(1)}` } };
  }
  if (!entityVersionIsValid(analyticsEventRegistry[eventName], envelope.data)) {
    return { success: false, error: { code: "INVALID_EVENT", category: "contract", eventName, path: "$.analytics_id_key_version" } };
  }
  return { success: true, data: { ...envelope.data, event_name: eventName, properties: properties.data } };
}

export function parseAnalyticsEvent(value: unknown): CanonicalAnalyticsEvent {
  const result = validateCanonicalAnalyticsEvent(value);
  if (!result.success) throw new AnalyticsContractError(result.error);
  return result.data as CanonicalAnalyticsEvent;
}

export const checkoutStartedPropertiesSchema = analyticsEventRegistry.checkout_started.propertiesSchema;
export const orderCreatedPropertiesSchema = analyticsEventRegistry.order_created.propertiesSchema;
export const paymentConfirmedPropertiesSchema = analyticsEventRegistry.payment_confirmed.propertiesSchema;
export const accessGrantedPropertiesSchema = analyticsEventRegistry.access_granted.propertiesSchema;
export const paymentValidationFailedPropertiesSchema = analyticsEventRegistry.payment_validation_failed.propertiesSchema;
export const backendOperationFailedPropertiesSchema = analyticsEventRegistry.backend_operation_failed.propertiesSchema;
