import { apiFailure, apiSuccess } from "@/lib/api-response";
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
import {
  verifiedDestinationRejection,
  verifiedDestinationUnavailable
} from "@/server/auth/verified-student-session/destination-response";

type Context = { params: Promise<{ publicId: string }> };

const defaultDependencies = {
  requireOrderToken: requireCommercialOrderToken,
  claimAccess: claimCommercialOrderAccess,
  resolveIssuance: issueCommercialOrderVerifiedSession,
  setLegacySession: setStudentSessionCookie
};

export type CommercialClaimAccessRouteDependencies = typeof defaultDependencies;

export function createCommercialClaimAccessHandler(
  dependencies: CommercialClaimAccessRouteDependencies = defaultDependencies
) {
  return async function commercialClaimAccessHandler(request: Request, context: Context) {
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
        return finalizeCommercialOrderSessionResponse(
          verifiedDestinationRejection({
            status: "REJECTED",
            mode: "enforce",
            classification: "AUTHENTIC",
            code: "VERIFIED_SCOPE_NOT_ALLOWED"
          })
        );
      }
      if (commercialOrderIssuanceUsesLegacySession(issuance)) {
        await dependencies.setLegacySession(claim.student);
      }
      return finalizeCommercialOrderSessionResponse(
        apiSuccess({
          nextAction: claim.nextAction,
          nextUrl: claim.nextUrl,
          testId: claim.testId
        }),
        issuance
      );
    } catch (error) {
      return finalizeCommercialOrderSessionResponse(commercialErrorResponse(error));
    }
  };
}

export const POST = createCommercialClaimAccessHandler();
