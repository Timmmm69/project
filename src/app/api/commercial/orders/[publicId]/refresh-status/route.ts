import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialOrderStatus, getCommercialOrder, processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialProviderForRuntime } from "@/lib/commercial/providers";
import { commercialErrorResponse, commercialRateLimiter, deriveCommercialClientKey, requireTrustedOrigin } from "@/lib/commercial/route-helpers";
import { logEvent } from "@/server/events/log-event";

type Context = { params: Promise<{ publicId: string }> };

export type CommercialRefreshStatusRouteDependencies = Readonly<{
  requireOrderToken?: typeof requireCommercialOrderToken;
  allowRefresh?: (clientKey: string) => Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
  getOrder?: typeof getCommercialOrder;
  providerForRuntime?: typeof commercialProviderForRuntime;
  processNotification?: typeof processCommercialProviderNotification;
  orderStatus?: typeof commercialOrderStatus;
  writeEvent?: typeof logEvent;
}>;

export function createCommercialRefreshStatusPostHandler(
  dependencies: CommercialRefreshStatusRouteDependencies = {}
) {
  const requireOrderToken = dependencies.requireOrderToken ?? requireCommercialOrderToken;
  const checkRateLimit = dependencies.allowRefresh ?? (async (clientKey: string) => {
    const result = await commercialRateLimiter.consume("STATUS_REFRESH", clientKey);
    return result.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
  });
  const getOrder = dependencies.getOrder ?? getCommercialOrder;
  const providerForRuntime = dependencies.providerForRuntime ?? commercialProviderForRuntime;
  const processNotification = dependencies.processNotification ?? processCommercialProviderNotification;
  const orderStatus = dependencies.orderStatus ?? commercialOrderStatus;
  const writeEvent = dependencies.writeEvent ?? logEvent;

  return async function commercialRefreshStatusPost(request: Request, context: Context) {
    if (!requireTrustedOrigin(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Некорректный источник запроса." }, 403);
    const { publicId } = await context.params;
    const order = await requireOrderToken(publicId);
    if (!order) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Заказ недоступен в этой сессии." }, 403);
    const clientKey = `${deriveCommercialClientKey(request)}:${publicId}`;
    const limitResult = await checkRateLimit(clientKey);
    if (!limitResult.allowed) return apiFailure({ code: "RATE_LIMITED", message: "Проверьте статус немного позже." }, 429, { "Retry-After": String(limitResult.retryAfterSeconds ?? 60) });

    try {
      const latest = await getOrder(publicId);
      const attempt = latest.paymentAttempts[0];
      const refreshable = latest.status === "PENDING" &&
        (attempt?.status === "CREATED" || attempt?.status === "PENDING");
      if (attempt && refreshable) {
        const unknown = async () => apiSuccess(await orderStatus(publicId, {
          paymentStatus: "payment_status_unknown"
        }));
        const provider = providerForRuntime();
        if (provider.provider !== attempt.provider) {
          return unknown();
        }
        let notification;
        try {
          notification = await provider.fetchPaymentStatus({
            merchantReference: attempt.merchantReference,
            providerPaymentId: attempt.providerPaymentId,
            amountMinor: attempt.amountMinor,
            currency: attempt.currency
          });
        } catch {
          return unknown();
        }
        if (!notification.signatureValid || notification.merchantReference !== attempt.merchantReference) {
          return unknown();
        }
        const outcome = await processNotification({
          notification,
          rawBody: JSON.stringify(notification.redactedPayload),
          provider: provider.provider,
          grantAccess: false
        });
        if (outcome.rejected) return unknown();
      }
      await writeEvent({ eventType: "payment_status_refresh_requested", entityType: "commercial_order", entityId: latest.id, payload: {} });
      return apiSuccess(await orderStatus(publicId));
    } catch (error) {
      return commercialErrorResponse(error);
    }
  };
}

export const POST = createCommercialRefreshStatusPostHandler();
