import { Prisma, type PaymentProvider as PrismaPaymentProvider, type PaymentStatus } from "@prisma/client";
import { getPaymentProvider, providerFromEnv } from "@/lib/payments/providers";
import { PaymentProviderConfigurationError, type CreateProviderPaymentResult, type InternalPaymentStatus } from "@/lib/payments/providers/types";
import { findOrCreateStudent } from "@/lib/users/students";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

function addDays(days: number) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

function appUrlFromRequest(request: Request) {
  return process.env.APP_URL || new URL(request.url).origin;
}

function paymentStatus(status: InternalPaymentStatus): PaymentStatus | null {
  const values = {
    pending: "PENDING",
    success: "SUCCESS",
    failed: "FAILED",
    cancelled: "CANCELLED",
    expired: "EXPIRED",
    refunded: "REFUNDED"
  } as const;

  return values[status] ?? null;
}

function providerResponseData(result: CreateProviderPaymentResult) {
  return {
    providerPaymentId: result.providerPaymentId,
    providerInvoiceId: result.providerInvoiceId ?? null,
    providerAccountNumber: result.providerAccountNumber ?? null,
    paymentUrl: result.paymentUrl ?? null,
    qrCodeUrl: result.qrCodeUrl ?? null,
    qrCodePayload: result.qrCodePayload ?? null,
    paymentInstructions: result.paymentInstructions ?? null,
    providerStatus: result.providerStatus ?? "pending",
    providerPayload: (result.rawPayload ?? {}) as Prisma.InputJsonValue
  };
}

export async function createPaymentForTest(input: {
  email: string;
  testId: string;
  request: Request;
  provider?: PrismaPaymentProvider;
}) {
  const test = await prisma.test.findFirst({
    where: {
      id: input.testId,
      status: "PUBLISHED",
      deletedAt: null
    },
    select: {
      id: true,
      title: true,
      slug: true,
      price: true,
      currency: true
    }
  });

  if (!test) {
    throw new Error("TEST_NOT_FOUND");
  }

  const currency = process.env.PAYMENT_CURRENCY || test.currency || "BYN";
  if (currency !== "BYN") {
    throw new Error("PAYMENT_CURRENCY_NOT_SUPPORTED");
  }

  const student = await findOrCreateStudent({ email: input.email });
  const providerKey = input.provider ?? providerFromEnv();
  const adapter = getPaymentProvider(providerKey);
  const appUrl = appUrlFromRequest(input.request);

  const payment = await prisma.payment.create({
    data: {
      userId: student.id,
      testId: test.id,
      amount: test.price,
      currency,
      provider: adapter.provider,
      status: "PENDING"
    }
  });

  await logEvent({
    eventType: "payment_created",
    actorUserId: student.id,
    entityType: "payment",
    entityId: payment.id,
    payload: {
      testId: test.id,
      provider: adapter.provider.toLowerCase(),
      amount: test.price,
      currency
    }
  });

  let providerPayment: CreateProviderPaymentResult;
  try {
    providerPayment = await adapter.createPayment({
      internalPaymentId: payment.id,
      testTitle: test.title,
      amount: test.price,
      currency,
      studentEmail: student.email,
      returnUrl: process.env.PAYMENT_SUCCESS_URL || `${appUrl}/tests/${test.slug}`,
      failUrl: process.env.PAYMENT_FAIL_URL || `${appUrl}/tests/${test.slug}`,
      notificationUrl:
        process.env.EXPRESSPAY_NOTIFICATION_URL ||
        `${appUrl}/api/payments/webhook/${adapter.provider.toLowerCase()}`,
      description: `Access to test: ${test.title}`
    });
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        providerStatus: "configuration_error",
        providerPayload: {
          error: error instanceof Error ? error.message : String(error)
        }
      }
    });

    await logEvent({
      eventType: "payment_provider_invoice_failed",
      actorUserId: student.id,
      entityType: "payment",
      entityId: payment.id,
      payload: {
        provider: adapter.provider.toLowerCase(),
        reason: error instanceof Error ? error.message : String(error)
      }
    });

    if (error instanceof PaymentProviderConfigurationError) {
      throw error;
    }
    throw new Error("PAYMENT_PROVIDER_CREATE_FAILED");
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: providerResponseData(providerPayment),
    include: paymentInclude
  });

  await logEvent({
    eventType: "payment_provider_invoice_created",
    actorUserId: student.id,
    entityType: "payment",
    entityId: payment.id,
    payload: {
      provider: adapter.provider.toLowerCase(),
      providerPaymentId: providerPayment.providerPaymentId,
      providerInvoiceId: providerPayment.providerInvoiceId ?? null
    }
  });

  return updated;
}

export const paymentInclude = {
  user: { select: { id: true, email: true } },
  test: { select: { title: true, slug: true, attemptsLimit: true, accessDays: true } },
  access: { select: { id: true, attemptsTotal: true, expiresAt: true } }
} satisfies Prisma.PaymentInclude;

export async function applyPaymentStatusUpdate(input: {
  paymentId?: string | null;
  providerPaymentId?: string | null;
  provider: PrismaPaymentProvider;
  providerStatus: string;
  status: InternalPaymentStatus | "unknown";
  rawPayload: unknown;
}) {
  const now = new Date();
  const where =
    input.paymentId
      ? { id: input.paymentId }
      : input.providerPaymentId
        ? { provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId } }
        : null;

  if (!where) {
    throw new Error("PAYMENT_NOT_IDENTIFIED");
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where,
      include: paymentInclude
    });

    if (payment.provider !== input.provider) {
      throw new Error("PAYMENT_PROVIDER_MISMATCH");
    }

    if (input.status === "unknown") {
      await tx.eventLog.create({
        data: {
          eventType: "payment_unknown_provider_status",
          actorUserId: payment.userId,
          entityType: "payment",
          entityId: payment.id,
          payload: {
            provider: input.provider.toLowerCase(),
            providerStatus: input.providerStatus,
            rawPayload: input.rawPayload
          } as Prisma.InputJsonValue
        }
      });

      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          providerStatus: input.providerStatus,
          providerWebhookPayload: input.rawPayload as Prisma.InputJsonValue
        },
        include: paymentInclude
      });

      return {
        payment: updated,
        access: updated.access,
        createdAccess: false,
        statusChanged: false
      };
    }

    const nextStatus = paymentStatus(input.status);
    if (!nextStatus) {
      throw new Error("PAYMENT_STATUS_UNSUPPORTED");
    }

    if (payment.status === "SUCCESS") {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          providerStatus: input.providerStatus,
          providerWebhookPayload: input.rawPayload as Prisma.InputJsonValue
        },
        include: paymentInclude
      });

      return {
        payment: updated,
        access: updated.access,
        createdAccess: false,
        statusChanged: false
      };
    }

    const statusChanged = payment.status !== nextStatus;
    const statusDates =
      nextStatus === "SUCCESS"
        ? { paidAt: payment.paidAt ?? now, npdReceiptRequired: true, npdReceiptCreated: false }
        : nextStatus === "FAILED"
          ? { failedAt: payment.failedAt ?? now }
          : nextStatus === "CANCELLED"
            ? { cancelledAt: payment.cancelledAt ?? now }
            : nextStatus === "EXPIRED"
              ? { expiredAt: payment.expiredAt ?? now }
              : {};

    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        providerStatus: input.providerStatus,
        providerWebhookPayload: input.rawPayload as Prisma.InputJsonValue,
        ...statusDates
      },
      include: paymentInclude
    });

    if (nextStatus !== "SUCCESS") {
      return {
        payment: updatedPayment,
        access: updatedPayment.access,
        createdAccess: false,
        statusChanged
      };
    }

    if (updatedPayment.access) {
      return {
        payment: updatedPayment,
        access: updatedPayment.access,
        createdAccess: false,
        statusChanged
      };
    }

    const access = await tx.access.create({
      data: {
        userId: updatedPayment.userId,
        testId: updatedPayment.testId,
        paymentId: updatedPayment.id,
        source: "PAYMENT",
        attemptsTotal: updatedPayment.test.attemptsLimit,
        attemptsAvailable: updatedPayment.test.attemptsLimit,
        expiresAt: addDays(updatedPayment.test.accessDays)
      }
    });

    return {
      payment: updatedPayment,
      access,
      createdAccess: true,
      statusChanged
    };
  });
}
