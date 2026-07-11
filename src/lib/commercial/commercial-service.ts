import { Prisma, type CommercialPaymentAttemptStatus, type CommercialPaymentProvider, type CommercialOrderStatus } from "@prisma/client";
import { COMMERCIAL_CURRENCY, COMMERCIAL_PRICE_MINOR, commercialLegalConfig } from "@/lib/commercial/config";
import type { CommercialPaymentProviderAdapter, ProviderNotification } from "@/lib/commercial/providers";
import { createLookupToken, hashLookupToken, payloadHash } from "@/lib/commercial/security";
import { canOpenNewPaymentAttempt, canTransitionOrder, canTransitionPaymentAttempt } from "@/lib/commercial/state-machine";
import { normalizeEmail } from "@/lib/validation/email";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

type Tx = Prisma.TransactionClient;

async function lockCommercialOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "commercial_orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`);
}

async function lockCommercialPaymentAttempt(tx: Tx, attemptId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "commercial_payment_attempts" WHERE "id" = ${attemptId}::uuid FOR UPDATE`);
}

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

async function recoverConcurrentOrderCreation(input: {
  productCode: string;
  emailNormalized: string;
  idempotencyKey: string;
  lookupToken: string;
}, integrityError: Prisma.PrismaClientKnownRequestError) {
  const product = await prisma.commercialProduct.findUnique({
    where: { code: input.productCode },
    select: { id: true }
  });
  if (!product) throw integrityError;

  const sameRequest = await prisma.commercialOrder.findUnique({
    where: { commercialProductId_idempotencyKey: { commercialProductId: product.id, idempotencyKey: input.idempotencyKey } }
  });
  if (sameRequest) {
    if (sameRequest.emailNormalized !== input.emailNormalized) {
      throw new CommercialError("IDEMPOTENCY_KEY_CONFLICT");
    }
    const order = await prisma.commercialOrder.update({
      where: { id: sameRequest.id },
      data: { lookupTokenHash: hashLookupToken(input.lookupToken) }
    });
    return { order, lookupToken: input.lookupToken, idempotent: true };
  }

  const openOrder = await prisma.commercialOrder.findFirst({
    where: {
      commercialProductId: product.id,
      emailNormalized: input.emailNormalized,
      status: { in: ["CREATED", "PENDING"] }
    },
    select: { id: true }
  });
  if (openOrder) throw new CommercialError("ORDER_ALREADY_PENDING");
  throw integrityError;
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

  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return recoverConcurrentOrderCreation({
        productCode: input.productCode,
        emailNormalized,
        idempotencyKey: input.idempotencyKey,
        lookupToken: token
      }, error);
    }
    throw error;
  }

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
  const merchantReference = `rto-${input.publicId}-${createLookupToken().slice(0, 12)}`;
  let decision;
  try {
    decision = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "commercial_orders" WHERE "public_id" = ${input.publicId} FOR UPDATE
      `);
      if (locked.length !== 1) throw new CommercialError("ORDER_NOT_FOUND");
      const order = await tx.commercialOrder.findUniqueOrThrow({
        where: { publicId: input.publicId },
        include: { product: { include: { test: { select: { slug: true } } } } }
      });
      if (order.status === "PAID") throw new CommercialError("ORDER_ALREADY_PAID");

      const previous = await tx.commercialPaymentAttempt.findUnique({
        where: { commercialOrderId_checkoutIdempotencyKey: { commercialOrderId: order.id, checkoutIdempotencyKey: input.idempotencyKey } }
      });
      if (previous) {
        await lockCommercialPaymentAttempt(tx, previous.id);
        const current = await tx.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: previous.id } });
        return { attempt: current, order, created: false as const };
      }

      const active = await tx.commercialPaymentAttempt.findFirst({
        where: { commercialOrderId: order.id, status: { in: ["CREATED", "PENDING"] } },
        orderBy: { createdAt: "desc" }
      });
      if (active) {
        await lockCommercialPaymentAttempt(tx, active.id);
        const current = await tx.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: active.id } });
        if (current.paymentUrl && current.providerFields) return { attempt: current, order, created: false as const };
        throw new CommercialError("PAYMENT_SESSION_ALREADY_ACTIVE");
      }
      if (!canOpenNewPaymentAttempt(order.status)) throw new CommercialError("ORDER_ALREADY_PAID");

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
      const movedToPending = await tx.commercialOrder.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: "PENDING" }
      });
      if (movedToPending.count !== 1) throw new CommercialError("PAYMENT_STATE_CHANGED");
      await tx.eventLog.create({ data: { eventType: "payment_redirect_started", entityType: "commercial_payment_attempt", entityId: attempt.id, payload: { provider: input.provider.provider, amountMinor: order.priceMinor, currency: order.currency } } });
      return { attempt, order, created: true as const };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const order = await prisma.commercialOrder.findUnique({ where: { publicId: input.publicId }, select: { id: true } });
      if (order) {
        const active = await prisma.commercialPaymentAttempt.findFirst({
          where: { commercialOrderId: order.id, status: { in: ["CREATED", "PENDING"] } },
          orderBy: { createdAt: "desc" }
        });
        if (active?.paymentUrl && active.providerFields) return active;
        if (active) throw new CommercialError("PAYMENT_SESSION_ALREADY_ACTIVE");
      }
    }
    throw error;
  }

  if (!decision.created) {
    if (decision.attempt.paymentUrl && decision.attempt.providerFields) return decision.attempt;
    throw new CommercialError("PAYMENT_SESSION_ALREADY_ACTIVE");
  }

  let checkout;
  try {
    const returnQuery = new URLSearchParams({ commercialOrder: decision.order.publicId, paymentReturn: "1" }).toString();
    const returnUrl = `${input.appUrl}/tests/${decision.order.product.test.slug}?${returnQuery}`;
    checkout = await input.provider.createCheckout({
      merchantReference: decision.attempt.merchantReference,
      amountMinor: decision.order.priceMinor,
      currency: decision.order.currency,
      productName: decision.order.productNameSnapshot,
      returnUrl,
      cancelUrl: `${returnUrl}&paymentCancelled=1`,
      notificationUrl: `${input.appUrl}/api/payments/webpay/notify`,
      checkoutProxyUrl: `${input.appUrl}/api/commercial/fake-checkout`
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await lockCommercialOrder(tx, decision.order.id);
      await lockCommercialPaymentAttempt(tx, decision.attempt.id);
      const order = await tx.commercialOrder.findUniqueOrThrow({ where: { id: decision.order.id }, select: { status: true } });
      const attempt = await tx.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: decision.attempt.id }, select: { status: true } });
      if (attempt.status === "PENDING" && canTransitionPaymentAttempt(attempt.status, "FAILED")) {
        await tx.commercialPaymentAttempt.updateMany({
          where: { id: decision.attempt.id, status: attempt.status },
          data: { status: "FAILED", failureCode: error instanceof Error ? error.message : "CHECKOUT_CREATE_FAILED", failureMessageSafe: "Не удалось создать платёжную сессию." }
        });
      }
      if (order.status === "PENDING" && canTransitionOrder(order.status, "FAILED")) {
        await tx.commercialOrder.updateMany({ where: { id: decision.order.id, status: order.status }, data: { status: "FAILED" } });
      }
    });
    throw error;
  }

  const finalized = await prisma.$transaction(async (tx) => {
    await lockCommercialOrder(tx, decision.order.id);
    await lockCommercialPaymentAttempt(tx, decision.attempt.id);
    const order = await tx.commercialOrder.findUniqueOrThrow({ where: { id: decision.order.id }, select: { status: true } });
    const attempt = await tx.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: decision.attempt.id } });
    if (order.status === "PAID") {
      if (attempt.status === "PENDING" && canTransitionPaymentAttempt(attempt.status, "CANCELLED")) {
        await tx.commercialPaymentAttempt.updateMany({ where: { id: attempt.id, status: attempt.status }, data: { status: "CANCELLED", failureCode: "ORDER_ALREADY_PAID" } });
      }
      return { kind: "paid" as const };
    }
    if (attempt.status !== "PENDING") throw new CommercialError("PAYMENT_SESSION_ALREADY_ACTIVE");
    const updated = await tx.commercialPaymentAttempt.update({
      where: { id: attempt.id },
      data: { paymentUrl: checkout.actionUrl, providerFields: checkout.fields, expiresAt: checkout.expiresAt }
    });
    return { kind: "ready" as const, attempt: updated };
  });
  if (finalized.kind === "paid") throw new CommercialError("ORDER_ALREADY_PAID");
  return finalized.attempt;
}

function paymentAttemptStatus(status: ProviderNotification["status"]): CommercialPaymentAttemptStatus {
  return status.toUpperCase() as CommercialPaymentAttemptStatus;
}

function orderStatus(status: ProviderNotification["status"]): CommercialOrderStatus {
  return status.toUpperCase() as CommercialOrderStatus;
}

export function hasProviderPaymentIdConflict(input: {
  currentStatus: CommercialPaymentAttemptStatus;
  currentProviderPaymentId: string | null;
  nextStatus: CommercialPaymentAttemptStatus;
  nextProviderPaymentId: string | null;
}) {
  return input.currentStatus === "PAID" &&
    input.nextStatus === "PAID" &&
    input.currentProviderPaymentId !== input.nextProviderPaymentId;
}

export function commercialNotificationMismatch(input: {
  expectedProvider: CommercialPaymentProvider;
  expectedMerchantReference: string;
  expectedAmountMinor: number;
  expectedCurrency: string;
  provider: CommercialPaymentProvider;
  notification: ProviderNotification;
}) {
  if (input.expectedMerchantReference !== input.notification.merchantReference) return "MERCHANT_REFERENCE_MISMATCH";
  if (input.expectedProvider !== input.provider) return "PROVIDER_MISMATCH";
  if (input.expectedAmountMinor !== input.notification.amountMinor) return "AMOUNT_MISMATCH";
  if (input.expectedCurrency !== input.notification.currency) return "CURRENCY_MISMATCH";
  return null;
}

function isCommercialPaymentEventUniqueConflict(error: Prisma.PrismaClientKnownRequestError) {
  if (error.meta?.modelName === "CommercialPaymentEvent") return true;
  const target = error.meta?.target;
  const value = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return /commercial_payment_events|payload_?hash|provider_?event_?key/i.test(value);
}

export async function processCommercialProviderNotification(input: {
  notification: ProviderNotification;
  rawBody: string;
  provider: CommercialPaymentProvider;
}) {
  const hash = payloadHash(input.rawBody);
  const attempt = await prisma.commercialPaymentAttempt.findUnique({
    where: { merchantReference: input.notification.merchantReference },
    select: { id: true, commercialOrderId: true }
  });

  try {
    return await prisma.$transaction(async (tx) => {
      if (!attempt) {
        const event = await tx.commercialPaymentEvent.create({
          data: {
            provider: input.provider,
            providerEventKey: input.notification.signatureValid ? input.notification.providerEventKey : null,
            payloadHash: hash,
            eventType: input.notification.eventType,
            signatureValid: input.notification.signatureValid,
            redactedPayload: input.notification.redactedPayload
          }
        });
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "MERCHANT_REFERENCE_MISMATCH", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }

      await lockCommercialOrder(tx, attempt.commercialOrderId);
      await lockCommercialPaymentAttempt(tx, attempt.id);
      const event = await tx.commercialPaymentEvent.create({
        data: {
          commercialPaymentAttemptId: attempt?.id,
          provider: input.provider,
          providerEventKey: input.notification.signatureValid ? input.notification.providerEventKey : null,
          payloadHash: hash,
          eventType: input.notification.eventType,
          signatureValid: input.notification.signatureValid,
          redactedPayload: input.notification.redactedPayload
        }
      });

      if (!input.notification.signatureValid) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "INVALID_SIGNATURE", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }

      const current = await tx.commercialPaymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        include: { order: { include: { product: true, access: true } } }
      });
      if (current.commercialOrderId !== attempt.commercialOrderId) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "MERCHANT_REFERENCE_MISMATCH", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }
      const mismatch = commercialNotificationMismatch({
        expectedProvider: current.provider,
        expectedMerchantReference: current.merchantReference,
        expectedAmountMinor: current.amountMinor,
        expectedCurrency: current.currency,
        provider: input.provider,
        notification: input.notification
      });
      if (mismatch) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: mismatch, processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }

      const now = new Date();
      const nextAttemptStatus = paymentAttemptStatus(input.notification.status);
      const nextOrderStatus = orderStatus(input.notification.status);
      const processedEventKey = input.notification.providerEventKey;
      if (hasProviderPaymentIdConflict({ currentStatus: current.status, currentProviderPaymentId: current.providerPaymentId, nextStatus: nextAttemptStatus, nextProviderPaymentId: input.notification.providerPaymentId })) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "PROVIDER_PAYMENT_ID_CONFLICT", processedAt: now } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }
      if (current.status === nextAttemptStatus && current.order.status === nextOrderStatus) {
        await tx.commercialPaymentEvent.update({
          where: { id: event.id },
          data: { providerEventKey: processedEventKey, processingStatus: "PROCESSED", processedAt: now }
        });
        return { duplicate: false, grantedAccess: Boolean(current.order.access), rejected: false };
      }
      if (!canTransitionPaymentAttempt(current.status, nextAttemptStatus) || !canTransitionOrder(current.order.status, nextOrderStatus)) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "ILLEGAL_STATUS_TRANSITION", processedAt: now } });
        return { duplicate: false, grantedAccess: false, rejected: true };
      }
      const attemptUpdate = await tx.commercialPaymentAttempt.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          status: nextAttemptStatus,
          providerPaymentId: input.notification.providerPaymentId,
          verifiedAt: now,
          ...(nextAttemptStatus === "PAID" ? { paidAt: now } : { failureCode: nextAttemptStatus === "FAILED" ? "PAYMENT_FAILED" : null })
        }
      });
      if (attemptUpdate.count !== 1) throw new CommercialError("PAYMENT_STATE_CHANGED");
      const orderUpdate = await tx.commercialOrder.updateMany({
        where: { id: current.order.id, status: current.order.status },
        data: { status: nextOrderStatus, ...(nextOrderStatus === "PAID" ? { paidAt: now } : {}) }
      });
      if (orderUpdate.count !== 1) throw new CommercialError("PAYMENT_STATE_CHANGED");

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
      await tx.commercialPaymentEvent.update({
        where: { id: event.id },
        data: { providerEventKey: processedEventKey, processingStatus: "PROCESSED", processedAt: now }
      });
      await tx.eventLog.create({ data: { eventType: "payment_status_changed", entityType: "commercial_payment_attempt", entityId: current.id, payload: { provider: input.provider, status: nextAttemptStatus } } });
      return { duplicate: false, grantedAccess, rejected: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && isCommercialPaymentEventUniqueConflict(error)) {
      const duplicate = await prisma.commercialPaymentEvent.findFirst({
        where: {
          provider: input.provider,
          OR: [
            ...(input.notification.signatureValid && input.notification.providerEventKey
              ? [{ providerEventKey: input.notification.providerEventKey, signatureValid: true }]
              : []),
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
