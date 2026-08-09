import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import type { AnalyticsWriteInput } from "@/lib/analytics/analytics-service";
import { assertNoForbiddenAnalyticsPayload } from "@/lib/analytics/forbidden-payload";
import {
  createCommercialCheckoutFlow,
  createCommercialOrder,
  createCommercialPaymentSession,
  commercialOrderStatus,
  processCommercialProviderNotification,
  reconcilePaidCommercialOrderAccess
} from "@/lib/commercial/commercial-service";
import { LocalFakeCommercialProvider } from "@/lib/commercial/providers";
import { hashLookupToken } from "@/lib/commercial/security";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide local PostgreSQL.");
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const prisma = new PrismaClient();
const provider = new LocalFakeCommercialProvider();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const productCode = `commercial-concurrency-${suffix}`;
let productId = "";

function email(label: string) {
  return `${label}-${suffix}@example.test`;
}

async function notification(input: {
  merchantReference: string;
  eventKey: string;
  status: "paid" | "failed" | "cancelled" | "expired";
  paymentId: string;
}) {
  const rawBody = JSON.stringify({
    merchant_reference: input.merchantReference,
    payment_id: input.paymentId,
    event_key: input.eventKey,
    status: input.status,
    amount_minor: "1000",
    currency: "BYN",
    signature: "local-fake-valid"
  });
  return { rawBody, value: await provider.verifyNotification(rawBody) };
}

async function createOrder(label: string, idempotencyKey = `order-${label}-${suffix}`) {
  const flow = await createCommercialCheckoutFlow({ productCode });
  return createCommercialOrder({
    productCode,
    checkoutFlowId: flow.id,
    email: email(label),
    adultBuyerConfirmed: true,
    legalBundleVersion: "concurrency-v1",
    idempotencyKey
  });
}

async function createSession(publicId: string, key: string) {
  return createCommercialPaymentSession({ publicId, idempotencyKey: key, provider, appUrl: "http://localhost:3000" });
}

test.beforeAll(async () => {
  process.env.LEGAL_BUNDLE_VERSION = "concurrency-v1";
  process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY = "synthetic-e2e-commercial-order-token-key-32-bytes";
  const testRecord = await prisma.test.findFirst({
    where: { examMode: "RIKZ_RUSSIAN_2026", status: "PUBLISHED", deletedAt: null },
    select: { id: true }
  });
  if (!testRecord) throw new Error("A published authentic test is required for commercial concurrency tests.");
  const product = await prisma.commercialProduct.create({
    data: {
      code: productCode,
      testId: testRecord.id,
      name: "Commercial concurrency fixture",
      priceMinor: 1000,
      currency: "BYN",
      attemptLimit: 1,
      startWindowDays: 90,
      resultRetentionDays: 365,
      isActive: true
    }
  });
  productId = product.id;
});

test.afterAll(async () => {
  const orders = await prisma.commercialOrder.findMany({ where: { commercialProductId: productId }, select: { id: true } });
  const orderIds = orders.map((order) => order.id);
  const paymentAttempts = await prisma.commercialPaymentAttempt.findMany({ where: { commercialOrderId: { in: orderIds } }, select: { id: true } });
  const paymentAttemptIds = paymentAttempts.map((attempt) => attempt.id);
  const accesses = await prisma.access.findMany({ where: { commercialOrderId: { in: orderIds } }, select: { id: true, userId: true } });
  const accessIds = accesses.map((access) => access.id);
  const attempts = await prisma.attempt.findMany({ where: { accessId: { in: accessIds } }, select: { id: true } });
  await prisma.answer.deleteMany({ where: { attemptId: { in: attempts.map((attempt) => attempt.id) } } });
  await prisma.attempt.deleteMany({ where: { id: { in: attempts.map((attempt) => attempt.id) } } });
  await prisma.commercialPaymentEvent.deleteMany({ where: { commercialPaymentAttemptId: { in: paymentAttemptIds } } });
  await prisma.access.deleteMany({ where: { id: { in: accessIds } } });
  await prisma.commercialPaymentAttempt.deleteMany({ where: { id: { in: paymentAttemptIds } } });
  await prisma.commercialOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.commercialCheckoutFlow.deleteMany({ where: { commercialProductId: productId } });
  const userIds = [...new Set(accesses.map((access) => access.userId))];
  await prisma.eventLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityType: "commercial_order", entityId: { in: orderIds } }
      ]
    }
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.commercialProduct.delete({ where: { id: productId } });
  await prisma.$disconnect();
});

test("parallel normalized-email orders create one open order without token rotation", async () => {
  const mixedCase = `Order-Race-${suffix}@Example.Test`;
  const normalized = mixedCase.toLowerCase();
  const [firstFlow, secondFlow] = await Promise.all([
    createCommercialCheckoutFlow({ productCode }),
    createCommercialCheckoutFlow({ productCode })
  ]);
  const results = await Promise.allSettled([
    createCommercialOrder({ productCode, checkoutFlowId: firstFlow.id, email: mixedCase, adultBuyerConfirmed: true, legalBundleVersion: "concurrency-v1", idempotencyKey: `race-a-${suffix}` }),
    createCommercialOrder({ productCode, checkoutFlowId: secondFlow.id, email: normalized, adultBuyerConfirmed: true, legalBundleVersion: "concurrency-v1", idempotencyKey: `race-b-${suffix}` })
  ]);
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createCommercialOrder>>> => result.status === "fulfilled");
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toMatchObject({ code: "ORDER_ALREADY_PENDING" });
  const openOrders = await prisma.commercialOrder.findMany({
    where: { commercialProductId: productId, emailNormalized: normalized, status: { in: ["CREATED", "PENDING"] } }
  });
  expect(openOrders).toHaveLength(1);
  expect(openOrders[0].lookupTokenHash).toBe(hashLookupToken(fulfilled[0].value.lookupToken));
});

test("parallel payment sessions leave one active payable attempt", async () => {
  const order = await createOrder("parallel-session");
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) => createSession(order.order.publicId, `session-${index}-${suffix}`))
  );
  const active = await prisma.commercialPaymentAttempt.findMany({
    where: { commercialOrderId: order.order.id, status: { in: ["CREATED", "PENDING"] } }
  });
  expect(active).toHaveLength(1);
  const fulfilledIds = results.flatMap((result) => result.status === "fulfilled" ? [result.value.id] : []);
  expect(new Set(fulfilledIds).size).toBeLessThanOrEqual(1);
  for (const result of results.filter((item): item is PromiseRejectedResult => item.status === "rejected")) {
    expect(result.reason).toMatchObject({ code: "PAYMENT_SESSION_ALREADY_ACTIVE" });
  }
});

test("payment-session race with paid notification cannot downgrade the order", async () => {
  for (let index = 0; index < 10; index += 1) {
    const order = await createOrder(`session-webhook-${index}`);
    const payment = await createSession(order.order.publicId, `initial-${index}-${suffix}`);
    const paid = await notification({ merchantReference: payment.merchantReference, eventKey: `race-paid-${index}-${suffix}`, status: "paid", paymentId: `race-payment-${index}-${suffix}` });
    await Promise.allSettled([
      createSession(order.order.publicId, `concurrent-${index}-${suffix}`),
      processCommercialProviderNotification({ notification: paid.value, rawBody: paid.rawBody, provider: provider.provider })
    ]);
    const storedOrder = await prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.order.id } });
    expect(storedOrder.status).toBe("PAID");
    expect(await prisma.access.count({ where: { commercialOrderId: order.order.id } })).toBe(1);
    expect(await prisma.commercialPaymentAttempt.count({ where: { commercialOrderId: order.order.id, status: { in: ["CREATED", "PENDING"] } } })).toBe(0);
  }
});

test("concurrent PAID and FAILED notifications keep a consistent terminal aggregate", async () => {
  for (let index = 0; index < 10; index += 1) {
    const order = await createOrder(`notify-paid-failed-${index}`);
    const payment = await createSession(order.order.publicId, `notify-paid-failed-session-${index}-${suffix}`);
    const providerPaymentId = `notify-paid-failed-id-${index}-${suffix}`;
    const paid = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-paid-${index}-${suffix}`, status: "paid", paymentId: providerPaymentId });
    const failed = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-failed-${index}-${suffix}`, status: "failed", paymentId: providerPaymentId });
    await Promise.all([
      processCommercialProviderNotification({ notification: paid.value, rawBody: paid.rawBody, provider: provider.provider }),
      processCommercialProviderNotification({ notification: failed.value, rawBody: failed.rawBody, provider: provider.provider })
    ]);
    const [storedOrder, storedAttempt, accessCount, events] = await Promise.all([
      prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.order.id } }),
      prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: payment.id } }),
      prisma.access.count({ where: { commercialOrderId: order.order.id } }),
      prisma.commercialPaymentEvent.findMany({ where: { commercialPaymentAttemptId: payment.id, providerEventKey: { in: [`notify-paid-${index}-${suffix}`, `notify-failed-${index}-${suffix}`] } } })
    ]);
    expect(storedOrder.status).toBe(storedAttempt.status);
    expect(["PAID", "FAILED"]).toContain(storedOrder.status);
    expect(accessCount).toBe(storedOrder.status === "PAID" ? 1 : 0);
    if (storedOrder.status === "PAID") {
      expect(storedOrder.paidAt).not.toBeNull();
      expect(storedAttempt.paidAt).not.toBeNull();
      expect(storedAttempt.verifiedAt).not.toBeNull();
    }
    expect(events.filter((event) => event.processingStatus === "PROCESSED")).toHaveLength(1);
    expect(events.filter((event) => event.processingStatus === "REJECTED" && event.processingErrorCode === "ILLEGAL_STATUS_TRANSITION")).toHaveLength(1);
  }
});

test("concurrent PAID and CANCELLED notifications keep a consistent terminal aggregate", async () => {
  for (let index = 0; index < 10; index += 1) {
    const order = await createOrder(`notify-paid-cancelled-${index}`);
    const payment = await createSession(order.order.publicId, `notify-paid-cancelled-session-${index}-${suffix}`);
    const providerPaymentId = `notify-paid-cancelled-id-${index}-${suffix}`;
    const paid = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-paid-c-${index}-${suffix}`, status: "paid", paymentId: providerPaymentId });
    const cancelled = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-cancelled-${index}-${suffix}`, status: "cancelled", paymentId: providerPaymentId });
    await Promise.all([
      processCommercialProviderNotification({ notification: paid.value, rawBody: paid.rawBody, provider: provider.provider }),
      processCommercialProviderNotification({ notification: cancelled.value, rawBody: cancelled.rawBody, provider: provider.provider })
    ]);
    const [storedOrder, storedAttempt, accessCount, events] = await Promise.all([
      prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.order.id } }),
      prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: payment.id } }),
      prisma.access.count({ where: { commercialOrderId: order.order.id } }),
      prisma.commercialPaymentEvent.findMany({ where: { commercialPaymentAttemptId: payment.id, providerEventKey: { in: [`notify-paid-c-${index}-${suffix}`, `notify-cancelled-${index}-${suffix}`] } } })
    ]);
    expect(storedOrder.status).toBe(storedAttempt.status);
    expect(["PAID", "CANCELLED"]).toContain(storedOrder.status);
    expect(accessCount).toBe(storedOrder.status === "PAID" ? 1 : 0);
    if (storedOrder.status === "PAID") {
      expect(storedOrder.paidAt).not.toBeNull();
      expect(storedAttempt.paidAt).not.toBeNull();
      expect(storedAttempt.verifiedAt).not.toBeNull();
    }
    expect(events.filter((event) => event.processingStatus === "PROCESSED")).toHaveLength(1);
    expect(events.filter((event) => event.processingStatus === "REJECTED" && event.processingErrorCode === "ILLEGAL_STATUS_TRANSITION")).toHaveLength(1);
  }
});

test("two concurrent PAID notifications with one provider payment ID are serialized no-ops", async () => {
  for (let index = 0; index < 10; index += 1) {
    const order = await createOrder(`notify-double-paid-${index}`);
    const payment = await createSession(order.order.publicId, `notify-double-paid-session-${index}-${suffix}`);
    const providerPaymentId = `notify-double-paid-id-${index}-${suffix}`;
    const first = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-double-paid-a-${index}-${suffix}`, status: "paid", paymentId: providerPaymentId });
    const second = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-double-paid-b-${index}-${suffix}`, status: "paid", paymentId: providerPaymentId });
    const results = await Promise.all([
      processCommercialProviderNotification({ notification: first.value, rawBody: first.rawBody, provider: provider.provider }),
      processCommercialProviderNotification({ notification: second.value, rawBody: second.rawBody, provider: provider.provider })
    ]);
    expect(results.every((result) => !result.rejected)).toBe(true);
    const [storedOrder, storedAttempt, accessCount, events] = await Promise.all([
      prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.order.id } }),
      prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: payment.id } }),
      prisma.access.count({ where: { commercialOrderId: order.order.id } }),
      prisma.commercialPaymentEvent.findMany({ where: { commercialPaymentAttemptId: payment.id, providerEventKey: { in: [`notify-double-paid-a-${index}-${suffix}`, `notify-double-paid-b-${index}-${suffix}`] } } })
    ]);
    expect(storedOrder.status).toBe("PAID");
    expect(storedAttempt.status).toBe("PAID");
    expect(storedAttempt.providerPaymentId).toBe(providerPaymentId);
    expect(storedOrder.paidAt).not.toBeNull();
    expect(storedAttempt.paidAt).not.toBeNull();
    expect(storedAttempt.verifiedAt).not.toBeNull();
    expect(accessCount).toBe(1);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.processingStatus === "PROCESSED")).toBe(true);
  }
});

test("same-state PAID rejects a conflicting provider payment ID", async () => {
  const order = await createOrder("notify-paid-id-conflict");
  const payment = await createSession(order.order.publicId, `notify-paid-id-conflict-session-${suffix}`);
  const first = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-paid-id-first-${suffix}`, status: "paid", paymentId: `notify-paid-id-a-${suffix}` });
  await processCommercialProviderNotification({ notification: first.value, rawBody: first.rawBody, provider: provider.provider });
  const conflict = await notification({ merchantReference: payment.merchantReference, eventKey: `notify-paid-id-conflict-${suffix}`, status: "paid", paymentId: `notify-paid-id-b-${suffix}` });
  const result = await processCommercialProviderNotification({ notification: conflict.value, rawBody: conflict.rawBody, provider: provider.provider });
  expect(result.rejected).toBe(true);
  const [storedOrder, storedAttempt, accessCount, event] = await Promise.all([
    prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.order.id } }),
    prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: payment.id } }),
    prisma.access.count({ where: { commercialOrderId: order.order.id } }),
    prisma.commercialPaymentEvent.findFirstOrThrow({ where: { providerEventKey: `notify-paid-id-conflict-${suffix}` } })
  ]);
  expect(storedOrder.status).toBe("PAID");
  expect(storedAttempt.status).toBe("PAID");
  expect(storedAttempt.providerPaymentId).toBe(`notify-paid-id-a-${suffix}`);
  expect(accessCount).toBe(1);
  expect(event.processingStatus).toBe("REJECTED");
  expect(event.processingErrorCode).toBe("PROVIDER_PAYMENT_ID_CONFLICT");
});

test("paid order rejects another payment session without changing access", async () => {
  const order = await createOrder("already-paid");
  const payment = await createSession(order.order.publicId, `paid-initial-${suffix}`);
  const paid = await notification({ merchantReference: payment.merchantReference, eventKey: `paid-event-${suffix}`, status: "paid", paymentId: `paid-id-${suffix}` });
  await processCommercialProviderNotification({ notification: paid.value, rawBody: paid.rawBody, provider: provider.provider });
  const attemptsBefore = await prisma.commercialPaymentAttempt.count({ where: { commercialOrderId: order.order.id } });
  const accessBefore = await prisma.access.findUniqueOrThrow({ where: { commercialOrderId: order.order.id } });
  await expect(createSession(order.order.publicId, `paid-retry-${suffix}`)).rejects.toMatchObject({ code: "ORDER_ALREADY_PAID" });
  expect(await prisma.commercialPaymentAttempt.count({ where: { commercialOrderId: order.order.id } })).toBe(attemptsBefore);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.order.id } })).status).toBe("PAID");
  expect((await prisma.access.findUniqueOrThrow({ where: { commercialOrderId: order.order.id } })).id).toBe(accessBefore.id);
});

test("manual authoritative status processing creates no Order, PaymentAttempt or Access", async () => {
  const order = await createOrder("manual-refresh-read-model");
  const payment = await createSession(order.order.publicId, `manual-refresh-session-${suffix}`);
  const paid = await notification({
    merchantReference: payment.merchantReference,
    eventKey: `manual-refresh-paid-${suffix}`,
    status: "paid",
    paymentId: `manual-refresh-payment-${suffix}`
  });
  const before = {
    orders: await prisma.commercialOrder.count({ where: { id: order.order.id } }),
    payments: await prisma.commercialPaymentAttempt.count({
      where: { commercialOrderId: order.order.id }
    }),
    accesses: await prisma.access.count({ where: { commercialOrderId: order.order.id } })
  };

  const outcome = await processCommercialProviderNotification({
    notification: paid.value,
    rawBody: paid.rawBody,
    provider: provider.provider,
    grantAccess: false
  });

  expect(outcome).toMatchObject({ rejected: false, grantedAccess: false });
  expect({
    orders: await prisma.commercialOrder.count({ where: { id: order.order.id } }),
    payments: await prisma.commercialPaymentAttempt.count({
      where: { commercialOrderId: order.order.id }
    }),
    accesses: await prisma.access.count({ where: { commercialOrderId: order.order.id } })
  }).toEqual(before);
  expect((await prisma.commercialOrder.findUniqueOrThrow({
    where: { id: order.order.id }
  })).status).toBe("PAID");
  expect((await commercialOrderStatus(order.order.publicId)).category).toBe("paid_without_access");
});

test("terminal failure allows one retry and stale notification cannot reopen it", async () => {
  const order = await createOrder("terminal-retry");
  const first = await createSession(order.order.publicId, `terminal-first-${suffix}`);
  const failed = await notification({ merchantReference: first.merchantReference, eventKey: `terminal-failed-${suffix}`, status: "failed", paymentId: `terminal-failed-id-${suffix}` });
  await processCommercialProviderNotification({ notification: failed.value, rawBody: failed.rawBody, provider: provider.provider });
  const second = await createSession(order.order.publicId, `terminal-second-${suffix}`);
  expect(second.id).not.toBe(first.id);
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("FAILED");
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING");
  const stalePaid = await notification({ merchantReference: first.merchantReference, eventKey: `terminal-stale-${suffix}`, status: "paid", paymentId: `terminal-stale-id-${suffix}` });
  const staleResult = await processCommercialProviderNotification({ notification: stalePaid.value, rawBody: stalePaid.rawBody, provider: provider.provider });
  expect(staleResult.rejected).toBe(true);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.order.id } })).status).toBe("PENDING");
  expect(await prisma.access.count({ where: { commercialOrderId: order.order.id } })).toBe(0);
});

test.describe("terminal retry contract", () => {
  for (const terminal of ["failed", "cancelled", "expired"] as const) {
    test(`${terminal} creates a new attempt inside the existing order`, async () => {
      const order = await createOrder(`terminal-${terminal}`);
      const first = await createSession(order.order.publicId, `terminal-${terminal}-first-${suffix}`);
      const terminalEvent = await notification({
        merchantReference: first.merchantReference,
        eventKey: `terminal-${terminal}-event-${suffix}`,
        status: terminal,
        paymentId: `terminal-${terminal}-payment-${suffix}`
      });
      await processCommercialProviderNotification({
        notification: terminalEvent.value,
        rawBody: terminalEvent.rawBody,
        provider: provider.provider
      });

      const retry = await createSession(order.order.publicId, `terminal-${terminal}-retry-${suffix}`);
      expect(retry.id).not.toBe(first.id);
      expect(retry.commercialOrderId).toBe(order.order.id);
      expect(retry.status).toBe("PENDING");
      expect(await prisma.commercialPaymentAttempt.count({
        where: { commercialOrderId: order.order.id }
      })).toBe(2);
      expect(await prisma.commercialPaymentAttempt.count({
        where: {
          commercialOrderId: order.order.id,
          status: { in: ["CREATED", "PENDING"] }
        }
      })).toBe(1);
      expect((await prisma.commercialOrder.findUniqueOrThrow({
        where: { id: order.order.id }
      })).status).toBe("PENDING");
    });
  }

  test("concurrent terminal retry creates at most one active attempt", async () => {
    const order = await createOrder("terminal-concurrent");
    const first = await createSession(order.order.publicId, `terminal-concurrent-first-${suffix}`);
    const failed = await notification({
      merchantReference: first.merchantReference,
      eventKey: `terminal-concurrent-failed-${suffix}`,
      status: "failed",
      paymentId: `terminal-concurrent-payment-${suffix}`
    });
    await processCommercialProviderNotification({
      notification: failed.value,
      rawBody: failed.rawBody,
      provider: provider.provider
    });

    const retries = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => createSession(
        order.order.publicId,
        `terminal-concurrent-retry-${index}-${suffix}`
      ))
    );
    const fulfilledIds = retries.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.id] : []
    );
    expect(new Set(fulfilledIds).size).toBeLessThanOrEqual(1);
    expect(await prisma.commercialPaymentAttempt.count({
      where: { commercialOrderId: order.order.id }
    })).toBe(2);
    expect(await prisma.commercialPaymentAttempt.count({
      where: {
        commercialOrderId: order.order.id,
        status: { in: ["CREATED", "PENDING"] }
      }
    })).toBe(1);
    expect(await prisma.access.count({ where: { commercialOrderId: order.order.id } })).toBe(0);
  });
});

test("concurrent paid_without_access reconciliation grants exactly one snapshot-based Access", async () => {
  const order = await createOrder("paid-without-access");
  const payment = await createSession(order.order.publicId, `pwa-session-${suffix}`);
  const paidAt = new Date(Date.now() - 61_000);
  await prisma.$transaction([
    prisma.commercialPaymentAttempt.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        providerPaymentId: `pwa-provider-${suffix}`,
        verifiedAt: paidAt,
        paidAt
      }
    }),
    prisma.commercialOrder.update({
      where: { id: order.order.id },
      data: { status: "PAID", paidAt }
    })
  ]);

  const attemptsBefore = await prisma.commercialPaymentAttempt.count({
    where: { commercialOrderId: order.order.id }
  });
  const analytics: AnalyticsWriteInput[] = [];
  const previousAnalyticsEnabled = process.env.ANALYTICS_ENABLED;
  const previousAnalyticsKey = process.env.ANALYTICS_ID_HMAC_KEY;
  const previousAnalyticsVersion = process.env.ANALYTICS_ID_KEY_VERSION;
  process.env.ANALYTICS_ENABLED = "true";
  process.env.ANALYTICS_ID_HMAC_KEY = "pwa-concurrency-test-key-with-32-characters";
  process.env.ANALYTICS_ID_KEY_VERSION = "pwa-test-v1";
  let results: Array<Awaited<ReturnType<typeof reconcilePaidCommercialOrderAccess>>> = [];
  try {
    results = await Promise.all(
      Array.from({ length: 8 }, () => reconcilePaidCommercialOrderAccess(
        order.order.publicId,
        async (input) => {
          analytics.push(input);
          return { enabled: true, inserted: true };
        }
      ))
    );
  } finally {
    if (previousAnalyticsEnabled === undefined) delete process.env.ANALYTICS_ENABLED;
    else process.env.ANALYTICS_ENABLED = previousAnalyticsEnabled;
    if (previousAnalyticsKey === undefined) delete process.env.ANALYTICS_ID_HMAC_KEY;
    else process.env.ANALYTICS_ID_HMAC_KEY = previousAnalyticsKey;
    if (previousAnalyticsVersion === undefined) delete process.env.ANALYTICS_ID_KEY_VERSION;
    else process.env.ANALYTICS_ID_KEY_VERSION = previousAnalyticsVersion;
  }

  expect(results.filter((result) => result.state === "resolved")).toHaveLength(1);
  expect(results.filter((result) => result.state === "already_resolved")).toHaveLength(7);
  expect(new Set(results.map((result) => result.access?.id)).size).toBe(1);
  expect(await prisma.access.count({ where: { commercialOrderId: order.order.id } })).toBe(1);
  expect(await prisma.commercialPaymentAttempt.count({ where: { commercialOrderId: order.order.id } })).toBe(attemptsBefore);

  const access = await prisma.access.findUniqueOrThrow({
    where: { commercialOrderId: order.order.id }
  });
  expect(access.commercialPaymentAttemptId).toBe(payment.id);
  expect(access.attemptsTotal).toBe(order.order.attemptLimitSnapshot);
  expect(access.attemptsAvailable).toBe(order.order.attemptLimitSnapshot);
  expect(Math.round((access.startDeadlineAt!.getTime() - access.grantedAt!.getTime()) / 86_400_000))
    .toBe(order.order.startWindowDaysSnapshot);
  expect(await prisma.eventLog.count({
    where: { entityId: order.order.id, eventType: "paid_without_access_detected" }
  })).toBe(1);
  expect(await prisma.eventLog.count({
    where: { entityId: order.order.id, eventType: "paid_without_access_resolved" }
  })).toBe(1);
  expect(await prisma.eventLog.count({
    where: { entityId: order.order.id, eventType: { contains: "refund" } }
  })).toBe(0);
  expect(analytics.map((event) => event.eventName)).toEqual([
    "paid_without_access_detected",
    "paid_without_access_resolved"
  ]);
  for (const event of analytics) assertNoForbiddenAnalyticsPayload(event.properties);
  const serializedAnalytics = JSON.stringify(analytics);
  expect(serializedAnalytics).not.toContain(order.order.emailNormalized);
  expect(serializedAnalytics).not.toContain(payment.merchantReference);
  expect(serializedAnalytics).not.toContain(`pwa-provider-${suffix}`);
});

test("an authoritative paid replay automatically reconciles paid_without_access", async () => {
  const order = await createOrder("paid-replay-reconciliation");
  const payment = await createSession(order.order.publicId, `pwa-replay-session-${suffix}`);
  const providerPaymentId = `pwa-replay-provider-${suffix}`;
  const paidAt = new Date();
  await prisma.$transaction([
    prisma.commercialPaymentAttempt.update({
      where: { id: payment.id },
      data: { status: "PAID", providerPaymentId, verifiedAt: paidAt, paidAt }
    }),
    prisma.commercialOrder.update({
      where: { id: order.order.id },
      data: { status: "PAID", paidAt }
    })
  ]);

  const replay = await notification({
    merchantReference: payment.merchantReference,
    eventKey: `pwa-replay-event-${suffix}`,
    status: "paid",
    paymentId: providerPaymentId
  });
  const result = await processCommercialProviderNotification({
    notification: replay.value,
    rawBody: replay.rawBody,
    provider: provider.provider
  });

  expect(result).toMatchObject({ rejected: false, grantedAccess: true });
  expect(await prisma.access.count({ where: { commercialOrderId: order.order.id } })).toBe(1);
  await expect(createSession(order.order.publicId, `pwa-replay-payment-retry-${suffix}`))
    .rejects.toMatchObject({ code: "ORDER_ALREADY_PAID" });
});

test("providerPaymentId conflict is not treated as a duplicate webhook", async () => {
  const firstOrder = await createOrder("shared-provider-first");
  const secondOrder = await createOrder("shared-provider-second");
  const firstAttempt = await createSession(firstOrder.order.publicId, `shared-first-${suffix}`);
  const secondAttempt = await createSession(secondOrder.order.publicId, `shared-second-${suffix}`);
  const sharedId = `shared-provider-id-${suffix}`;
  const firstPaid = await notification({ merchantReference: firstAttempt.merchantReference, eventKey: `shared-event-a-${suffix}`, status: "paid", paymentId: sharedId });
  await processCommercialProviderNotification({ notification: firstPaid.value, rawBody: firstPaid.rawBody, provider: provider.provider });
  const secondPaid = await notification({ merchantReference: secondAttempt.merchantReference, eventKey: `shared-event-b-${suffix}`, status: "paid", paymentId: sharedId });
  await expect(processCommercialProviderNotification({ notification: secondPaid.value, rawBody: secondPaid.rawBody, provider: provider.provider })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: secondOrder.order.id } })).status).toBe("PENDING");
  expect(await prisma.access.count({ where: { commercialOrderId: secondOrder.order.id } })).toBe(0);
  expect(await prisma.commercialPaymentEvent.count({ where: { provider: provider.provider, providerEventKey: `shared-event-b-${suffix}` } })).toBe(0);
});
