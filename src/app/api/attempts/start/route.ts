import { apiFailure, apiSuccess } from "@/lib/api-response";
import { startAttemptRequestSchema } from "@/lib/attempts/attempt-schemas";
import { serializeAttemptForStudent } from "@/lib/attempts/serialize";
import { startOrRestoreAttempt } from "@/lib/attempts/attempt-service";
import { requireStudent } from "@/server/auth/student-session";
import { authorizeVerifiedStudentDestination } from "@/server/auth/verified-student-session/destination-guard";
import {
  finalizeVerifiedDestinationResponse,
  verifiedDestinationRejection,
  verifiedDestinationUnavailable
} from "@/server/auth/verified-student-session/destination-response";

export async function POST(request: Request) {
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

  let authorization;
  try {
    authorization = await authorizeVerifiedStudentDestination({
      destination: "PRE",
      testId: parsed.data.testId
    }, request);
  } catch {
    return verifiedDestinationUnavailable();
  }
  if (authorization.status === "REJECTED") {
    return verifiedDestinationRejection(authorization);
  }

  const student = authorization.status === "AUTHORIZED"
    ? {
        id: authorization.context.userId,
        email: authorization.context.userEmail
      }
    : await requireStudent();
  if (!student) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Student session is required" }, 401);
  }
  if (authorization.status !== "AUTHORIZED" && !parsed.data.email) {
    return apiFailure({ code: "VALIDATION_ERROR", message: "Invalid attempt start data" }, 422);
  }
  if (authorization.status !== "AUTHORIZED" && parsed.data.email !== student.email) {
    return apiFailure({ code: "FORBIDDEN", message: "Student session does not match email" }, 403);
  }

  try {
    const result = await startOrRestoreAttempt({
      studentId: student.id,
      email: student.email,
      testId: parsed.data.testId,
      ...(authorization.status === "AUTHORIZED"
        ? { authorizedAccessId: authorization.context.accessId }
        : {})
    });

    return finalizeVerifiedDestinationResponse(apiSuccess({
      attempt: serializeAttemptForStudent(result.attempt),
      restored: result.restored
    }), authorization);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ATTEMPT_START_FAILED";
    const messages: Record<string, string> = {
      NO_ACTIVE_ACCESS: "No active access is available for this test",
      TEST_NOT_AVAILABLE: "Test is not available"
    };
    const status = code === "TEST_NOT_AVAILABLE" ? 404 : 409;
    return apiFailure({ code, message: messages[code] ?? "Attempt cannot be started" }, status);
  }
}
