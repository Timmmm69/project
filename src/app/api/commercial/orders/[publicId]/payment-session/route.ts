import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialCheckoutUnavailableReason } from "@/lib/commercial/config";
import { createCommercialPaymentSession } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, commercialRateLimiter, commercialRateLimitedResponse, deriveCommercialClientKey, requireTrustedOrigin } from "@/lib/commercial/route-helpers";
import { commercialIdempotencyKeySchema, commercialPublicIdSchema } from "@/lib/commercial/schemas";
import { commercialProviderForRuntime } from "@/lib/commercial/providers";

type Context = { params: Promise<{ publicId: string }> };

export async function POST(request: Request, context: Context) {
  if (!requireTrustedOrigin(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Некорректный источник запроса." }, 403);
  const unavailable = commercialCheckoutUnavailableReason();
  if (unavailable) return apiFailure({ code: unavailable, message: "Checkout сейчас недоступен." }, 403);
  const { publicId } = await context.params;
  if (!commercialPublicIdSchema.safeParse(publicId).success) return apiFailure({ code: "ORDER_NOT_FOUND", message: "Заказ не найден." }, 404);
  const key = commercialIdempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key"));
  const clientKey = `${deriveCommercialClientKey(request)}:${publicId}`;
  const limitResult = await commercialRateLimiter.consume("PAYMENT_SESSION_CREATE", clientKey);
  if (!limitResult.allowed) return commercialRateLimitedResponse(limitResult);
  if (!key.success) return apiFailure({ code: "VALIDATION_ERROR", message: "Нужен Idempotency-Key." }, 422);
  if (!(await requireCommercialOrderToken(publicId))) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Заказ недоступен в этой сессии." }, 403);

  try {
    const attempt = await createCommercialPaymentSession({ publicId, idempotencyKey: key.data, provider: commercialProviderForRuntime(), appUrl: process.env.APP_URL || new URL(request.url).origin });
    return apiSuccess({ paymentSession: { status: attempt.status.toLowerCase(), actionUrl: attempt.paymentUrl, method: "POST", fields: attempt.providerFields, expiresAt: attempt.expiresAt } });
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
