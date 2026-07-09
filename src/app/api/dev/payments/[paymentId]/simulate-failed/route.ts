import { apiFailure, apiSuccess } from "@/lib/api-response";
import { isMockPaymentsEnabled } from "@/lib/payments/mock-payments-enabled";
import { applyPaymentStatusUpdate } from "@/lib/payments/payment-service";
import { serializePayment } from "@/lib/payments/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    paymentId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  if (!isMockPaymentsEnabled()) {
    return apiFailure({ code: "DEV_ENDPOINT_DISABLED", message: "Dev payment endpoints are disabled" }, 404);
  }

  const { paymentId } = await context.params;
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Payment not found" }, 404);
  }

  const result = await applyPaymentStatusUpdate({
    paymentId: parsedId.data,
    provider: "MOCK",
    providerStatus: "failed",
    status: "failed",
    rawPayload: {
      provider: "mock",
      paymentId: parsedId.data,
      status: "failed",
      source: "dev_simulate_failed",
      receivedAt: new Date().toISOString()
    }
  });

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: result.payment.id },
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } },
      access: { select: { id: true } }
    }
  });

  await logEvent({
    eventType: "payment_failed",
    actorUserId: payment.userId,
    entityType: "payment",
    entityId: payment.id,
    payload: { provider: "mock", source: "dev_simulate_failed" }
  });

  return apiSuccess({
    payment: serializePayment(payment),
    createdAccess: false
  });
}
