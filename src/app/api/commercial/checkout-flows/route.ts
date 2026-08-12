import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialCheckoutUnavailableReason } from "@/lib/commercial/config";
import { createCommercialCheckoutFlow } from "@/lib/commercial/commercial-service";
import { commercialErrorResponse, commercialRateLimiter, commercialRateLimitedResponse, deriveCommercialClientKey, requireTrustedOrigin } from "@/lib/commercial/route-helpers";
import { commercialCheckoutFlowSchema } from "@/lib/commercial/schemas";

export async function POST(request: Request) {
  if (!requireTrustedOrigin(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Некорректный источник запроса." }, 403);
  const clientKey = deriveCommercialClientKey(request);
  const limitResult = await commercialRateLimiter.consume("CHECKOUT_FLOW", clientKey);
  if (!limitResult.allowed) return commercialRateLimitedResponse(limitResult);
  const unavailable = commercialCheckoutUnavailableReason();
  if (unavailable) return apiFailure({ code: unavailable, message: "Checkout сейчас недоступен." }, 403);
  const body = commercialCheckoutFlowSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiFailure({ code: "VALIDATION_ERROR", message: "Некорректные данные заказа." }, 422);

  try {
    const flow = await createCommercialCheckoutFlow(body.data);
    return apiSuccess({ checkout_flow_id: flow.id }, { status: 201 });
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
