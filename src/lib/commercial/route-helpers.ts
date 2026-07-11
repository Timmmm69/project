import { apiFailure } from "@/lib/api-response";
import { CommercialError } from "@/lib/commercial/commercial-service";

export function commercialErrorResponse(error: unknown) {
  if (error instanceof CommercialError) {
    return apiFailure({ code: error.code, message: commercialMessage(error.code), ...(error.nextAction ? { details: { nextAction: error.nextAction } } : {}) }, error.code === "EXISTING_ACCESS" ? 409 : 422);
  }
  return apiFailure({ code: "COMMERCIAL_CHECKOUT_ERROR", message: "Не удалось обработать запрос. Повторите попытку позже." }, 409);
}

function commercialMessage(code: string) {
  const messages: Record<string, string> = {
    ADULT_CONFIRMATION_REQUIRED: "Необходимо подтвердить совершеннолетие покупателя.",
    STALE_LEGAL_BUNDLE: "Условия оплаты обновились. Ознакомьтесь с актуальной версией.",
    EXISTING_ACCESS: "Для этого email доступ уже открыт.",
    IDEMPOTENCY_KEY_CONFLICT: "Этот ключ запроса уже использован для другого заказа.",
    ORDER_NOT_FOUND: "Заказ не найден.",
    ORDER_ALREADY_PAID: "Оплата уже подтверждена.",
    COMMERCIAL_PRODUCT_UNAVAILABLE: "Этот вариант временно недоступен для покупки."
  };
  return messages[code] ?? "Коммерческий checkout временно недоступен.";
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const expected = process.env.APP_URL || new URL(request.url).origin;
  return origin === expected;
}
