import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialOrderStatus } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse } from "@/lib/commercial/route-helpers";
import { logEvent } from "@/server/events/log-event";

type Context = { params: Promise<{ publicId: string }> };

export async function GET(_request: Request, context: Context) {
  const { publicId } = await context.params;
  if (!(await requireCommercialOrderToken(publicId))) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Заказ недоступен в этой сессии." }, 403);
  try {
    const status = await commercialOrderStatus(publicId);
    await logEvent({ eventType: "order_status_viewed", entityType: "commercial_order", payload: { publicId } });
    return apiSuccess(status);
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
