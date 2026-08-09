import { apiFailure, apiSuccess } from "@/lib/api-response";
import { commercialOrderStatus, ensurePaymentReturnViewedAnalytics } from "@/lib/commercial/commercial-service";
import { requireCommercialOrderToken } from "@/lib/commercial/order-token";
import { commercialErrorResponse } from "@/lib/commercial/route-helpers";
import { logEvent } from "@/server/events/log-event";
import { prisma } from "@/server/db/client";

type Context = { params: Promise<{ publicId: string }> };

export async function GET(request: Request, context: Context) {
  const { publicId } = await context.params;
  if (!(await requireCommercialOrderToken(publicId))) return apiFailure({ code: "ORDER_TOKEN_REQUIRED", message: "Заказ недоступен в этой сессии." }, 403);
  try {
    const url = new URL(request.url);
    const paymentReturn = url.searchParams.get("paymentReturn");
    if (paymentReturn === "1" || paymentReturn === "paymentCancelled=1") {
      const order = await prisma.commercialOrder.findUnique({
        where: { publicId },
        select: { id: true, publicId: true, paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, select: { publicId: true } } }
      });
      const attemptPublicId = order?.paymentAttempts[0]?.publicId;
      const returnResult = paymentReturn === "paymentCancelled=1" ? "cancelled" as const : "returned" as const;
      await ensurePaymentReturnViewedAnalytics({
        orderPublicId: publicId,
        orderId: order?.id ?? publicId,
        ...(attemptPublicId ? { paymentAttemptPublicId: attemptPublicId } : {}),
        returnResult
      });
    }
    const status = await commercialOrderStatus(publicId);
    await logEvent({ eventType: "order_status_viewed", entityType: "commercial_order", payload: { publicId } });
    return apiSuccess(status);
  } catch (error) {
    return commercialErrorResponse(error);
  }
}
