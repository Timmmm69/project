import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { analyticsConfig } from "@/lib/analytics/analytics-id";
import { assertNoForbiddenAnalyticsPayload } from "@/lib/analytics/forbidden-payload";
import { parseAnalyticsEvent, type AnalyticsEventName } from "@/lib/analytics/schemas";
import { prisma } from "@/server/db/client";

type TrustedTrafficContext = "external_user" | "synthetic_test_fixture";

export type AnalyticsWriteInput = {
  eventName: AnalyticsEventName;
  transitionKey: string;
  occurredAt: Date;
  analyticsIdKeyVersion?: string;
  properties: Record<string, unknown>;
  trafficContext?: TrustedTrafficContext;
};

export type AnalyticsWriter = (input: AnalyticsWriteInput) => Promise<{ enabled: boolean; inserted: boolean }>;

function environment() {
  if (process.env.NODE_ENV === "production") return "production" as const;
  if (process.env.NODE_ENV === "test") return "test" as const;
  return "development" as const;
}

/**
 * Persists a canonical first-party event. Callers must invoke it only after the
 * relevant domain transaction commits; this function deliberately owns no
 * payment/access transaction client.
 */
export const writeAnalyticsEvent: AnalyticsWriter = async (input) => {
  const config = analyticsConfig();
  if (!config.enabled) return { enabled: false, inserted: false };
  assertNoForbiddenAnalyticsPayload(input.properties);
  const receivedAt = new Date();
  const synthetic = input.trafficContext === "synthetic_test_fixture";
  const event = parseAnalyticsEvent({
    event_id: randomUUID(),
    event_name: input.eventName,
    event_version: 1,
    occurred_at: input.occurredAt,
    received_at: receivedAt,
    environment: environment(),
    traffic_class: synthetic ? "synthetic" : "external_user",
    traffic_class_assignment_source: synthetic ? "test_fixture" : "default_external_user",
    emitting_layer: "backend",
    ...(input.analyticsIdKeyVersion ? { analytics_id_key_version: input.analyticsIdKeyVersion } : {}),
    properties: input.properties
  });
  const result = await prisma.analyticsEvent.createMany({
    data: [{
      eventId: event.event_id,
      transitionKey: input.transitionKey,
      eventName: event.event_name,
      eventVersion: event.event_version,
      occurredAt: event.occurred_at,
      receivedAt: event.received_at,
      environment: event.environment,
      trafficClass: event.traffic_class,
      trafficClassAssignmentSource: event.traffic_class_assignment_source,
      emittingLayer: event.emitting_layer,
      analyticsIdKeyVersion: event.analytics_id_key_version,
      properties: event.properties as Prisma.InputJsonValue
    }],
    skipDuplicates: true
  });
  return { enabled: true, inserted: result.count === 1 };
};

/** Analytics must never replace a committed domain result or provider error. */
export async function safelyWriteAnalyticsEvent(input: AnalyticsWriteInput, writer: AnalyticsWriter = writeAnalyticsEvent) {
  try {
    return await writer(input);
  } catch {
    // Intentionally no error detail: analytics failures are operational-only and
    // must not leak secrets, raw provider data, or exception text.
    return { enabled: false, inserted: false } as const;
  }
}
