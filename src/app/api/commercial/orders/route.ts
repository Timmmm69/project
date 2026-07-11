import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialCheckoutUnavailableReason } from "@/lib/commercial/config";
import { createCommercialOrder } from "@/lib/commercial/commercial-service";
import { setCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, isSameOriginRequest } from "@/lib/commercial/route-helpers";
import { commercialIdempotencyKeySchema, commercialOrderSchema } from "@/lib/commercial/schemas";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Некорректный источник запроса." }, 403);
  const unavailable = commercialCheckoutUnavailableReason();
  if (unavailable) return apiFailure({ code: unavailable, message: "Checkout сейчас недоступен." }, 403);
  const body = commercialOrderSchema.safeParse(await request.json().catch(() => null));
  const idempotencyKey = commercialIdempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key"));
  if (!body.success || !idempotencyKey.success) return apiFailure({ code: "VALIDATION_ERROR", message: "Некорректные данные заказа." }, 422);

  try {
    const result = await createCommercialOrder({ ...body.data, idempotencyKey: idempotencyKey.data });
    await setCommercialOrderToken(result.order.publicId, result.lookupToken);
    return apiSuccess({ order: { publicId: result.order.publicId, status: result.order.status.toLowerCase(), idempotent: result.idempotent } }, { status: 201 });
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
