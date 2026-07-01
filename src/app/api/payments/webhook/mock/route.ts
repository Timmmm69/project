import { apiFailure, apiSuccess } from "@/lib/api-response";
import { isMockPaymentsEnabled } from "@/lib/payments/mock-payments-enabled";
import { mockPaymentWebhookSchema } from "@/lib/payments/payment-schemas";
import { applyMockPaymentWebhook } from "@/lib/payments/mock-payment-service";
import { serializePayment } from "@/lib/payments/serialize";
import { prisma } from "@/server/db/client";
import { sendAccessEmail } from "@/server/emails/send-access-email";
import { logEvent } from "@/server/events/log-event";

function testLink(request: Request, slug: string) {
  const url = new URL(request.url);
  return `${url.origin}/tests/${slug}`;
}

export async function POST(request: Request) {
  if (!isMockPaymentsEnabled()) {
    return apiFailure({ code: "PAYMENT_PROVIDER_DISABLED", message: "Mock payments are disabled" }, 403);
  }

  const parsed = mockPaymentWebhookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid webhook data",
        details: parsed.error.flatten()
      },
      422
    );
  }

  let result;
  try {
    result = await applyMockPaymentWebhook(parsed.data);
  } catch (error) {
    if (error instanceof Error && error.message === "PAYMENT_PROVIDER_NOT_MOCK") {
      return apiFailure({ code: "INVALID_PROVIDER", message: "Payment provider is not mock" }, 409);
    }
    return apiFailure({ code: "NOT_FOUND", message: "Payment not found" }, 404);
  }

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: parsed.data.paymentId },
    include: {
      user: { select: { id: true, email: true } },
      test: { select: { title: true, slug: true } },
      access: { select: { id: true, attemptsTotal: true, expiresAt: true } }
    }
  });

  await logEvent({
    eventType: parsed.data.status === "success" ? "payment_success" : "payment_failed",
    actorUserId: payment.userId,
    entityType: "payment",
    entityId: payment.id,
    payload: {
      provider: "mock",
      idempotent: !result.statusChanged,
      createdAccess: result.createdAccess
    }
  });

  if (result.createdAccess && payment.access) {
    await logEvent({
      eventType: "access_created",
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
