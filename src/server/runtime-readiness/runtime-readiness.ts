import { prisma } from "@/server/db/client";
import { validateProductionRuntimeConfig } from "@/server/runtime-config/production-runtime-config";

export type ReadinessEnvironment = Readonly<Record<string, string | undefined>>;

export type DatabaseReadinessProbe = () => boolean | Promise<boolean>;

export type RuntimeReadinessResult =
  | Readonly<{ status: "READY" }>
  | Readonly<{
    status: "NOT_READY";
    reason: "CONFIGURATION_INVALID" | "DATABASE_UNAVAILABLE";
  }>;

const readyResult: RuntimeReadinessResult = Object.freeze({
  status: "READY"
});

const configurationInvalidResult: RuntimeReadinessResult = Object.freeze({
  status: "NOT_READY",
  reason: "CONFIGURATION_INVALID"
});

const databaseUnavailableResult: RuntimeReadinessResult = Object.freeze({
  status: "NOT_READY",
  reason: "DATABASE_UNAVAILABLE"
});

export async function probePostgresReadiness() {
  try {
    const rows = await prisma.$queryRaw<Array<{ ready: number }>>`
      SELECT 1 AS "ready"
    `;
    return rows.length === 1 && rows[0]?.ready === 1;
  } catch {
    return false;
  }
}

export async function evaluateRuntimeReadiness(
  environment: ReadinessEnvironment,
  databaseProbe: DatabaseReadinessProbe
): Promise<RuntimeReadinessResult> {
  const configuration = validateProductionRuntimeConfig(environment);
  if (configuration.status === "INVALID") {
    return configurationInvalidResult;
  }

  try {
    if (await databaseProbe()) {
      return readyResult;
    }
  } catch {
    // The closed result below intentionally suppresses database diagnostics.
  }

  return databaseUnavailableResult;
}
