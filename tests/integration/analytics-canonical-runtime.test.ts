import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeCanonicalBackendAnalyticsEvent } from "@/lib/analytics/canonical-runtime";
import type { CanonicalBackendRuntimeInput } from "@/lib/analytics/canonical-runtime";
import { prisma } from "@/server/db/client";

const shouldRun = process.env.RUN_ANALYTICS_CANONICAL_RUNTIME_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;

const eventId = "a6a00000-0000-4000-8000-000000000001";
const checkoutFlowId = "a6a00000-0000-4000-8000-000000000002";
const occurredAt = "2026-07-16T10:00:00.000Z";
const receivedAt = "2026-07-16T10:00:01.000Z";
const transitionKey = "ana-rt-06a:synthetic:order-created:dedupe";
const entityId = `aid1.${"S".repeat(43)}`;

const properties = Object.freeze({
  checkout_flow_id: checkoutFlowId,
  order_public_id_hash: entityId,
  product_id: "ana-rt-06a-product",
  test_id: "ana-rt-06a-test",
  exam_mode: "rikz_russian_2026" as const,
  order_status: "created" as const,
  access_source: "paid" as const
});

const input: CanonicalBackendRuntimeInput<"order_created"> = Object.freeze({
  transitionKey,
  producerEvent: Object.freeze({
    event_id: eventId,
    event_name: "order_created",
    event_version: 1,
    occurred_at: occurredAt,
    analytics_id_key_version: "v1",
    properties
  }),
  receiverContext: Object.freeze({
    environment: "test",
    receivedAt,
    trustedTrafficContext: Object.freeze({
      kind: "test_fixture",
      trafficClass: "synthetic"
    })
  })
});

function assertDedicatedLocalTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("ANA_RT_06A_INTEGRATION_DATABASE_URL_REQUIRED");
  }

  const parsed = new URL(databaseUrl);
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("ANA_RT_06A_INTEGRATION_REQUIRES_POSTGRESQL");
  }
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname)) {
    throw new Error("ANA_RT_06A_INTEGRATION_REQUIRES_LOCAL_DATABASE");
  }

  const schema = parsed.searchParams.get("schema");
  if (!schema || !/^ana_rt_06a_[a-z0-9_]+$/.test(schema)) {
    throw new Error("ANA_RT_06A_INTEGRATION_REQUIRES_DEDICATED_SCHEMA");
  }
  if (/prod/i.test(`${parsed.pathname}:${schema}`)) {
    throw new Error("ANA_RT_06A_INTEGRATION_REJECTS_PRODUCTION_DATABASE");
  }
}

async function cleanSyntheticFixture() {
  await prisma.analyticsEvent.deleteMany({
    where: {
      OR: [
        { eventId },
        { transitionKey }
      ]
    }
  });
}

describeWithDatabase("canonical backend analytics runtime PostgreSQL integration", () => {
  beforeAll(async () => {
    assertDedicatedLocalTestDatabase();
    await cleanSyntheticFixture();
  });

  afterAll(async () => {
    if (shouldRun) {
      await cleanSyntheticFixture();
    }
    await prisma.$disconnect();
  });

  it("persists one exact canonical row and deduplicates the repeated event", async () => {
    await expect(writeCanonicalBackendAnalyticsEvent(input))
      .resolves.toEqual({ inserted: true });

    const row = await prisma.analyticsEvent.findUniqueOrThrow({
      where: { eventId }
    });
    expect(row).toMatchObject({
      eventId,
      transitionKey,
      eventName: "order_created",
      eventVersion: 1,
      occurredAt: new Date(occurredAt),
      receivedAt: new Date(receivedAt),
      environment: "test",
      trafficClass: "synthetic",
      trafficClassAssignmentSource: "test_fixture",
      emittingLayer: "backend",
      analyticsIdKeyVersion: "v1",
      properties
    });

    await expect(writeCanonicalBackendAnalyticsEvent(input))
      .resolves.toEqual({ inserted: false });

    await expect(prisma.analyticsEvent.count({
      where: {
        OR: [
          { eventId },
          { transitionKey }
        ]
      }
    })).resolves.toBe(1);
  });
});
