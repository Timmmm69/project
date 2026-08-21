import type { Prisma } from "@prisma/client";
import {
  AnalyticsContractError,
  validateCanonicalAnalyticsEvent,
  type CanonicalAnalyticsEvent
} from "@/lib/analytics/event-contract";
import { prisma } from "@/server/db/client";

export type CanonicalAnalyticsPersistenceInput = Readonly<{
  transitionKey: string;
  event: CanonicalAnalyticsEvent;
}>;

export type CanonicalAnalyticsPersistenceResult = Readonly<{
  inserted: boolean;
}>;

export type CanonicalAnalyticsEventStore = Readonly<{
  createMany(input: {
    data: readonly CanonicalAnalyticsEventRow[];
    skipDuplicates: true;
  }): Promise<{ count: number }>;
}>;

export type CanonicalAnalyticsEventRow = Readonly<{
  eventId: string;
  transitionKey: string;
  eventName: string;
  eventVersion: number;
  occurredAt: Date;
  receivedAt: Date;
  environment: string;
  trafficClass: string;
  trafficClassAssignmentSource: string;
  emittingLayer: string;
  analyticsIdKeyVersion?: string;
  properties: Prisma.InputJsonValue;
}>;

const defaultStore: CanonicalAnalyticsEventStore = {
  createMany(input) {
    return prisma.analyticsEvent.createMany({
      data: [...input.data],
      skipDuplicates: input.skipDuplicates
    });
  }
};

function assertValidTransitionKey(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    value.trim().length === 0
  ) {
    throw new AnalyticsContractError({
      code: "INVALID_EVENT",
      category: "contract",
      path: "$.transitionKey"
    });
  }
}

export async function persistCanonicalAnalyticsEvent(
  input: CanonicalAnalyticsPersistenceInput,
  store: CanonicalAnalyticsEventStore = defaultStore
): Promise<CanonicalAnalyticsPersistenceResult> {
  assertValidTransitionKey(input.transitionKey);

  const validation = validateCanonicalAnalyticsEvent(input.event);
  if (!validation.success) {
    throw new AnalyticsContractError(validation.error);
  }

  const event = validation.data as CanonicalAnalyticsEvent;
  const row: CanonicalAnalyticsEventRow = {
    eventId: event.event_id,
    transitionKey: input.transitionKey,
    eventName: event.event_name,
    eventVersion: event.event_version,
    occurredAt: new Date(event.occurred_at),
    receivedAt: new Date(event.received_at),
    environment: event.environment,
    trafficClass: event.traffic_class,
    trafficClassAssignmentSource: event.traffic_class_assignment_source,
    emittingLayer: event.emitting_layer,
    ...(event.analytics_id_key_version === undefined
      ? {}
      : { analyticsIdKeyVersion: event.analytics_id_key_version }),
    properties: event.properties as Prisma.InputJsonValue
  };

  const result = await store.createMany({
    data: [row],
    skipDuplicates: true
  });

  if (result.count === 1) return { inserted: true };
  if (result.count === 0) return { inserted: false };
  throw new Error("ANALYTICS_PERSISTENCE_INVALID_STORE_COUNT");
}
