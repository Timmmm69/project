import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialCheckoutUnavailableReason } from "@/lib/commercial/config";
import { CommercialError, createCommercialOrder } from "@/lib/commercial/commercial-service";
import { setCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse, requireTrustedOrigin } from "@/lib/commercial/route-helpers";
import { allowCommercialAction } from "@/lib/commercial/rate-limit";
import {
  commercialIdempotencyKeySchema,
  commercialVerifiedOrderSchema
} from "@/lib/commercial/schemas";
import { readRecoveryCookie, RECOVERY_SESSION_COOKIE } from "@/server/recovery/cookies";
import { createRecoveryHttpRuntime } from "@/server/recovery/http-runtime";

export type CommercialOrderRouteDependencies = Readonly<{
  environment?: Record<string, string | undefined>;
  allowAction?: typeof allowCommercialAction;
  unavailableReason?: typeof commercialCheckoutUnavailableReason;
  createOrder?: typeof createCommercialOrder;
  setOrderToken?: typeof setCommercialOrderToken;
  createRecoveryRuntime?: typeof createRecoveryHttpRuntime;
}>;

export function createCommercialOrderPostHandler(
  dependencies: CommercialOrderRouteDependencies = {}
) {
  const environment = dependencies.environment ?? process.env;
  const allowAction = dependencies.allowAction ?? allowCommercialAction;
  const unavailableReason = dependencies.unavailableReason ?? commercialCheckoutUnavailableReason;
  const createOrder = dependencies.createOrder ?? createCommercialOrder;
  const setOrderToken = dependencies.setOrderToken ?? setCommercialOrderToken;
  const createRecoveryRuntime = dependencies.createRecoveryRuntime ?? createRecoveryHttpRuntime;

  return async function commercialOrderPost(request: Request) {
  if (!requireTrustedOrigin(request)) return apiFailure({ code: "CSRF_REJECTED", message: "Некорректный источник запроса." }, 403);
  const clientKey = request.headers.get("x-forwarded-for") ?? "local";
  if (!allowAction(`order:${clientKey}`, 5)) return apiFailure({ code: "RATE_LIMITED", message: "Try again later." }, 429);
  const unavailable = unavailableReason();
  if (unavailable) return apiFailure({ code: unavailable, message: "Checkout сейчас недоступен." }, 403);
  const body = commercialVerifiedOrderSchema.safeParse(await request.json().catch(() => null));
  const idempotencyKey = commercialIdempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key"));
  if (!body.success || !idempotencyKey.success) return apiFailure({ code: "VALIDATION_ERROR", message: "Некорректные данные заказа." }, 422);

  try {
    const runtime = createRecoveryRuntime(environment);
    const rawToken = readRecoveryCookie(request, RECOVERY_SESSION_COOKIE);
    if (!runtime.config.enabled ||
        "available" in runtime && runtime.available === false ||
        !("service" in runtime) ||
        !rawToken) {
      throw new CommercialError("VERIFIED_EMAIL_REQUIRED");
    }
    const verifiedEmailAuthority = {
      rawToken,
      validate: runtime.service.validateRecoverySession
    };
    const result = await createOrder({
      productCode: body.data.productCode,
      checkoutFlowId: body.data.checkout_flow_id,
      email: undefined,
      verifiedEmailAuthority,
      adultBuyerConfirmed: body.data.adultBuyerConfirmed,
      legalBundleVersion: body.data.legalBundleVersion,
      idempotencyKey: idempotencyKey.data
    });
    await setOrderToken(result.order.publicId, result.lookupToken);
    return apiSuccess({ order: { publicId: result.order.publicId, status: result.order.status.toLowerCase(), idempotent: result.idempotent } }, { status: 201 });
  } catch (error) {
    return commercialErrorResponse(error);
  }
  };
}

export const POST = createCommercialOrderPostHandler();
