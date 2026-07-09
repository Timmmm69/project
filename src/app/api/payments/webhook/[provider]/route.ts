import { apiFailure, apiSuccess } from "@/lib/api-response";
import { applyPaymentStatusUpdate } from "@/lib/payments/payment-service";
import { getPaymentProvider } from "@/lib/payments/providers";
import { serializePayment } from "@/lib/payments/serialize";
import { prisma } from "@/server/db/client";
import { sendAccessEmail } from "@/server/emails/send-access-email";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    provider: string;
  }>;
};

function providerFromParam(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized === "mock") {
    return "MOCK" as const;
  }
  if (["expresspay_epos", "expresspay", "epos", "erip"].includes(normalized)) {
    return "EXPRESSPAY_EPOS" as const;
  }
  return null;
}

function testLink(request: Request, slug: string) {
  const url = new URL(request.url);
  return `${process.env.APP_URL || url.origin}/tests/${slug}`;
}

export async function POST(request: Request, context: RouteContext) {
  const { provider } = await context.params;
  const providerKey = providerFromParam(provider);
  if (!providerKey) {
    return apiFailure({ code: "PAYMENT_PROVIDER_UNSUPPORTED", message: "Payment provider is not supported" }, 404);
  }

  const adapter = getPaymentProvider(providerKey);
  const payload = await request.json().catch(() => null);

  const signatureValid = await adapter.verifyWebhookSignature(payload, request.headers);
  if (!signatureValid) {
    await logEvent({
      eventType: "payment_webhook_invalid_signature",
      entityType: "payment",
      payload: {
        provider: providerKey.toLowerCase()
      }
    });
    return apiFailure({ code: "INVALID_SIGNATURE", message: "Invalid payment webhook signature" }, 401);
  }

  const providerResult = await adapter.handleWebhook(payload, request.headers);

  await logEvent({
    eventType: "payment_webhook_received",
    entityType: "payment",
    entityId: providerResult.internalPaymentId ?? undefined,
    payload: {
      provider: providerKey.toLowerCase(),
      providerStatus: providerResult.providerStatus,
      status: providerResult.status
    }
  });

  let result;
  try {
    result = await applyPaymentStatusUpdate({
      paymentId: providerResult.internalPaymentId,
      providerPaymentId: providerResult.providerPaymentId,
      provider: providerKey,
      providerStatus: providerResult.providerStatus,
      status: providerResult.status,
      rawPayload: providerResult.rawPayload
    });
  } catch {
    return apiFailure({ code: "PAYMENT_NOT_FOUND", message: "Payment not found" }, 404);
  }

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: result.payment.id },
    include: {
      user: { select: { id: true, email: true } },
      test: { select: { title: true, slug: true } },
      access: { select: { id: true, attemptsTotal: true, expiresAt: true } }
    }
  });

  const eventType =
    providerResult.status === "success"
      ? "payment_success"
      : providerResult.status === "failed"
        ? "payment_failed"
        : providerResult.status === "cancelled"
          ? "payment_cancelled"
          : providerResult.status === "expired"
            ? "payment_expired"
            : "payment_status_updated";

  await logEvent({
    eventType,
    actorUserId: payment.userId,
    entityType: "payment",
    entityId: payment.id,
    payload: {
      provider: providerKey.toLowerCase(),
      idempotent: !result.statusChanged,
      createdAccess: result.createdAccess
    }
  });

  if (!result.statusChanged && providerResult.status === "success") {
    await logEvent({
      eventType: "payment_duplicate_webhook_ignored",
      actorUserId: payment.userId,
      entityType: "payment",
      entityId: payment.id,
      payload: { provider: providerKey.toLowerCase() }
    });
  }

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
