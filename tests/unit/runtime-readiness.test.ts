import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GET as getLiveness } from "@/app/api/health/route";
import { createReadinessHandler } from "@/app/api/health/ready/route";
import {
  evaluateRuntimeReadiness,
  type DatabaseReadinessProbe,
  type ReadinessEnvironment
} from "@/server/runtime-readiness/runtime-readiness";

function encodedBytes(seed: number) {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => (
    (seed + index * 29) % 256
  ))).toString("base64url");
}

function validEnvironment(
  overrides: Record<string, string | undefined> = {}
): ReadinessEnvironment {
  return Object.freeze({
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_URL: "https://readiness.invalid",
    DATABASE_URL: "postgresql://readiness.invalid/readiness",
    SESSION_SECRET: encodedBytes(17),
    ACCESS_CODE_HASH_PEPPER: encodedBytes(83),
    ...overrides
  });
}

function readinessHandler(
  environment: ReadinessEnvironment,
  databaseProbe: DatabaseReadinessProbe
) {
  return createReadinessHandler({
    getEnvironment: () => environment,
    databaseProbe
  });
}

const notReadyBody = {
  success: false,
  error: {
    code: "SERVICE_NOT_READY",
    message: "Service is not ready."
  }
};

describe("runtime readiness primitive", () => {
  it("returns READY for valid configuration and one successful database probe", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(true);

    await expect(evaluateRuntimeReadiness(validEnvironment(), databaseProbe)).resolves.toEqual({
      status: "READY"
    });
    expect(databaseProbe).toHaveBeenCalledTimes(1);
  });

  it("fails closed for invalid configuration without calling the database", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(true);

    await expect(evaluateRuntimeReadiness(
      validEnvironment({ APP_URL: "http://readiness.invalid" }),
      databaseProbe
    )).resolves.toEqual({
      status: "NOT_READY",
      reason: "CONFIGURATION_INVALID"
    });
    expect(databaseProbe).not.toHaveBeenCalled();
  });

  it("maps a false database probe to DATABASE_UNAVAILABLE", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(false);

    await expect(evaluateRuntimeReadiness(validEnvironment(), databaseProbe)).resolves.toEqual({
      status: "NOT_READY",
      reason: "DATABASE_UNAVAILABLE"
    });
    expect(databaseProbe).toHaveBeenCalledTimes(1);
  });

  it("maps a rejected database probe to DATABASE_UNAVAILABLE without retry", async () => {
    const databaseProbe = vi.fn().mockRejectedValue(new Error("private database diagnostic"));

    await expect(evaluateRuntimeReadiness(validEnvironment(), databaseProbe)).resolves.toEqual({
      status: "NOT_READY",
      reason: "DATABASE_UNAVAILABLE"
    });
    expect(databaseProbe).toHaveBeenCalledTimes(1);
  });

  it("maps a synchronously thrown database probe to DATABASE_UNAVAILABLE without retry", async () => {
    const databaseProbe = vi.fn(() => {
      throw new Error("private synchronous database diagnostic");
    });

    await expect(evaluateRuntimeReadiness(validEnvironment(), databaseProbe)).resolves.toEqual({
      status: "NOT_READY",
      reason: "DATABASE_UNAVAILABLE"
    });
    expect(databaseProbe).toHaveBeenCalledTimes(1);
  });

  it("returns immutable closed results", async () => {
    const ready = await evaluateRuntimeReadiness(validEnvironment(), async () => true);
    const configurationInvalid = await evaluateRuntimeReadiness({}, async () => true);
    const databaseUnavailable = await evaluateRuntimeReadiness(
      validEnvironment(),
      async () => false
    );

    for (const result of [ready, configurationInvalid, databaseUnavailable]) {
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
});

describe("readiness HTTP boundary", () => {
  it("returns the exact 200 contract and required headers", async () => {
    const response = await readinessHandler(validEnvironment(), async () => true)();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        service: "ce-ct-online-tests-mvp",
        status: "ready"
      }
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("returns the exact safe 503 contract for invalid configuration", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(true);
    const response = await readinessHandler({}, databaseProbe)();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(notReadyBody);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(databaseProbe).not.toHaveBeenCalled();
  });

  it("returns the same exact safe 503 contract for database failure", async () => {
    const databaseProbe = vi.fn().mockRejectedValue(new Error("private database diagnostic"));
    const response = await readinessHandler(validEnvironment(), databaseProbe)();
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual(notReadyBody);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(databaseProbe).toHaveBeenCalledTimes(1);
    for (const forbidden of [
      "DATABASE_UNAVAILABLE",
      "CONFIGURATION_INVALID",
      "APP_URL",
      "DATABASE_URL",
      "CORE_APP_ORIGIN_INVALID",
      "private database diagnostic",
      "private synchronous database diagnostic",
      "Prisma"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("liveness HTTP boundary", () => {
  it("preserves the exact static 200 contract without readiness dependencies", async () => {
    const response = getLiveness();
    const source = readFileSync(
      new URL("../../src/app/api/health/route.ts", import.meta.url),
      "utf8"
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        service: "ce-ct-online-tests-mvp",
        status: "ok"
      }
    });
    expect(source).not.toMatch(/runtime-readiness|runtime-config|Prisma|databaseProbe/);
  });
});
