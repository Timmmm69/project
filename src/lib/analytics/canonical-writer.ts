import {
  ANALYTICS_ENVIRONMENTS,
  analyticsEventRegistry,
  validateCanonicalAnalyticsEvent,
  validateFrontendAnalyticsInput,
  type AnalyticsEventName,
  type AnalyticsValidationResult,
  type CanonicalAnalyticsEvent,
  type FrontendAnalyticsInput
} from "@/lib/analytics/event-contract";
import { scanAnalyticsPrivacy } from "@/lib/analytics/privacy-scan";
import {
  assignAnalyticsTrafficClass,
  type TrustedAnalyticsTrafficContext
} from "@/lib/analytics/traffic-class";

export type BackendAnalyticsEventName = {
  [Name in AnalyticsEventName]: (typeof analyticsEventRegistry)[Name]["emittingLayer"] extends "backend" ? Name : never
}[AnalyticsEventName];

export type TrustedBackendAnalyticsInput<
  Name extends BackendAnalyticsEventName = BackendAnalyticsEventName
> = Name extends BackendAnalyticsEventName
  ? Pick<
      CanonicalAnalyticsEvent<Name>,
      "event_id" | "event_name" | "event_version" | "occurred_at" | "analytics_id_key_version" | "properties"
    >
  : never;

export type AnalyticsReceiverContext = Readonly<{
  environment: (typeof ANALYTICS_ENVIRONMENTS)[number];
  receivedAt: string;
  trustedTrafficContext?: TrustedAnalyticsTrafficContext;
}>;

const forbiddenBackendProducerFields = [
  "received_at",
  "environment",
  "emitting_layer",
  "traffic_class",
  "traffic_class_assignment_source",
  "traffic_class_hint"
] as const;

function recognizedBackendEventName(value: unknown): BackendAnalyticsEventName | undefined {
  if (!value || typeof value !== "object") return undefined;
  const eventName = (value as Record<string, unknown>).event_name;
  if (typeof eventName !== "string" || !(eventName in analyticsEventRegistry)) return undefined;
  const recognizedName = eventName as AnalyticsEventName;
  return analyticsEventRegistry[recognizedName].emittingLayer === "backend"
    ? recognizedName as BackendAnalyticsEventName
    : undefined;
}

function canonicalValidation(value: unknown): AnalyticsValidationResult<CanonicalAnalyticsEvent> {
  return validateCanonicalAnalyticsEvent(value) as AnalyticsValidationResult<CanonicalAnalyticsEvent>;
}

export function buildCanonicalFrontendAnalyticsEvent(
  value: unknown,
  context: AnalyticsReceiverContext
): AnalyticsValidationResult<CanonicalAnalyticsEvent> {
  const frontendValidation = validateFrontendAnalyticsInput(value);
  if (!frontendValidation.success) return frontendValidation;

  const validatedInput = frontendValidation.data as FrontendAnalyticsInput;
  const { traffic_class_hint: clientHint, ...producerFields } = validatedInput;
  const trafficAssignment = assignAnalyticsTrafficClass({
    clientHint,
    trustedContext: context.trustedTrafficContext
  });

  return canonicalValidation({
    ...producerFields,
    received_at: context.receivedAt,
    environment: context.environment,
    emitting_layer: "frontend",
    ...trafficAssignment
  });
}

export function buildCanonicalBackendAnalyticsEvent(
  value: unknown,
  context: AnalyticsReceiverContext
): AnalyticsValidationResult<CanonicalAnalyticsEvent> {
  const privacy = scanAnalyticsPrivacy(value);
  if (!privacy.success) {
    const eventName = recognizedBackendEventName(value);
    return {
      success: false,
      error: {
        code: "PRIVACY_REJECTED",
        category: "privacy",
        ...(eventName ? { eventName } : {}),
        path: privacy.error.path
      }
    };
  }

  const eventName = recognizedBackendEventName(value);
  if (!eventName) {
    return {
      success: false,
      error: { code: "UNKNOWN_EVENT", category: "contract", path: "$.event_name" }
    };
  }

  const producerInput = value as Record<string, unknown>;
  for (const field of forbiddenBackendProducerFields) {
    if (Object.prototype.hasOwnProperty.call(producerInput, field)) {
      return {
        success: false,
        error: {
          code: "INVALID_EVENT",
          category: "contract",
          eventName,
          path: `$.${field}`
        }
      };
    }
  }

  const trafficAssignment = assignAnalyticsTrafficClass({
    trustedContext: context.trustedTrafficContext
  });

  return canonicalValidation({
    ...producerInput,
    received_at: context.receivedAt,
    environment: context.environment,
    emitting_layer: "backend",
    ...trafficAssignment
  });
}
