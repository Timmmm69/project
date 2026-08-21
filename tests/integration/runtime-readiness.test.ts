import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import {
  evaluateRuntimeReadiness,
  probePostgresReadiness,
  type ReadinessEnvironment
} from "@/server/runtime-readiness/runtime-readiness";

const shouldRun = process.env.RUN_INF01B_READINESS_INTEGRATION === "true";
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
    APP_URL: "https://readiness.integration.invalid",
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: encodedBytes(29),
    ACCESS_CODE_HASH_PEPPER: encodedBytes(113)
  });
}

describeIntegration("INF-01B runtime readiness PostgreSQL integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("passes one real read-only probe and does not alter synthetic product data", async () => {
    const before = await prisma.test.count();
    const databaseProbe = vi.fn(probePostgresReadiness);

    await expect(evaluateRuntimeReadiness(
      syntheticEnvironment(),
      databaseProbe,
      async () => true
    )).resolves.toEqual({ status: "READY" });

    const after = await prisma.test.count();
    expect(databaseProbe).toHaveBeenCalledTimes(1);
    expect(after).toBe(before);
  });

  it("maps an injected database rejection to the closed unavailable result", async () => {
    await expect(evaluateRuntimeReadiness(
      syntheticEnvironment(),
      async () => {
        throw new Error("synthetic database rejection");
      },
      async () => true
    )).resolves.toEqual({
      status: "NOT_READY",
      reason: "DATABASE_UNAVAILABLE"
    });
  });
});
