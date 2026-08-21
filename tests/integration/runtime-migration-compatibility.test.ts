import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import {
  isMigrationStateCompatible,
  probeMigrationCompatibility,
  type MigrationMetadataRow
} from "@/server/runtime-readiness/migration-compatibility";
import { migrationManifest } from "@/server/runtime-readiness/migration-manifest";
import {
  evaluateRuntimeReadiness,
  probePostgresReadiness,
  type ReadinessEnvironment
} from "@/server/runtime-readiness/runtime-readiness";

const shouldRun = process.env.RUN_INF01C_MIGRATION_COMPATIBILITY_INTEGRATION === "true";
const describeIntegration = shouldRun ? describe : describe.skip;

function encodedBytes(seed: number) {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => (
    (seed + index * 29) % 256
  ))).toString("base64url");
}

function syntheticEnvironment(): ReadinessEnvironment {
  return Object.freeze({
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_URL: "https://migration-readiness.integration.invalid",
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: encodedBytes(43),
    ACCESS_CODE_HASH_PEPPER: encodedBytes(127)
  });
}

async function readMigrationMetadata() {
  return prisma.$queryRaw<MigrationMetadataRow[]>`
    SELECT
      "migration_name",
      "checksum",
      "finished_at",
      "rolled_back_at",
      "applied_steps_count"
    FROM "_prisma_migrations"
    ORDER BY "started_at", "id"
  `;
}

describeIntegration("INF-01C migration compatibility PostgreSQL integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("matches the real Prisma migration history to the canonical manifest", async () => {
    const rows = await readMigrationMetadata();

    expect(isMigrationStateCompatible(rows)).toBe(true);
    expect(rows.map((row) => ({
      migrationName: row.migration_name,
      checksum: row.checksum
    }))).toEqual(migrationManifest);
  });

  it("uses the canonical production probe read-only without changing product data", async () => {
    const productCountBefore = await prisma.test.count();
    const metadataBefore = await readMigrationMetadata();

    await expect(probeMigrationCompatibility()).resolves.toBe(true);

    const productCountAfter = await prisma.test.count();
    const metadataAfter = await readMigrationMetadata();
    expect(productCountAfter).toBe(productCountBefore);
    expect(metadataAfter).toEqual(metadataBefore);
  });

  it("returns READY through the full ordered readiness primitive", async () => {
    const databaseProbe = vi.fn(probePostgresReadiness);
    const migrationProbe = vi.fn(probeMigrationCompatibility);

    await expect(evaluateRuntimeReadiness(
      syntheticEnvironment(),
      databaseProbe,
      migrationProbe
    )).resolves.toEqual({ status: "READY" });
    expect(databaseProbe).toHaveBeenCalledTimes(1);
    expect(migrationProbe).toHaveBeenCalledTimes(1);
  });

  it("maps an injected incompatibility to the closed internal outcome", async () => {
    await expect(evaluateRuntimeReadiness(
      syntheticEnvironment(),
      async () => true,
      async () => false
    )).resolves.toEqual({
      status: "NOT_READY",
      reason: "MIGRATION_INCOMPATIBLE"
    });
  });
});
