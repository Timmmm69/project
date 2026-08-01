import { apiFailure, apiSuccess } from "@/lib/api-response";
import { completeAttempt } from "@/lib/attempts/attempt-service";
import { serializeAttemptSummary } from "@/lib/attempts/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireStudent } from "@/server/auth/student-session";
import { authorizeVerifiedStudentDestination } from "@/server/auth/verified-student-session/destination-guard";
import {
  finalizeVerifiedDestinationResponse,
  verifiedDestinationRejection,
  verifiedDestinationUnavailable
} from "@/server/auth/verified-student-session/destination-response";

type RouteContext = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { attemptId } = await context.params;
  const parsedId = uuidSchema.safeParse(attemptId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  let authorization;
  try {
    authorization = await authorizeVerifiedStudentDestination({ destination: "ATT", attemptId: parsedId.data }, request);
  } catch {
    return verifiedDestinationUnavailable();
  }
  if (authorization.status === "REJECTED") return verifiedDestinationRejection(authorization);
  const studentId = authorization.status === "AUTHORIZED"
    ? authorization.context.userId
    : (await requireStudent())?.id;
  if (!studentId) return apiFailure({ code: "UNAUTHORIZED", message: "Student session is required" }, 401);

  try {
    const attempt = await completeAttempt({
      attemptId: parsedId.data,
      studentId,
      ...(authorization.status === "AUTHORIZED"
        ? { authorizedAccessId: authorization.context.accessId }
        : {}),
      expire: false
    });

    return finalizeVerifiedDestinationResponse(apiSuccess({
      attempt: serializeAttemptSummary(attempt),
      resultUrl: `/results/${attempt.id}`
    }), authorization);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ATTEMPT_COMPLETE_FAILED";
    const status = code === "ATTEMPT_NOT_FOUND" ? 404 : 409;
    return apiFailure({ code, message: code === "ATTEMPT_NOT_FOUND" ? "Attempt not found" : "Attempt cannot be completed" }, status);
  }
}
