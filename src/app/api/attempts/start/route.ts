import { apiFailure, apiSuccess } from "@/lib/api-response";
import { startAttemptRequestSchema } from "@/lib/attempts/attempt-schemas";
import { serializeAttemptForStudent } from "@/lib/attempts/serialize";
import { getAttemptForStudent, startOrRestoreAttempt } from "@/lib/attempts/attempt-service";
import { requireStudent } from "@/server/auth/student-session";
import { resolveVerifiedStudentEntryDestination } from "@/server/auth/verified-student-session/destination-guard";
import {
  finalizeVerifiedDestinationResponse,
  verifiedDestinationRejection,
  verifiedDestinationUnavailable
} from "@/server/auth/verified-student-session/destination-response";

const defaultDependencies = {
  resolveEntry: resolveVerifiedStudentEntryDestination,
  requireStudent,
  startAttempt: startOrRestoreAttempt,
  getAttempt: getAttemptForStudent,
  serializeAttempt: serializeAttemptForStudent
};

export type AttemptStartRouteDependencies = typeof defaultDependencies;

export function createAttemptStartHandler(
  dependencies: AttemptStartRouteDependencies = defaultDependencies
) {
  return async function attemptStartHandler(request: Request) {
    const parsed = startAttemptRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiFailure(
        {
          code: "VALIDATION_ERROR",
          message: "Invalid attempt start data",
          details: parsed.error.flatten()
        },
        422
      );
    }

    let resolution;
    try {
      resolution = await dependencies.resolveEntry({ testId: parsed.data.testId }, request);
    } catch {
      return verifiedDestinationUnavailable();
    }
    if (resolution.status === "REJECTED") {
      return verifiedDestinationRejection(resolution);
    }

    if (resolution.status === "AUTHORIZED" && resolution.nextAction === "OPEN_ATTEMPT") {
      const attemptId = resolution.context.attemptId;
      if (!attemptId) return verifiedDestinationUnavailable();
      let attempt;
      try {
        attempt = await dependencies.getAttempt({
          attemptId,
          studentId: resolution.context.userId,
          authorizedAccessId: resolution.context.accessId
        });
      } catch {
        return verifiedDestinationUnavailable();
      }
      if (!attempt || attempt.status !== "STARTED") return verifiedDestinationUnavailable();
      return finalizeVerifiedDestinationResponse(apiSuccess({
        nextAction: "OPEN_ATTEMPT" as const,
        nextUrl: resolution.nextUrl,
        attempt: dependencies.serializeAttempt(attempt),
        restored: true
      }), resolution);
    }

    if (resolution.status === "AUTHORIZED" && resolution.nextAction === "OPEN_RESULT") {
      return finalizeVerifiedDestinationResponse(apiSuccess({
        nextAction: "OPEN_RESULT" as const,
        nextUrl: resolution.nextUrl,
        restored: true
      }), resolution);
    }

    const student = resolution.status === "AUTHORIZED"
      ? {
          id: resolution.context.userId,
          email: resolution.context.userEmail
        }
      : await dependencies.requireStudent();
    if (!student) {
      return apiFailure({ code: "UNAUTHORIZED", message: "Student session is required" }, 401);
    }
    if (resolution.status !== "AUTHORIZED" && !parsed.data.email) {
      return apiFailure({ code: "VALIDATION_ERROR", message: "Invalid attempt start data" }, 422);
    }
    if (resolution.status !== "AUTHORIZED" && parsed.data.email !== student.email) {
      return apiFailure({ code: "FORBIDDEN", message: "Student session does not match email" }, 403);
    }

    try {
      const result = await dependencies.startAttempt({
        studentId: student.id,
        email: student.email,
        testId: parsed.data.testId,
        ...(resolution.status === "AUTHORIZED"
          ? { authorizedAccessId: resolution.context.accessId }
          : {})
      });

      return finalizeVerifiedDestinationResponse(apiSuccess({
        ...(resolution.status === "AUTHORIZED"
          ? {
              nextAction: "OPEN_ATTEMPT" as const,
              nextUrl: `/attempts/${result.attempt.id}`
            }
          : {}),
        attempt: dependencies.serializeAttempt(result.attempt),
        restored: result.restored
      }), resolution);
    } catch (error) {
      const code = error instanceof Error ? error.message : "ATTEMPT_START_FAILED";
      const messages: Record<string, string> = {
        NO_ACTIVE_ACCESS: "No active access is available for this test",
        TEST_NOT_AVAILABLE: "Test is not available"
      };
      const status = code === "TEST_NOT_AVAILABLE" ? 404 : 409;
      return apiFailure({ code, message: messages[code] ?? "Attempt cannot be started" }, status);
    }
  };
}

export const POST = createAttemptStartHandler();
