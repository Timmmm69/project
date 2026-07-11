import { apiFailure, apiSuccess } from "@/lib/api-response";
import { startOrRestoreAttempt } from "@/lib/attempts/attempt-service";
import { serializeAttemptForStudent } from "@/lib/attempts/serialize";
import { claimCommercialOrderAccess } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, isSameOriginRequest } from "@/lib/commercial/route-helpers";
import { commercialPublicIdSchema } from "@/lib/commercial/schemas";
import { setStudentSessionCookie } from "@/server/auth/student-session";

type Context = { params: Promise<{ publicId: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Invalid request origin." }, 403);
  const { publicId } = await context.params;
  if (!commercialPublicIdSchema.safeParse(publicId).success) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);

  try {
    if (!(await requireCommercialOrderToken(publicId))) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Order is not available in this session." }, 403);
    const claim = await claimCommercialOrderAccess(publicId);
    await setStudentSessionCookie(claim.student);
    if (claim.nextAction !== "START_TEST") return apiSuccess({ nextAction: claim.nextAction, nextUrl: claim.nextUrl });
    const result = await startOrRestoreAttempt({ studentId: claim.student.userId, email: claim.student.email, testId: claim.testId });
    return apiSuccess({ nextAction: "START_TEST", nextUrl: `/attempts/${result.attempt.id}`, attempt: serializeAttemptForStudent(result.attempt), restored: result.restored });
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
