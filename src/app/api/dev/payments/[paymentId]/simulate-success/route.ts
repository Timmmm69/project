import { apiFailure, apiSuccess } from "@/lib/api-response";
import { isMockPaymentsEnabled } from "@/lib/payments/mock-payments-enabled";
import { applyPaymentStatusUpdate } from "@/lib/payments/payment-service";
import { serializePayment } from "@/lib/payments/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { sendAccessEmail } from "@/server/emails/send-access-email";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    paymentId: string;
  }>;
};

function testLink(request: Request, slug: string) {
  const url = new URL(request.url);
  return `${process.env.APP_URL || url.origin}/tests/${slug}`;
}

export async function POST(request: Request, context: RouteContext) {
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
    providerStatus: "success",
    status: "success",
    rawPayload: {
      provider: "mock",
      paymentId: parsedId.data,
      status: "success",
      source: "dev_simulate_success",
      receivedAt: new Date().toISOString()
    }
  });

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: result.payment.id },
    include: {
      user: { select: { id: true, email: true } },
      test: { select: { title: true, slug: true } },
      access: { select: { id: true, attemptsTotal: true, expiresAt: true } }
    }
  });

  await logEvent({
    eventType: result.statusChanged ? "payment_success" : "payment_duplicate_webhook_ignored",
    actorUserId: payment.userId,
    entityType: "payment",
    entityId: payment.id,
    payload: { provider: "mock", source: "dev_simulate_success", createdAccess: result.createdAccess }
  });

  if (result.createdAccess && payment.access) {
    await logEvent({
      eventType: "payment_access_created",
      actorUserId: payment.userId,
      entityType: "access",
      entityId: payment.access.id,
      payload: { source: "payment", paymentId: payment.id }
    });

    try {
      await sendAccessEmail({
        userId: payment.user.id,
        email: payment.user.email,
        type: "payment_success",
        testTitle: payment.test.title,
        testLink: testLink(request, payment.test.slug),
        attemptsTotal: payment.access.attemptsTotal,
        expiresAt: payment.access.expiresAt
      });
    } catch (error) {
      await logEvent({
        eventType: "email_send_failed",
        actorUserId: payment.userId,
        entityType: "payment",
        entityId: payment.id,
        payload: { reason: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  return apiSuccess({
    payment: serializePayment(payment),
    createdAccess: result.createdAccess
  });
}
