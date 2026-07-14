import { apiFailure, apiSuccess } from "@/lib/api-response";
import { startOrRestoreAttempt } from "@/lib/attempts/attempt-service";
import { serializeAttemptForStudent } from "@/lib/attempts/serialize";
import { claimCommercialOrderAccess } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, isSameOriginRequest } from "@/lib/commercial/route-helpers";
import { commercialPublicIdSchema } from "@/lib/commercial/schemas";
import { setStudentSessionCookie } from "@/server/auth/student-session";
import {
  commercialOrderIssuanceUsesLegacySession,
  finalizeCommercialOrderSessionResponse,
  issueCommercialOrderVerifiedSession
} from "@/server/auth/verified-student-session/commercial-order-issuer";
import { authorizeVerifiedStudentDestination } from "@/server/auth/verified-student-session/destination-guard";
import {
  finalizeVerifiedDestinationResponse,
  verifiedDestinationRejection,
  verifiedDestinationUnavailable
} from "@/server/auth/verified-student-session/destination-response";

type Context = { params: Promise<{ publicId: string }> };

const defaultDependencies = {
  requireOrderToken: requireCommercialOrderToken,
  claimAccess: claimCommercialOrderAccess,
  resolveIssuance: issueCommercialOrderVerifiedSession,
  authorizeDestination: authorizeVerifiedStudentDestination,
  setLegacySession: setStudentSessionCookie,
  startAttempt: startOrRestoreAttempt
};

export type CommercialStartAttemptRouteDependencies = typeof defaultDependencies;

function scopeRejection() {
  return verifiedDestinationRejection({
    status: "REJECTED",
    mode: "enforce",
    classification: "AUTHENTIC",
    code: "VERIFIED_SCOPE_NOT_ALLOWED"
  });
}

export function createCommercialStartAttemptHandler(
  dependencies: CommercialStartAttemptRouteDependencies = defaultDependencies
) {
  return async function commercialStartAttemptHandler(request: Request, context: Context) {
    if (!isSameOriginRequest(request)) {
      return finalizeCommercialOrderSessionResponse(
        apiFailure({ code: "CSRF_REJECTED", message: "Invalid request origin." }, 403)
      );
    }
    const { publicId } = await context.params;
    if (!commercialPublicIdSchema.safeParse(publicId).success) {
      return finalizeCommercialOrderSessionResponse(
        apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403)
      );
    }

    try {
      if (!(await dependencies.requireOrderToken(publicId))) {
        return finalizeCommercialOrderSessionResponse(
          apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403)
        );
      }
      const claim = await dependencies.claimAccess(publicId);
      const issuance = await dependencies.resolveIssuance(
        claim,
        request.headers.get("Idempotency-Key")
      );
      if (issuance.status === "INVALID_OPERATION") {
        return finalizeCommercialOrderSessionResponse(
          apiFailure({ code: "VALIDATION_ERROR", message: "A UUID Idempotency-Key is required." }, 422)
        );
      }
      if (issuance.status === "UNAVAILABLE") {
        return finalizeCommercialOrderSessionResponse(verifiedDestinationUnavailable());
      }
      if (issuance.status === "SCOPE_NOT_ALLOWED") {
        return finalizeCommercialOrderSessionResponse(scopeRejection());
      }

      const target = claim.nextAction === "START_TEST"
        ? { destination: "PRE" as const, testId: claim.testId }
        : claim.nextAction === "RESUME_TEST" && claim.attemptId
          ? { destination: "ATT" as const, attemptId: claim.attemptId }
          : claim.attemptId
            ? { destination: "RES" as const, attemptId: claim.attemptId }
            : null;
      if (!target) {
        return finalizeCommercialOrderSessionResponse(verifiedDestinationUnavailable());
      }

      let authorization;
      try {
        authorization = await dependencies.authorizeDestination(
          target,
          request,
          issuance.status === "ISSUED"
            ? { readCookie: async () => issuance.result.rawToken }
            : {}
        );
      } catch {
        return finalizeCommercialOrderSessionResponse(verifiedDestinationUnavailable());
      }
      if (authorization.status === "REJECTED") {
        return finalizeCommercialOrderSessionResponse(
          verifiedDestinationRejection(authorization)
        );
      }
      if (issuance.status === "ISSUED" &&
        issuance.mode === "enforce" &&
        authorization.status !== "AUTHORIZED") {
        return finalizeCommercialOrderSessionResponse(scopeRejection());
      }
      if (commercialOrderIssuanceUsesLegacySession(issuance)) {
        await dependencies.setLegacySession(claim.student);
      }

      if (claim.nextAction !== "START_TEST") {
        return finalizeCommercialOrderSessionResponse(
          finalizeVerifiedDestinationResponse(
            apiSuccess({ nextAction: claim.nextAction, nextUrl: claim.nextUrl }),
            authorization
          ),
          issuance
        );
      }

      const authority = authorization.status === "AUTHORIZED"
        ? {
            studentId: authorization.context.userId,
            email: authorization.context.userEmail,
            testId: authorization.context.testId,
            authorizedAccessId: authorization.context.accessId
          }
        : {
            studentId: claim.student.userId,
            email: claim.student.email,
            testId: claim.testId
          };
      const result = await dependencies.startAttempt(authority);
      return finalizeCommercialOrderSessionResponse(
        finalizeVerifiedDestinationResponse(apiSuccess({
          nextAction: "START_TEST",
          nextUrl: `/attempts/${result.attempt.id}`,
          attempt: serializeAttemptForStudent(result.attempt),
          restored: result.restored
        }), authorization),
        issuance
      );
    } catch (error) {
      return finalizeCommercialOrderSessionResponse(commercialErrorResponse(error));
    }
  };
}

export const POST = createCommercialStartAttemptHandler();
