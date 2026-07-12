import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialCheckoutUnavailableReason } from "@/lib/commercial/config";
import { createCommercialCheckoutFlow } from "@/lib/commercial/commercial-service";
import { commercialErrorResponse, isSameOriginRequest } from "@/lib/commercial/route-helpers";
import { allowCommercialAction } from "@/lib/commercial/rate-limit";
import { commercialCheckoutFlowSchema } from "@/lib/commercial/schemas";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Некорректный источник запроса." }, 403);
  const clientKey = request.headers.get("x-forwarded-for") ?? "local";
  if (!allowCommercialAction(`checkout-flow:${clientKey}`, 5)) return apiFailure({ code: "RATE_LIMITED", message: "Try again later." }, 429);
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
