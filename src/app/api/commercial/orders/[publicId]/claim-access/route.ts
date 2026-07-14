import { apiFailure, apiSuccess } from "@/lib/api-response";
import { claimCommercialOrderAccess } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, isSameOriginRequest } from "@/lib/commercial/route-helpers";
import {
  commercialClaimOperationIdSchema,
  commercialPublicIdSchema
} from "@/lib/commercial/schemas";
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
  issueSession: issueCommercialOrderVerifiedSession,
  setLegacySession: setStudentSessionCookie
};

export type CommercialClaimAccessRouteDependencies = typeof defaultDependencies;

export function createCommercialClaimAccessHandler(
  dependencies: CommercialClaimAccessRouteDependencies = defaultDependencies
) {
  return async function commercialClaimAccessHandler(request: Request, context: Context) {
    if (!isSameOriginRequest(request)) {
      return apiFailure({ code: "CSRF_REJECTED", message: "Invalid request origin." }, 403);
    }
    const { publicId } = await context.params;
    if (!commercialPublicIdSchema.safeParse(publicId).success) {
      return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);
    }
    const operation = commercialClaimOperationIdSchema.safeParse(
      request.headers.get("Idempotency-Key")
    );
    if (!operation.success) {
      return apiFailure({ code: "VALIDATION_ERROR", message: "A UUID Idempotency-Key is required." }, 422);
    }

    try {
      if (!(await dependencies.requireOrderToken(publicId))) {
        return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);
      }
      const claim = await dependencies.claimAccess(publicId);
      const issuance = await dependencies.issueSession(claim, operation.data);
      if (issuance.status === "UNAVAILABLE") return verifiedDestinationUnavailable();
      if (issuance.status === "SCOPE_NOT_ALLOWED") {
        return verifiedDestinationRejection({
          status: "REJECTED",
          mode: "enforce",
          classification: "AUTHENTIC",
          code: "VERIFIED_SCOPE_NOT_ALLOWED"
        });
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
      return commercialErrorResponse(error);
    }
  };
}

export const POST = createCommercialClaimAccessHandler();
