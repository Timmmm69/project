import { apiFailure } from "@/lib/api-response";
import { CommercialError } from "@/lib/commercial/commercial-service";

export { requireTrustedOrigin } from "@/lib/commercial/origin-policy";

export function commercialErrorResponse(error: unknown) {
  if (error instanceof CommercialError) {
    const status = error.code === "EXISTING_ACCESS" || error.code === "ORDER_ALREADY_PENDING" || error.code === "PAYMENT_SESSION_ALREADY_ACTIVE"
      ? 409
      : error.code === "ORDER_TOKEN_REQUIRED" || error.code === "VERIFIED_EMAIL_REQUIRED"
        ? 403
        : 422;
    const details = error.nextAction || error.publicOrderReference
      ? {
          ...(error.nextAction ? { nextAction: error.nextAction } : {}),
          ...(error.publicOrderReference ? { orderReference: error.publicOrderReference } : {})
        }
      : undefined;
    return apiFailure({
      code: error.code,
      message: commercialMessage(error.code),
      ...(details ? { details } : {})
    }, status);
  }
  return apiFailure({ code: "COMMERCIAL_CHECKOUT_ERROR", message: "Не удалось обработать запрос. Повторите попытку позже." }, 409);
}

function commercialMessage(code: string) {
  const messages: Record<string, string> = {
    ADULT_CONFIRMATION_REQUIRED: "Необходимо подтвердить совершеннолетие покупателя.",
    STALE_LEGAL_BUNDLE: "Условия оплаты обновились. Ознакомьтесь с актуальной версией.",
    VERIFIED_EMAIL_REQUIRED: "Сначала подтвердите email одноразовым кодом.",
    EXISTING_ACCESS: "Для этого email доступ уже открыт.",
    IDEMPOTENCY_KEY_CONFLICT: "Этот ключ запроса уже использован для другого заказа.",
    ORDER_NOT_FOUND: "Заказ не найден.",
    ORDER_ALREADY_PAID: "Оплата уже подтверждена.",
    COMMERCIAL_PRODUCT_UNAVAILABLE: "Этот вариант временно недоступен для покупки."
  };
  return messages[code] ?? "Коммерческий checkout временно недоступен.";
}
