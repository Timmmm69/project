import { Prisma, type CommercialPaymentAttemptStatus, type CommercialPaymentProvider, type CommercialOrderStatus } from "@prisma/client";
import { COMMERCIAL_CURRENCY, COMMERCIAL_PRICE_MINOR, commercialLegalConfig } from "@/lib/commercial/config";
import type { CommercialPaymentProviderAdapter, ProviderNotification } from "@/lib/commercial/providers";
import { createLookupToken, hashLookupToken, payloadHash } from "@/lib/commercial/security";
import { canTransitionOrder, canTransitionPaymentAttempt } from "@/lib/commercial/state-machine";
import { normalizeEmail } from "@/lib/validation/email";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

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
  const activeAttempt = await tx.attempt.findFirst({
    where: {
      user: { email, role: "STUDENT", deletedAt: null },
      testId,
      status: "STARTED",
      access: { revokedAt: null, expiresAt: { gt: now } }
    },
    select: { id: true }
  });
  if (activeAttempt) return "RESUME_TEST" as const;

  const unusedAccess = await tx.access.findFirst({
    where: {
      user: { email, role: "STUDENT", deletedAt: null },
      testId,
      revokedAt: null,
      expiresAt: { gt: now },
      attemptsAvailable: { gt: 0 }
    },
    select: { id: true }
  });
  if (unusedAccess) return "START_TEST" as const;
  return null;
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

  const outcome = await prisma.$transaction(async (tx) => {
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
      return { kind: "existing" as const, productId: product.id, productCode: product.code, nextAction };
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
      return { kind: "created" as const, order: updated, lookupToken: token, idempotent: true };
    }

    const pending = await tx.commercialOrder.findFirst({
      where: { commercialProductId: product.id, emailNormalized, status: { in: ["CREATED", "PENDING"] } },
      orderBy: { createdAt: "desc" }
    });
    if (pending) {
      return { kind: "pending" as const };
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
    return { kind: "created" as const, order, lookupToken: token, idempotent: false };
  });

  if (outcome.kind === "existing") {
    await logEvent({
      eventType: "existing_access_found",
      entityType: "commercial_product",
      entityId: outcome.productId,
      payload: { productCode: outcome.productCode, nextAction: outcome.nextAction }
    });
    throw new CommercialError("EXISTING_ACCESS", "Existing access found", outcome.nextAction);
  }
  if (outcome.kind === "pending") {
    throw new CommercialError("ORDER_ALREADY_PENDING");
  }
  return { order: outcome.order, lookupToken: outcome.lookupToken, idempotent: outcome.idempotent };
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

  const merchantReference = `rto-${order.publicId}-${createLookupToken().slice(0, 12)}`;
  let pendingAttempt;
  try {
    pendingAttempt = await prisma.$transaction(async (tx) => {
      const previous = await tx.commercialPaymentAttempt.findUnique({
        where: { commercialOrderId_checkoutIdempotencyKey: { commercialOrderId: order.id, checkoutIdempotencyKey: input.idempotencyKey } }
      });
      if (previous) return previous;

      const active = await tx.commercialPaymentAttempt.findFirst({
        where: { commercialOrderId: order.id, status: { in: ["CREATED", "PENDING"] } },
        orderBy: { createdAt: "desc" }
      });
      if (active) {
        if (active.paymentUrl && active.providerFields) return active;
        throw new CommercialError("PAYMENT_SESSION_ALREADY_ACTIVE");
      }

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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const active = await prisma.commercialPaymentAttempt.findFirst({
        where: { commercialOrderId: order.id, status: { in: ["CREATED", "PENDING"] } },
        orderBy: { createdAt: "desc" }
      });
      if (active?.paymentUrl && active.providerFields) return active;
      throw new CommercialError("PAYMENT_SESSION_ALREADY_ACTIVE");
    }
    throw error;
  }

  if (pendingAttempt.paymentUrl && pendingAttempt.providerFields) return pendingAttempt;

  try {
    const returnQuery = new URLSearchParams({ commercialOrder: order.publicId, paymentReturn: "1" }).toString();
    const returnUrl = `${input.appUrl}/tests/${order.product.test.slug}?${returnQuery}`;
    const checkout = await input.provider.createCheckout({
      merchantReference: pendingAttempt.merchantReference,
      amountMinor: order.priceMinor,
      currency: order.currency,
      productName: order.productNameSnapshot,
      returnUrl,
      cancelUrl: `${returnUrl}&paymentCancelled=1`,
      notificationUrl: `${input.appUrl}/api/payments/webpay/notify`,
      checkoutProxyUrl: `${input.appUrl}/api/commercial/fake-checkout`
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
      if (current.provider !== input.provider) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "PROVIDER_MISMATCH", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }
      if (current.amountMinor !== input.notification.amountMinor || current.currency !== input.notification.currency) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: current.amountMinor !== input.notification.amountMinor ? "AMOUNT_MISMATCH" : "CURRENCY_MISMATCH", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }

      const now = new Date();
      const nextAttemptStatus = paymentAttemptStatus(input.notification.status);
      const nextOrderStatus = orderStatus(input.notification.status);
      if (current.status === nextAttemptStatus && current.order.status === nextOrderStatus) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: now } });
        return { duplicate: false, grantedAccess: Boolean(current.order.access), rejected: false };
      }
      if (!canTransitionPaymentAttempt(current.status, nextAttemptStatus) || !canTransitionOrder(current.order.status, nextOrderStatus)) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "ILLEGAL_STATUS_TRANSITION", processedAt: now } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }
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
      const duplicate = await prisma.commercialPaymentEvent.findFirst({
        where: {
          provider: input.provider,
          OR: [
            ...(input.notification.providerEventKey ? [{ providerEventKey: input.notification.providerEventKey }] : []),
            { payloadHash: hash }
          ]
        },
        select: { id: true }
      });
      if (duplicate) return { duplicate: true, grantedAccess: false, rejected: false };
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
    nextAction,
    nextUrl: nextAction === "RESUME_TEST" && attempt ? `/attempts/${attempt.id}` : nextAction === "VIEW_RESULT" && attempt ? `/results/${attempt.id}` : null
  };
}

export async function claimCommercialOrderAccess(publicId: string) {
  const order = await getCommercialOrder(publicId);
  const access = await prisma.access.findUnique({
    where: { commercialOrderId: order.id },
    include: {
      user: { select: { id: true, email: true, role: true, deletedAt: true } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!access || order.status !== "PAID" || access.revokedAt || access.expiresAt <= new Date()) {
    throw new CommercialError("PAYMENT_NOT_CONFIRMED");
  }
  if (access.user.role !== "STUDENT" || access.user.deletedAt) {
    throw new CommercialError("EMAIL_NOT_AVAILABLE");
  }

  const attempt = access.attempts[0] ?? null;
  const nextAction: CommercialNextAction = attempt?.status === "STARTED"
    ? "RESUME_TEST"
    : attempt && access.attemptsAvailable <= 0
      ? "VIEW_RESULT"
      : "START_TEST";
  return {
    student: { userId: access.user.id, email: access.user.email, role: "STUDENT" as const },
    nextAction,
    nextUrl: nextAction === "RESUME_TEST" && attempt ? `/attempts/${attempt.id}` : nextAction === "VIEW_RESULT" && attempt ? `/results/${attempt.id}` : `/tests/${order.product.test.slug}`,
    testId: order.testIdSnapshot
  };
}
