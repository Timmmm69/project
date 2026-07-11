import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialOrderStatus, getCommercialOrder, processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialProviderForRuntime } from "@/lib/commercial/providers";
import { allowCommercialRefresh } from "@/lib/commercial/rate-limit";
import { commercialErrorResponse, isSameOriginRequest } from "@/lib/commercial/route-helpers";
import { logEvent } from "@/server/events/log-event";

type Context = { params: Promise<{ publicId: string }> };

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Некорректный источник запроса." }, 403);
  const { publicId } = await context.params;
  const order = await requireCommercialOrderToken(publicId);
  if (!order) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Заказ недоступен в этой сессии." }, 403);
  if (!allowCommercialRefresh(`${request.headers.get("x-forwarded-for") ?? "local"}:${publicId}`)) return apiFailure({ code: "RATE_LIMITED", message: "Проверьте статус немного позже." }, 429);

  try {
    const latest = await getCommercialOrder(publicId);
    const attempt = latest.paymentAttempts[0];
    if (attempt) {
      const provider = commercialProviderForRuntime();
      if (provider.provider !== attempt.provider) {
        return apiFailure({ code: "PROVIDER_STATUS_REFRESH_UNAVAILABLE", message: "Provider status refresh is not available." }, 422);
      }
      const notification = await provider.fetchPaymentStatus({ merchantReference: attempt.merchantReference, providerPaymentId: attempt.providerPaymentId });
      if (notification.merchantReference !== attempt.merchantReference) {
        return apiFailure({ code: "PAYMENT_REFERENCE_MISMATCH", message: "Provider returned a different payment reference." }, 422);
      }
      await processCommercialProviderNotification({
        notification,
        rawBody: JSON.stringify(notification.redactedPayload),
        provider: provider.provider
      });
    }
    await logEvent({ eventType: "payment_status_refresh_requested", entityType: "commercial_order", entityId: latest.id, payload: {} });
    return apiSuccess(await commercialOrderStatus(publicId));
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
