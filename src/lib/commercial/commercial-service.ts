import { Prisma, type CommercialPaymentAttemptStatus, type CommercialPaymentProvider, type CommercialOrderStatus } from "@prisma/client";
import { COMMERCIAL_CURRENCY, COMMERCIAL_PRICE_MINOR, commercialLegalConfig } from "@/lib/commercial/config";
import type { CommercialPaymentProviderAdapter, ProviderNotification } from "@/lib/commercial/providers";
import { createLookupToken, hashLookupToken, payloadHash } from "@/lib/commercial/security";
import { normalizeEmail } from "@/lib/validation/email";
import { prisma } from "@/server/db/client";

type Tx = Prisma.TransactionClient;

export type CommercialNextAction = "START_TEST" | "RESUME_TEST" | "VIEW_RESULT" | "WAIT_FOR_PAYMENT" | "NONE";

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function orderTokenCookieName(publicId: string) {
  return `commercial_order_${publicId}`;
}

export { orderTokenCookieName };

export class CommercialError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly nextAction?: CommercialNextAction
  ) {
    super(message);
    this.name = "CommercialError";
  }
}

async function existingAccessAction(tx: Tx, email: string, testId: string, now: Date) {
  const access = await tx.access.findFirst({
    where: {
      user: { email, role: "STUDENT", deletedAt: null },
      testId,
      revokedAt: null,
      expiresAt: { gt: now }
    },
    orderBy: { expiresAt: "asc" },
    select: { id: true, attemptsAvailable: true, userId: true }
  });
  if (!access) return null;

  const started = await tx.attempt.findFirst({
    where: { accessId: access.id, status: "STARTED" },
    select: { id: true }
  });
  if (started) return "RESUME_TEST" as const;

  const completed = await tx.attempt.findFirst({
    where: { accessId: access.id, status: { in: ["COMPLETED", "EXPIRED"] } },
    select: { id: true }
  });
  if (completed && access.attemptsAvailable <= 0) return "VIEW_RESULT" as const;
  return "START_TEST" as const;
}

function legalVersionMatches(version: string) {
  const legal = commercialLegalConfig();
  return Boolean(legal.version) && version === legal.version;
}

export async function createCommercialOrder(input: {
  productCode: string;
  email: string;
  adultBuyerConfirmed: boolean;
  legalBundleVersion: string;
  idempotencyKey: string;
}) {
  if (!input.adultBuyerConfirmed) {
    throw new CommercialError("ADULT_CONFIRMATION_REQUIRED");
  }
  if (!legalVersionMatches(input.legalBundleVersion)) {
    throw new CommercialError("STALE_LEGAL_BUNDLE");
  }

  const now = new Date();
  const emailNormalized = normalizeEmail(input.email);
  const legal = commercialLegalConfig();
  const token = createLookupToken();

  return prisma.$transaction(async (tx) => {
    const product = await tx.commercialProduct.findFirst({
      where: { code: input.productCode, isActive: true },
      include: { test: { select: { id: true, status: true, deletedAt: true } } }
    });
    if (!product || product.test.deletedAt || product.test.status !== "PUBLISHED") {
      throw new CommercialError("COMMERCIAL_PRODUCT_UNAVAILABLE");
    }
    if (product.priceMinor !== COMMERCIAL_PRICE_MINOR || product.currency !== COMMERCIAL_CURRENCY) {
      throw new CommercialError("COMMERCIAL_PRODUCT_CONFIGURATION_INVALID");
    }

    const nextAction = await existingAccessAction(tx, emailNormalized, product.testId, now);
    if (nextAction) {
      await tx.eventLog.create({
        data: { eventType: "existing_access_found", entityType: "commercial_product", entityId: product.id, payload: { productCode: product.code, nextAction } }
      });
      throw new CommercialError("EXISTING_ACCESS", "Existing access found", nextAction);
    }

    const existingByKey = await tx.commercialOrder.findUnique({
      where: { commercialProductId_idempotencyKey: { commercialProductId: product.id, idempotencyKey: input.idempotencyKey } }
    });
    if (existingByKey) {
      if (existingByKey.emailNormalized !== emailNormalized) {
        throw new CommercialError("IDEMPOTENCY_KEY_CONFLICT");
      }
      const updated = await tx.commercialOrder.update({
        where: { id: existingByKey.id },
        data: { lookupTokenHash: hashLookupToken(token) }
      });
      return { order: updated, lookupToken: token, idempotent: true };
    }

    const pending = await tx.commercialOrder.findFirst({
      where: { commercialProductId: product.id, emailNormalized, status: { in: ["CREATED", "PENDING"] } },
      orderBy: { createdAt: "desc" }
    });
    if (pending) {
      const updated = await tx.commercialOrder.update({
        where: { id: pending.id },
        data: { lookupTokenHash: hashLookupToken(token) }
      });
      return { order: updated, lookupToken: token, idempotent: true };
    }

    const order = await tx.commercialOrder.create({
      data: {
        commercialProductId: product.id,
        testIdSnapshot: product.testId,
        productNameSnapshot: product.name,
        priceMinor: product.priceMinor,
        currency: product.currency,
        emailOriginal: input.email.trim(),
        emailNormalized,
        status: "CREATED",
        offerVersion: legal.version,
        privacyVersion: legal.version,
        refundPolicyVersion: legal.version,
        disclaimerVersion: legal.version,
        adultBuyerConfirmedAt: now,
        idempotencyKey: input.idempotencyKey,
        lookupTokenHash: hashLookupToken(token)
      }
    });
    await tx.eventLog.create({
      data: { eventType: "order_created", entityType: "commercial_order", entityId: order.id, payload: { productCode: product.code, priceMinor: product.priceMinor, currency: product.currency } }
    });
    return { order, lookupToken: token, idempotent: false };
  });
}

export async function getCommercialOrder(publicId: string) {
  const order = await prisma.commercialOrder.findUnique({
    where: { publicId },
    include: {
      product: { include: { test: { select: { slug: true } } } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
      access: { include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } } }
    }
  });
  if (!order) throw new CommercialError("ORDER_NOT_FOUND");
  return order;
}

export async function createCommercialPaymentSession(input: {
  publicId: string;
  idempotencyKey: string;
  provider: CommercialPaymentProviderAdapter;
  appUrl: string;
}) {
  const order = await getCommercialOrder(input.publicId);
  if (order.status === "PAID") throw new CommercialError("ORDER_ALREADY_PAID");

  const previous = await prisma.commercialPaymentAttempt.findUnique({
    where: { commercialOrderId_checkoutIdempotencyKey: { commercialOrderId: order.id, checkoutIdempotencyKey: input.idempotencyKey } }
  });
  if (previous) return previous;

  const merchantReference = `rto-${order.publicId}-${createLookupToken().slice(0, 12)}`;
  const pendingAttempt = await prisma.$transaction(async (tx) => {
    const attempt = await tx.commercialPaymentAttempt.create({
      data: {
        commercialOrderId: order.id,
        provider: input.provider.provider,
        merchantReference,
        status: "PENDING",
        amountMinor: order.priceMinor,
        currency: order.currency,
        checkoutIdempotencyKey: input.idempotencyKey
      }
    });
    await tx.commercialOrder.update({ where: { id: order.id }, data: { status: "PENDING" } });
    await tx.eventLog.create({ data: { eventType: "payment_redirect_started", entityType: "commercial_payment_attempt", entityId: attempt.id, payload: { provider: input.provider.provider, amountMinor: order.priceMinor, currency: order.currency } } });
    return attempt;
  });

  try {
    const checkout = await input.provider.createCheckout({
      merchantReference,
      amountMinor: order.priceMinor,
      currency: order.currency,
      productName: order.productNameSnapshot,
      returnUrl: `${input.appUrl}/tests/${order.product.test.slug}`,
      cancelUrl: `${input.appUrl}/tests/${order.product.test.slug}`,
      notificationUrl: `${input.appUrl}/api/payments/webpay/notify`
    });
    return prisma.commercialPaymentAttempt.update({
      where: { id: pendingAttempt.id },
      data: { paymentUrl: checkout.actionUrl, providerFields: checkout.fields, expiresAt: checkout.expiresAt }
    });
  } catch (error) {
    await prisma.commercialPaymentAttempt.update({
      where: { id: pendingAttempt.id },
      data: { status: "FAILED", failureCode: error instanceof Error ? error.message : "CHECKOUT_CREATE_FAILED", failureMessageSafe: "Не удалось создать платёжную сессию." }
    });
    await prisma.commercialOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
    throw error;
  }
}

function paymentAttemptStatus(status: ProviderNotification["status"]): CommercialPaymentAttemptStatus {
  return status.toUpperCase() as CommercialPaymentAttemptStatus;
}

function orderStatus(status: ProviderNotification["status"]): CommercialOrderStatus {
  return status.toUpperCase() as CommercialOrderStatus;
}

export async function processCommercialProviderNotification(input: {
  notification: ProviderNotification;
  rawBody: string;
  provider: CommercialPaymentProvider;
}) {
  const hash = payloadHash(input.rawBody);
  const attempt = await prisma.commercialPaymentAttempt.findUnique({ where: { merchantReference: input.notification.merchantReference } });

  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.commercialPaymentEvent.create({
        data: {
          commercialPaymentAttemptId: attempt?.id,
          provider: input.provider,
          providerEventKey: input.notification.providerEventKey,
          payloadHash: hash,
          eventType: input.notification.eventType,
          signatureValid: input.notification.signatureValid,
          redactedPayload: input.notification.redactedPayload
        }
      });

      if (!attempt || !input.notification.signatureValid) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: !attempt ? "MERCHANT_REFERENCE_MISMATCH" : "INVALID_SIGNATURE", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }

      const current = await tx.commercialPaymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        include: { order: { include: { product: true, access: true } } }
      });
      if (current.amountMinor !== input.notification.amountMinor || current.currency !== input.notification.currency) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: current.amountMinor !== input.notification.amountMinor ? "AMOUNT_MISMATCH" : "CURRENCY_MISMATCH", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }

      const now = new Date();
      if (current.status === "PAID") {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: now } });
        return { duplicate: false, grantedAccess: Boolean(current.order.access), rejected: false };
      }

      const nextAttemptStatus = paymentAttemptStatus(input.notification.status);
      const nextOrderStatus = orderStatus(input.notification.status);
      await tx.commercialPaymentAttempt.update({
        where: { id: current.id },
        data: {
          status: nextAttemptStatus,
          providerPaymentId: input.notification.providerPaymentId,
          verifiedAt: now,
          ...(nextAttemptStatus === "PAID" ? { paidAt: now } : { failureCode: nextAttemptStatus === "FAILED" ? "PAYMENT_FAILED" : null })
        }
      });
      await tx.commercialOrder.update({ where: { id: current.order.id }, data: { status: nextOrderStatus, ...(nextOrderStatus === "PAID" ? { paidAt: now } : {}) } });

      let grantedAccess = false;
      if (nextAttemptStatus === "PAID") {
        const student = await tx.user.findUnique({ where: { email: current.order.emailNormalized } });
        const user = student ?? await tx.user.create({ data: { email: current.order.emailNormalized, role: "STUDENT" } });
        if (user.role !== "STUDENT" || user.deletedAt) throw new CommercialError("EMAIL_NOT_AVAILABLE");
        const existing = await tx.access.findUnique({ where: { commercialOrderId: current.order.id } });
        if (!existing) {
          const deadline = addDays(now, current.order.product.startWindowDays);
          await tx.access.create({
            data: {
              userId: user.id,
              testId: current.order.testIdSnapshot,
              source: "COMMERCIAL",
              attemptsTotal: current.order.product.attemptLimit,
              attemptsAvailable: current.order.product.attemptLimit,
              expiresAt: deadline,
              commercialProductId: current.order.commercialProductId,
              commercialOrderId: current.order.id,
              commercialPaymentAttemptId: current.id,
              grantedAt: now,
              startDeadlineAt: deadline
            }
          });
          grantedAccess = true;
          await tx.eventLog.create({ data: { eventType: "access_granted", actorUserId: user.id, entityType: "commercial_order", entityId: current.order.id, payload: { source: "commercial", attempts: current.order.product.attemptLimit } } });
        }
      }
      await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: now } });
      await tx.eventLog.create({ data: { eventType: "payment_status_changed", entityType: "commercial_payment_attempt", entityId: current.id, payload: { provider: input.provider, status: nextAttemptStatus } } });
      return { duplicate: false, grantedAccess, rejected: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { duplicate: true, grantedAccess: false, rejected: false };
    }
    throw error;
  }
}

export async function commercialOrderStatus(publicId: string) {
  const order = await getCommercialOrder(publicId);
  const payment = order.paymentAttempts[0] ?? null;
  const attempt = order.access?.attempts[0] ?? null;
  const nextAction: CommercialNextAction = order.access
    ? attempt?.status === "STARTED"
      ? "RESUME_TEST"
      : attempt
        ? "VIEW_RESULT"
        : "START_TEST"
    : order.status === "PENDING"
      ? "WAIT_FOR_PAYMENT"
      : "NONE";
  return {
    orderStatus: order.status.toLowerCase(),
    paymentStatus: payment?.status.toLowerCase() ?? null,
    accessStatus: order.access ? "granted" : "none",
    nextAction
  };
}
