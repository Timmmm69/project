import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createCommercialOrder, createCommercialPaymentSession, processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { LocalFakeCommercialProvider } from "@/lib/commercial/providers";
import { hashLookupToken } from "@/lib/commercial/security";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide local PostgreSQL.");
test.describe.configure({ mode: "serial" });

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
  return createCommercialOrder({
    productCode,
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
  const userIds = [...new Set(accesses.map((access) => access.userId))];
  await prisma.eventLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.commercialProduct.delete({ where: { id: productId } });
  await prisma.$disconnect();
});

test("parallel normalized-email orders create one open order without token rotation", async () => {
  const mixedCase = `Order-Race-${suffix}@Example.Test`;
  const normalized = mixedCase.toLowerCase();
  const results = await Promise.allSettled([
    createCommercialOrder({ productCode, email: mixedCase, adultBuyerConfirmed: true, legalBundleVersion: "concurrency-v1", idempotencyKey: `race-a-${suffix}` }),
    createCommercialOrder({ productCode, email: normalized, adultBuyerConfirmed: true, legalBundleVersion: "concurrency-v1", idempotencyKey: `race-b-${suffix}` })
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
  for (let index = 0; index < 4; index += 1) {
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
