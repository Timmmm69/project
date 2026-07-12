import { randomUUID } from "node:crypto";
import { Prisma, type CommercialPaymentAttemptStatus, type CommercialPaymentProvider, type CommercialOrderStatus } from "@prisma/client";
import { analyticsConfig, hashAnalyticsId } from "@/lib/analytics/analytics-id";
import { safelyWriteAnalyticsEvent, type AnalyticsWriteInput, type AnalyticsWriter } from "@/lib/analytics/analytics-service";
import { COMMERCIAL_CURRENCY, COMMERCIAL_PRICE_MINOR, commercialLegalConfig } from "@/lib/commercial/config";
import { checkoutStartedProperties, createCheckoutFlowId, orderCreatedProperties } from "@/lib/commercial/checkout-flow";
import type { CommercialPaymentProviderAdapter, ProviderNotification } from "@/lib/commercial/providers";
import { commercialCheckoutFlowIdSchema } from "@/lib/commercial/schemas";
import {
  commercialOrderTokenSecret,
  createLookupToken,
  deriveCommercialOrderLookupToken,
  hashLookupToken,
  lookupTokenMatches,
  payloadHash
} from "@/lib/commercial/security";
import { canOpenNewPaymentAttempt, canTransitionOrder, canTransitionPaymentAttempt } from "@/lib/commercial/state-machine";
import { normalizeEmail } from "@/lib/validation/email";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

type Tx = Prisma.TransactionClient;

function analyticsPaymentProvider(provider: CommercialPaymentProvider) {
  return provider === "LOCAL_FAKE" ? "fake" as const : "webpay" as const;
}

function analyticsPaymentEnvironment(provider: CommercialPaymentProvider) {
  return provider === "LOCAL_FAKE" ? "test" as const : "sandbox" as const;
}

function analyticsHashes(input: { orderPublicId?: string; paymentAttemptPublicId?: string; accessPublicId?: string }) {
  const config = analyticsConfig();
  if (!config.enabled || (!input.orderPublicId && !input.paymentAttemptPublicId && !input.accessPublicId)) {
    return { properties: {}, analyticsIdKeyVersion: undefined };
  }
  return {
    properties: {
      ...(input.orderPublicId ? { order_public_id_hash: hashAnalyticsId("order", input.orderPublicId, config) } : {}),
      ...(input.paymentAttemptPublicId ? { payment_attempt_public_id_hash: hashAnalyticsId("payment_attempt", input.paymentAttemptPublicId, config) } : {}),
      ...(input.accessPublicId ? { access_public_id_hash: hashAnalyticsId("access", input.accessPublicId, config) } : {})
    },
    analyticsIdKeyVersion: config.keyVersion
  };
}

async function ensureAnalytics(build: () => AnalyticsWriteInput, writer?: AnalyticsWriter) {
  try {
    return await safelyWriteAnalyticsEvent(build(), writer);
  } catch {
    return { enabled: false, inserted: false } as const;
  }
}

async function writePaymentValidationFailed(input: {
  transitionKey: string;
  provider: CommercialPaymentProvider;
  reason: "invalid_callback_signal" | "invalid_signature" | "merchant_reference_mismatch" | "provider_mismatch" |
    "amount_mismatch" | "currency_mismatch" | "provider_payment_id_conflict" | "illegal_status_transition" |
    "status_verification_unavailable";
  orderPublicId?: string;
  paymentAttemptPublicId?: string;
}, writer?: AnalyticsWriter) {
  return ensureAnalytics(() => {
    const hashes = analyticsHashes(input);
    return {
      eventName: "payment_validation_failed",
      transitionKey: input.transitionKey,
      occurredAt: new Date(),
      analyticsIdKeyVersion: hashes.analyticsIdKeyVersion,
      properties: {
        ...hashes.properties,
        payment_provider: analyticsPaymentProvider(input.provider),
        payment_environment: analyticsPaymentEnvironment(input.provider),
        error_category: "payment_verification_error",
        validation_reason: input.reason
      }
    };
  }, writer);
}

type PaidAnalyticsFacts = {
  occurredAt: Date;
  provider: CommercialPaymentProvider;
  orderId: string;
  orderPublicId: string;
  paymentAttemptId: string;
  paymentAttemptPublicId: string;
  access?: { publicId: string; occurredAt: Date; productCode: string; testSlug: string; examMode: string };
};

async function ensurePaidAnalytics(facts: PaidAnalyticsFacts, writer?: AnalyticsWriter) {
  await ensureAnalytics(() => {
    const hashes = analyticsHashes({ orderPublicId: facts.orderPublicId, paymentAttemptPublicId: facts.paymentAttemptPublicId });
    return {
      eventName: "payment_confirmed",
      transitionKey: `commercial-payment-paid:${facts.paymentAttemptId}`,
      occurredAt: facts.occurredAt,
      analyticsIdKeyVersion: hashes.analyticsIdKeyVersion,
      properties: {
        ...hashes.properties,
        payment_provider: analyticsPaymentProvider(facts.provider),
        payment_environment: analyticsPaymentEnvironment(facts.provider),
        payment_status: "paid",
        verification_method: facts.provider === "LOCAL_FAKE" ? "fake_provider" : "status_api"
      }
    };
  }, writer);
  if (!facts.access) return;
  await ensureAnalytics(() => {
    const hashes = analyticsHashes({ orderPublicId: facts.orderPublicId, paymentAttemptPublicId: facts.paymentAttemptPublicId, accessPublicId: facts.access!.publicId });
    return {
      eventName: "access_granted",
      transitionKey: `commercial-access-granted:${facts.orderId}`,
      occurredAt: facts.access!.occurredAt,
      analyticsIdKeyVersion: hashes.analyticsIdKeyVersion,
      properties: {
        ...hashes.properties,
        product_id: facts.access!.productCode,
        test_id: facts.access!.testSlug,
        exam_mode: facts.access!.examMode.toLowerCase(),
        access_source: "paid",
        grant_reason: "confirmed_payment"
      }
    };
  }, writer);
}

async function ensureCheckoutStartedAnalytics(input: {
  checkoutFlowId: string;
  occurredAt: Date;
  productCode: string;
  testSlug: string;
  examMode: string;
}, writer?: AnalyticsWriter) {
  return ensureAnalytics(() => ({
    eventName: "checkout_started",
    transitionKey: `commercial-checkout-started:${input.checkoutFlowId}`,
    occurredAt: input.occurredAt,
    properties: checkoutStartedProperties({
      checkoutFlowId: input.checkoutFlowId,
      productId: input.productCode,
      testId: input.testSlug,
      examMode: input.examMode
    })
  }), writer);
}

async function ensureOrderCreatedAnalytics(input: {
  checkoutFlowId: string;
  occurredAt: Date;
  orderId: string;
  orderPublicId: string;
  productCode: string;
  testSlug: string;
  amount: number;
  currency: string;
}, writer?: AnalyticsWriter) {
  return ensureAnalytics(() => {
    const hashes = analyticsHashes({ orderPublicId: input.orderPublicId });
    return {
      eventName: "order_created",
      transitionKey: `commercial-order-created:${input.orderId}`,
      occurredAt: input.occurredAt,
      analyticsIdKeyVersion: hashes.analyticsIdKeyVersion,
      properties: orderCreatedProperties({
        checkoutFlowId: input.checkoutFlowId,
        orderPublicIdHash: hashes.properties.order_public_id_hash ?? "",
        productId: input.productCode,
        testId: input.testSlug,
        amount: input.amount,
        currency: input.currency
      })
    };
  }, writer);
}

async function ensureCheckoutFailureAnalytics(input: { occurredAt: Date; orderPublicId: string; paymentAttemptId: string; paymentAttemptPublicId: string }, writer?: AnalyticsWriter) {
  return ensureAnalytics(() => {
    const hashes = analyticsHashes({ orderPublicId: input.orderPublicId, paymentAttemptPublicId: input.paymentAttemptPublicId });
    return {
      eventName: "backend_operation_failed",
      transitionKey: `backend-operation-failed:checkout:${input.paymentAttemptId}`,
      occurredAt: input.occurredAt,
      analyticsIdKeyVersion: hashes.analyticsIdKeyVersion,
      properties: {
        ...hashes.properties,
        error_event_id: randomUUID(),
        error_category: "payment_provider_error",
        failure_stage: "checkout",
        error_code: "provider_unavailable",
        retryable: true,
        severity: "sev1"
      }
    };
  }, writer);
}

async function recoverPaidAnalyticsFromExactDuplicate(input: {
  notification: ProviderNotification;
  provider: CommercialPaymentProvider;
  analyticsWriter?: AnalyticsWriter;
}) {
  try {
    if (!input.notification.signatureValid || input.notification.status !== "paid") return false;
    const attempt = await prisma.commercialPaymentAttempt.findUnique({
      where: { merchantReference: input.notification.merchantReference },
      include: {
        order: { include: { product: { include: { test: { select: { slug: true, examMode: true } } } }, access: true } }
      }
    });
    if (!attempt ||
      attempt.provider !== input.provider ||
      attempt.merchantReference !== input.notification.merchantReference ||
      attempt.amountMinor !== input.notification.amountMinor ||
      attempt.currency !== input.notification.currency ||
      hasProviderPaymentIdConflict({ currentStatus: attempt.status, currentProviderPaymentId: attempt.providerPaymentId, nextStatus: "PAID", nextProviderPaymentId: input.notification.providerPaymentId }) ||
      attempt.status !== "PAID" ||
      attempt.order.status !== "PAID" ||
      !attempt.order.access ||
      attempt.order.access.commercialOrderId !== attempt.order.id ||
      attempt.order.access.commercialPaymentAttemptId !== attempt.id) return false;

    await ensurePaidAnalytics({
      occurredAt: attempt.paidAt ?? attempt.verifiedAt ?? new Date(),
      provider: input.provider,
      orderId: attempt.order.id,
      orderPublicId: attempt.order.publicId,
      paymentAttemptId: attempt.id,
      paymentAttemptPublicId: attempt.publicId,
      access: {
        publicId: attempt.order.access.publicId,
        occurredAt: attempt.order.access.grantedAt ?? attempt.order.access.createdAt,
        productCode: attempt.order.product.code,
        testSlug: attempt.order.product.test.slug,
        examMode: attempt.order.product.test.examMode
      }
    }, input.analyticsWriter);
    return true;
  } catch {
    return false;
  }
}

function validationReason(code: string) {
  const values = {
    INVALID_SIGNATURE: "invalid_signature",
    MERCHANT_REFERENCE_MISMATCH: "merchant_reference_mismatch",
    PROVIDER_MISMATCH: "provider_mismatch",
    AMOUNT_MISMATCH: "amount_mismatch",
    CURRENCY_MISMATCH: "currency_mismatch",
    PROVIDER_PAYMENT_ID_CONFLICT: "provider_payment_id_conflict",
    ILLEGAL_STATUS_TRANSITION: "illegal_status_transition"
  } as const;
  return values[code as keyof typeof values];
}

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

export async function createCommercialCheckoutFlow(input: {
  productCode: string;
  analyticsWriter?: AnalyticsWriter;
}) {
  const product = await prisma.commercialProduct.findFirst({
    where: { code: input.productCode, isActive: true },
    include: {
      test: {
        select: { id: true, slug: true, examMode: true, status: true, deletedAt: true }
      }
    }
  });
  if (!product || product.test.deletedAt || product.test.status !== "PUBLISHED" ||
      product.test.examMode !== "RIKZ_RUSSIAN_2026") {
    throw new CommercialError("COMMERCIAL_PRODUCT_UNAVAILABLE");
  }
  if (product.priceMinor !== COMMERCIAL_PRICE_MINOR || product.currency !== COMMERCIAL_CURRENCY) {
    throw new CommercialError("COMMERCIAL_PRODUCT_CONFIGURATION_INVALID");
  }

  const checkoutFlowId = createCheckoutFlowId();
  const flow = await prisma.commercialCheckoutFlow.create({
    data: {
      id: checkoutFlowId,
      commercialProductId: product.id,
      testIdSnapshot: product.test.id,
      examModeSnapshot: product.test.examMode
    }
  });

  await ensureCheckoutStartedAnalytics({
    checkoutFlowId: flow.id,
    occurredAt: flow.createdAt,
    productCode: product.code,
    testSlug: product.test.slug,
    examMode: product.test.examMode
  }, input.analyticsWriter);
  return flow;
}

async function recoverConcurrentOrderCreation(input: {
  productCode: string;
  emailNormalized: string;
  idempotencyKey: string;
  checkoutFlowId: string;
  orderTokenSecret: string;
}, integrityError: Prisma.PrismaClientKnownRequestError) {
  const product = await prisma.commercialProduct.findUnique({
    where: { code: input.productCode },
    select: { id: true }
  });
  if (!product) throw integrityError;

  const sameRequest = await prisma.commercialOrder.findUnique({ where: { checkoutFlowId: input.checkoutFlowId } });
  if (sameRequest) {
    if (sameRequest.commercialProductId !== product.id || sameRequest.emailNormalized !== input.emailNormalized ||
        sameRequest.idempotencyKey !== input.idempotencyKey) {
      throw new CommercialError("CHECKOUT_FLOW_CONFLICT");
    }
    const lookupToken = stableOrderLookupToken(sameRequest, input.orderTokenSecret);
    return { order: sameRequest, lookupToken, idempotent: true };
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

function stableOrderLookupToken(order: {
  id: string;
  checkoutFlowId: string | null;
  idempotencyKey: string;
  lookupTokenHash: string;
}, secret: string) {
  if (!order.checkoutFlowId) throw new CommercialError("ORDER_TOKEN_INTEGRITY_ERROR");
  const token = deriveCommercialOrderLookupToken({
    orderId: order.id,
    checkoutFlowId: order.checkoutFlowId,
    idempotencyKey: order.idempotencyKey
  }, secret);
  if (!lookupTokenMatches(token, order.lookupTokenHash)) {
    throw new CommercialError("ORDER_TOKEN_INTEGRITY_ERROR");
  }
  return token;
}

export async function createCommercialOrder(input: {
  productCode: string;
  checkoutFlowId: string;
  email: string;
  adultBuyerConfirmed: boolean;
  legalBundleVersion: string;
  idempotencyKey: string;
  analyticsWriter?: AnalyticsWriter;
}) {
  if (!commercialCheckoutFlowIdSchema.safeParse(input.checkoutFlowId).success) {
    throw new CommercialError("INVALID_CHECKOUT_FLOW");
  }
  if (!input.adultBuyerConfirmed) {
    throw new CommercialError("ADULT_CONFIRMATION_REQUIRED");
  }
  if (!legalVersionMatches(input.legalBundleVersion)) {
    throw new CommercialError("STALE_LEGAL_BUNDLE");
  }

  const now = new Date();
  const emailNormalized = normalizeEmail(input.email);
  const legal = commercialLegalConfig();
  const orderTokenSecret = commercialOrderTokenSecret();
  const orderId = randomUUID();
  const token = deriveCommercialOrderLookupToken({
    orderId,
    checkoutFlowId: input.checkoutFlowId,
    idempotencyKey: input.idempotencyKey
  }, orderTokenSecret);

  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
    const product = await tx.commercialProduct.findFirst({
      where: { code: input.productCode, isActive: true },
      include: { test: { select: { id: true, slug: true, examMode: true, status: true, deletedAt: true } } }
    });
    if (!product || product.test.deletedAt || product.test.status !== "PUBLISHED" || product.test.examMode !== "RIKZ_RUSSIAN_2026") {
      throw new CommercialError("COMMERCIAL_PRODUCT_UNAVAILABLE");
    }
    if (product.priceMinor !== COMMERCIAL_PRICE_MINOR || product.currency !== COMMERCIAL_CURRENCY) {
      throw new CommercialError("COMMERCIAL_PRODUCT_CONFIGURATION_INVALID");
    }

    const checkoutFlow = await tx.commercialCheckoutFlow.findUnique({
      where: { id: input.checkoutFlowId },
      include: { order: true }
    });
    if (!checkoutFlow) throw new CommercialError("CHECKOUT_FLOW_NOT_FOUND");
    if (checkoutFlow.commercialProductId !== product.id || checkoutFlow.testIdSnapshot !== product.testId ||
        checkoutFlow.examModeSnapshot !== product.test.examMode) {
      throw new CommercialError("CHECKOUT_FLOW_CONTEXT_MISMATCH");
    }
    if (checkoutFlow.order) {
      if (checkoutFlow.order.emailNormalized !== emailNormalized || checkoutFlow.order.idempotencyKey !== input.idempotencyKey) {
        throw new CommercialError("CHECKOUT_FLOW_CONFLICT");
      }
      const lookupToken = stableOrderLookupToken(checkoutFlow.order, orderTokenSecret);
      return { kind: "created" as const, order: checkoutFlow.order, lookupToken, idempotent: true, product, newOrder: false };
    }

    const nextAction = await existingAccessAction(tx, emailNormalized, product.testId, now);
    if (nextAction) {
      return { kind: "existing" as const, productId: product.id, productCode: product.code, nextAction };
    }

    const existingByKey = await tx.commercialOrder.findUnique({
      where: { commercialProductId_idempotencyKey: { commercialProductId: product.id, idempotencyKey: input.idempotencyKey } }
    });
    if (existingByKey) {
      if (existingByKey.emailNormalized !== emailNormalized || existingByKey.checkoutFlowId !== input.checkoutFlowId) {
        throw new CommercialError("IDEMPOTENCY_KEY_CONFLICT");
      }
      const lookupToken = stableOrderLookupToken(existingByKey, orderTokenSecret);
      return { kind: "created" as const, order: existingByKey, lookupToken, idempotent: true, product, newOrder: false };
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
        id: orderId,
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
        checkoutFlowId: input.checkoutFlowId,
        lookupTokenHash: hashLookupToken(token)
      }
    });
    await tx.eventLog.create({
      data: { eventType: "order_created", entityType: "commercial_order", entityId: order.id, payload: { productCode: product.code, priceMinor: product.priceMinor, currency: product.currency } }
    });
    return { kind: "created" as const, order, lookupToken: token, idempotent: false, product, newOrder: true };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return recoverConcurrentOrderCreation({
        productCode: input.productCode,
        emailNormalized,
        idempotencyKey: input.idempotencyKey,
        checkoutFlowId: input.checkoutFlowId,
        orderTokenSecret
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
  if (outcome.newOrder) {
    await ensureOrderCreatedAnalytics({
      checkoutFlowId: input.checkoutFlowId,
      occurredAt: outcome.order.createdAt,
      orderId: outcome.order.id,
      orderPublicId: outcome.order.publicId,
      productCode: outcome.product.code,
      testSlug: outcome.product.test.slug,
      amount: outcome.order.priceMinor,
      currency: outcome.order.currency
    }, input.analyticsWriter);
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
  analyticsWriter?: AnalyticsWriter;
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
    const failureFacts = await prisma.$transaction(async (tx) => {
      await lockCommercialOrder(tx, decision.order.id);
      await lockCommercialPaymentAttempt(tx, decision.attempt.id);
      const order = await tx.commercialOrder.findUniqueOrThrow({ where: { id: decision.order.id }, select: { status: true, publicId: true } });
      const attempt = await tx.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: decision.attempt.id }, select: { status: true, publicId: true } });
      if (attempt.status === "PENDING" && canTransitionPaymentAttempt(attempt.status, "FAILED")) {
        await tx.commercialPaymentAttempt.updateMany({
          where: { id: decision.attempt.id, status: attempt.status },
          data: { status: "FAILED", failureCode: error instanceof Error ? error.message : "CHECKOUT_CREATE_FAILED", failureMessageSafe: "Не удалось создать платёжную сессию." }
        });
      }
      if (order.status === "PENDING" && canTransitionOrder(order.status, "FAILED")) {
        await tx.commercialOrder.updateMany({ where: { id: decision.order.id, status: order.status }, data: { status: "FAILED" } });
      }
      return { occurredAt: new Date(), orderPublicId: order.publicId, paymentAttemptId: decision.attempt.id, paymentAttemptPublicId: attempt.publicId };
    });
    await ensureCheckoutFailureAnalytics(failureFacts, input.analyticsWriter);
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
  analyticsWriter?: AnalyticsWriter;
}) {
  const hash = payloadHash(input.rawBody);
  const attempt = await prisma.commercialPaymentAttempt.findUnique({
    where: { merchantReference: input.notification.merchantReference },
    select: { id: true, publicId: true, commercialOrderId: true, order: { select: { publicId: true } } }
  });

  try {
    const outcome = await prisma.$transaction(async (tx) => {
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
        return { duplicate: false, grantedAccess: false, rejected: true, validation: { transitionKey: `payment-validation:${event.id}`, provider: input.provider, reason: "merchant_reference_mismatch" as const } };
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
        return { duplicate: false, grantedAccess: false, rejected: true, validation: { transitionKey: `payment-validation:${event.id}`, provider: input.provider, reason: "invalid_signature" as const, orderPublicId: attempt.order.publicId, paymentAttemptPublicId: attempt.publicId } };
      }

      const current = await tx.commercialPaymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        include: { order: { include: { product: { include: { test: { select: { slug: true, examMode: true } } } }, access: true } } }
      });
      if (current.commercialOrderId !== attempt.commercialOrderId) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "MERCHANT_REFERENCE_MISMATCH", processedAt: new Date() } });
        return { duplicate: false, grantedAccess: false, rejected: true, validation: { transitionKey: `payment-validation:${event.id}`, provider: input.provider, reason: "merchant_reference_mismatch" as const, orderPublicId: current.order.publicId, paymentAttemptPublicId: current.publicId } };
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
        return { duplicate: false, grantedAccess: false, rejected: true, validation: { transitionKey: `payment-validation:${event.id}`, provider: input.provider, reason: validationReason(mismatch)!, orderPublicId: current.order.publicId, paymentAttemptPublicId: current.publicId } };
      }

      const now = new Date();
      const nextAttemptStatus = paymentAttemptStatus(input.notification.status);
      const nextOrderStatus = orderStatus(input.notification.status);
      const processedEventKey = input.notification.providerEventKey;
      if (hasProviderPaymentIdConflict({ currentStatus: current.status, currentProviderPaymentId: current.providerPaymentId, nextStatus: nextAttemptStatus, nextProviderPaymentId: input.notification.providerPaymentId })) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "PROVIDER_PAYMENT_ID_CONFLICT", processedAt: now } });
        return { duplicate: false, grantedAccess: false, rejected: true, validation: { transitionKey: `payment-validation:${event.id}`, provider: input.provider, reason: "provider_payment_id_conflict" as const, orderPublicId: current.order.publicId, paymentAttemptPublicId: current.publicId } };
      }
      if (current.status === nextAttemptStatus && current.order.status === nextOrderStatus) {
        await tx.commercialPaymentEvent.update({
          where: { id: event.id },
          data: { providerEventKey: processedEventKey, processingStatus: "PROCESSED", processedAt: now }
        });
        const paid = nextAttemptStatus === "PAID" && current.order.access
          ? {
              occurredAt: current.paidAt ?? current.verifiedAt ?? now,
              provider: input.provider,
              orderId: current.order.id,
              orderPublicId: current.order.publicId,
              paymentAttemptId: current.id,
              paymentAttemptPublicId: current.publicId,
              access: {
                publicId: current.order.access.publicId,
                occurredAt: current.order.access.grantedAt ?? current.order.access.createdAt,
                productCode: current.order.product.code,
                testSlug: current.order.product.test.slug,
                examMode: current.order.product.test.examMode
              }
            } satisfies PaidAnalyticsFacts
          : undefined;
        return { duplicate: false, grantedAccess: Boolean(current.order.access), rejected: false, paid };
      }
      if (!canTransitionPaymentAttempt(current.status, nextAttemptStatus) || !canTransitionOrder(current.order.status, nextOrderStatus)) {
        await tx.commercialPaymentEvent.update({ where: { id: event.id }, data: { processingStatus: "REJECTED", processingErrorCode: "ILLEGAL_STATUS_TRANSITION", processedAt: now } });
        return { duplicate: false, grantedAccess: false, rejected: true, validation: { transitionKey: `payment-validation:${event.id}`, provider: input.provider, reason: "illegal_status_transition" as const, orderPublicId: current.order.publicId, paymentAttemptPublicId: current.publicId } };
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
      let grantedAccessRecord = current.order.access;
      if (nextAttemptStatus === "PAID") {
        const student = await tx.user.findUnique({ where: { email: current.order.emailNormalized } });
        const user = student ?? await tx.user.create({ data: { email: current.order.emailNormalized, role: "STUDENT" } });
        if (user.role !== "STUDENT" || user.deletedAt) throw new CommercialError("EMAIL_NOT_AVAILABLE");
        const existing = await tx.access.findUnique({ where: { commercialOrderId: current.order.id } });
        if (!existing) {
          const deadline = addDays(now, current.order.product.startWindowDays);
          grantedAccessRecord = await tx.access.create({
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
      const paid = nextAttemptStatus === "PAID" && grantedAccessRecord
        ? {
            occurredAt: now,
            provider: input.provider,
            orderId: current.order.id,
            orderPublicId: current.order.publicId,
            paymentAttemptId: current.id,
            paymentAttemptPublicId: current.publicId,
            access: {
              publicId: grantedAccessRecord.publicId,
              occurredAt: grantedAccessRecord.grantedAt ?? grantedAccessRecord.createdAt,
              productCode: current.order.product.code,
              testSlug: current.order.product.test.slug,
              examMode: current.order.product.test.examMode
            }
          } satisfies PaidAnalyticsFacts
        : undefined;
      return { duplicate: false, grantedAccess, rejected: false, paid };
    });
    if (outcome.validation) await writePaymentValidationFailed(outcome.validation, input.analyticsWriter);
    if (outcome.paid) await ensurePaidAnalytics(outcome.paid, input.analyticsWriter);
    return { duplicate: outcome.duplicate, grantedAccess: outcome.grantedAccess, rejected: outcome.rejected };
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
      if (duplicate) {
        await recoverPaidAnalyticsFromExactDuplicate({
          notification: input.notification,
          provider: input.provider,
          analyticsWriter: input.analyticsWriter
        });
        return { duplicate: true, grantedAccess: false, rejected: false };
      }
    }
    throw error;
  }
}

export async function recordCommercialPaymentValidationFailure(input: {
  provider: CommercialPaymentProvider;
  reason: "invalid_callback_signal" | "status_verification_unavailable" | "merchant_reference_mismatch";
  merchantReference?: string;
}) {
  try {
    const attempt = input.merchantReference
      ? await prisma.commercialPaymentAttempt.findUnique({ where: { merchantReference: input.merchantReference }, include: { order: { select: { publicId: true } } } })
      : null;
    return writePaymentValidationFailed({
      transitionKey: `payment-validation-route:${randomUUID()}`,
      provider: input.provider,
      reason: input.reason,
      orderPublicId: attempt?.order.publicId,
      paymentAttemptPublicId: attempt?.publicId
    });
  } catch {
    return { enabled: false, inserted: false } as const;
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
