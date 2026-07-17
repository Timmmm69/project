import { apiFailure, apiSuccess } from "@/lib/api-response";
import {
  evaluateRuntimeReadiness,
  probePostgresReadiness,
  type DatabaseReadinessProbe,
  type ReadinessEnvironment
} from "@/server/runtime-readiness/runtime-readiness";

const readinessResponseHeaders = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer"
});

type ReadinessHandlerDependencies = Readonly<{
  getEnvironment: () => ReadinessEnvironment;
  databaseProbe: DatabaseReadinessProbe;
}>;

function notReadyResponse() {
  const response = apiFailure({
    code: "SERVICE_NOT_READY",
    message: "Service is not ready."
  }, 503);
  for (const [name, value] of Object.entries(readinessResponseHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}

export function createReadinessHandler(dependencies: ReadinessHandlerDependencies) {
  return async function GET() {
    const result = await evaluateRuntimeReadiness(
      dependencies.getEnvironment(),
      dependencies.databaseProbe
    );

    if (result.status !== "READY") {
      return notReadyResponse();
    }

    return apiSuccess({
      service: "ce-ct-online-tests-mvp",
      status: "ready"
    }, {
      status: 200,
      headers: readinessResponseHeaders
    });
  };
}

export const GET = createReadinessHandler({
  getEnvironment: () => process.env,
  databaseProbe: probePostgresReadiness
});
