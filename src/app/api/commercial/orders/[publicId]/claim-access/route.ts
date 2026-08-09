import { apiFailure, apiSuccess } from "@/lib/api-response";
import { claimCommercialOrderAccess } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, requireTrustedOrigin } from "@/lib/commercial/route-helpers";
import { commercialPublicIdSchema } from "@/lib/commercial/schemas";
import { setStudentSessionCookie } from "@/server/auth/student-session";

type Context = { params: Promise<{ publicId: string }> };

export async function POST(request: Request, context: Context) {
  if (!requireTrustedOrigin(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Invalid request origin." }, 403);
  const { publicId } = await context.params;
  if (!commercialPublicIdSchema.safeParse(publicId).success) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);

  try {
    if (!(await requireCommercialOrderToken(publicId))) {
      return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);
    }
    const claim = await claimCommercialOrderAccess(publicId);
    await setStudentSessionCookie(claim.student);
    return apiSuccess({ nextAction: claim.nextAction, nextUrl: claim.nextUrl, testId: claim.testId });
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
