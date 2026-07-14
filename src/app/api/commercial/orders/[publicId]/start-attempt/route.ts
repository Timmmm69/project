import { apiFailure, apiSuccess } from "@/lib/api-response";
import { startOrRestoreAttempt } from "@/lib/attempts/attempt-service";
import { serializeAttemptForStudent } from "@/lib/attempts/serialize";
import { claimCommercialOrderAccess } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, isSameOriginRequest } from "@/lib/commercial/route-helpers";
import { commercialPublicIdSchema } from "@/lib/commercial/schemas";
import { setStudentSessionCookie } from "@/server/auth/student-session";
import { authorizeVerifiedStudentDestination } from "@/server/auth/verified-student-session/destination-guard";
import {
  finalizeVerifiedDestinationResponse,
  verifiedDestinationRejection,
  verifiedDestinationUnavailable
} from "@/server/auth/verified-student-session/destination-response";

type Context = { params: Promise<{ publicId: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Invalid request origin." }, 403);
  const { publicId } = await context.params;
  if (!commercialPublicIdSchema.safeParse(publicId).success) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);

  try {
    if (!(await requireCommercialOrderToken(publicId))) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);
    const claim = await claimCommercialOrderAccess(publicId);
    const target = claim.nextAction === "START_TEST"
      ? { destination: "PRE" as const, testId: claim.testId }
      : claim.nextAction === "RESUME_TEST" && claim.attemptId
        ? { destination: "ATT" as const, attemptId: claim.attemptId }
        : claim.attemptId
          ? { destination: "RES" as const, attemptId: claim.attemptId }
          : null;
    if (!target) return verifiedDestinationUnavailable();
    let authorization;
    try {
      authorization = await authorizeVerifiedStudentDestination(target, request);
    } catch {
      return verifiedDestinationUnavailable();
    }
    if (authorization.status === "REJECTED") return verifiedDestinationRejection(authorization);
    if (authorization.status === "LEGACY") {
      await setStudentSessionCookie(claim.student);
    } else if (
      authorization.context.userId !== claim.student.userId ||
      authorization.context.accessId !== claim.accessId ||
      authorization.context.commercialProductId !== claim.commercialProductId ||
      authorization.context.testId !== claim.testId
    ) {
      return verifiedDestinationRejection({
        status: "REJECTED",
        mode: "enforce",
        classification: "AUTHENTIC",
        code: "VERIFIED_SCOPE_NOT_ALLOWED"
      });
    }
    if (claim.nextAction !== "START_TEST") {
      return finalizeVerifiedDestinationResponse(
        apiSuccess({ nextAction: claim.nextAction, nextUrl: claim.nextUrl }),
        authorization
      );
    }
    const result = await startOrRestoreAttempt({
      studentId: claim.student.userId,
      email: claim.student.email,
      testId: claim.testId,
      ...(authorization.status === "AUTHORIZED" ? { authorizedAccessId: claim.accessId } : {})
    });
    return finalizeVerifiedDestinationResponse(apiSuccess({
      nextAction: "START_TEST",
      nextUrl: `/attempts/${result.attempt.id}`,
      attempt: serializeAttemptForStudent(result.attempt),
      restored: result.restored
    }), authorization);
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
