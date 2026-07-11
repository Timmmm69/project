import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { POST as webPayNotify } from "@/app/api/payments/webpay/notify/route";
import { createCommercialOrder, createCommercialPaymentSession, processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { LocalFakeCommercialProvider, WebPaySandboxProvider } from "@/lib/commercial/providers";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide PostgreSQL to run commercial checkout integration.");

const prisma = new PrismaClient();
const suffix = Date.now().toString();
const productCode = `commercial-e2e-${suffix}`;
const email = `commercial-e2e-${suffix}@example.test`;
const webPayEmail = `commercial-webpay-e2e-${suffix}@example.test`;
const stateEmail = `commercial-state-${suffix}@example.test`;
const raceEmail = `commercial-race-${suffix}@example.test`;
const doublePaidEmail = `commercial-double-paid-${suffix}@example.test`;
const reusedKeyEmail = `commercial-reused-key-${suffix}@example.test`;
const conflictEmail = `commercial-conflict-${suffix}@example.test`;
const conflictHolderEmail = `commercial-conflict-holder-${suffix}@example.test`;
let productId = "";

async function createPendingFixture(fixtureEmail: string, key: string) {
  const created = await createCommercialOrder({
    productCode,
    email: fixtureEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `${key}-${suffix}`
  });
  const attempt = await prisma.commercialPaymentAttempt.create({
    data: {
      commercialOrderId: created.order.id,
      provider: "LOCAL_FAKE",
      merchantReference: `${key}-reference-${suffix}`,
      status: "PENDING",
      amountMinor: 1000,
      currency: "BYN",
      checkoutIdempotencyKey: `${key}-checkout-${suffix}`
    }
  });
  await prisma.commercialOrder.update({ where: { id: created.order.id }, data: { status: "PENDING" } });
  return { order: created.order, attempt };
}

async function fakeEvent(input: {
  merchantReference: string;
  status: "pending" | "paid" | "failed" | "cancelled" | "expired";
  eventKey: string;
  paymentId?: string;
  signature?: string;
  marker?: string;
}) {
  const raw = JSON.stringify({
    merchant_reference: input.merchantReference,
    payment_id: input.paymentId ?? input.eventKey,
    event_key: input.eventKey,
    status: input.status,
    amount_minor: "1000",
    currency: "BYN",
    signature: input.signature ?? "local-fake-valid",
    marker: input.marker
  });
  const provider = new LocalFakeCommercialProvider();
  const notification = await provider.verifyNotification(raw);
  return {
    raw,
    notification,
    process: () => processCommercialProviderNotification({ notification, rawBody: raw, provider: provider.provider })
  };
}

test.beforeAll(async () => {
  process.env.LEGAL_BUNDLE_VERSION = "e2e-v1";
  const testRecord = await prisma.test.findFirst({
    where: { examMode: "RIKZ_RUSSIAN_2026", status: "PUBLISHED", deletedAt: null },
    select: { id: true }
  });
  if (!testRecord) throw new Error("A published authentic test is required for commercial e2e.");
  const product = await prisma.commercialProduct.create({
    data: {
      code: productCode,
      testId: testRecord.id,
      name: "Commercial e2e fixture",
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
  const attempts = await prisma.commercialPaymentAttempt.findMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } }, select: { id: true } });
  const accesses = await prisma.access.findMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } }, select: { id: true } });
  const completedAttempts = await prisma.attempt.findMany({ where: { accessId: { in: accesses.map((access) => access.id) } }, select: { id: true } });
  await prisma.commercialPaymentEvent.deleteMany({ where: { commercialPaymentAttemptId: { in: attempts.map((attempt) => attempt.id) } } });
  await prisma.answer.deleteMany({ where: { attemptId: { in: completedAttempts.map((attempt) => attempt.id) } } });
  await prisma.attempt.deleteMany({ where: { id: { in: completedAttempts.map((attempt) => attempt.id) } } });
  await prisma.access.deleteMany({ where: { id: { in: accesses.map((access) => access.id) } } });
  await prisma.commercialPaymentAttempt.deleteMany({ where: { id: { in: attempts.map((attempt) => attempt.id) } } });
  await prisma.commercialOrder.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
  await prisma.commercialProduct.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [email, webPayEmail, stateEmail, raceEmail, doublePaidEmail, reusedKeyEmail, conflictEmail, conflictHolderEmail]
      }
    }
  });
  await prisma.$disconnect();
});

test("fake provider grants one access and replay is a no-op", async () => {
  const created = await createCommercialOrder({
    productCode,
    email,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `order-${suffix}-idempotency`
  });
  expect(created.order.priceMinor).toBe(1000);

  const provider = new LocalFakeCommercialProvider();
  const payment = await createCommercialPaymentSession({
    publicId: created.order.publicId,
    idempotencyKey: `payment-${suffix}-idempotency`,
    provider,
    appUrl: "http://localhost:3000"
  });
  expect(payment.amountMinor).toBe(1000);
  const sameActive = await createCommercialPaymentSession({
    publicId: created.order.publicId,
    idempotencyKey: `payment-${suffix}-another-key`,
    provider,
    appUrl: "http://localhost:3000"
  });
  expect(sameActive.id).toBe(payment.id);
  await expect(createCommercialOrder({
    productCode,
    email,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `order-${suffix}-different-key`
  })).rejects.toMatchObject({ code: "ORDER_ALREADY_PENDING" });

  const raw = JSON.stringify({
    merchant_reference: payment.merchantReference,
    payment_id: `fake-${suffix}`,
    event_key: `event-${suffix}`,
    status: "paid",
    amount_minor: "1000",
    currency: "BYN",
    signature: "local-fake-valid"
  });
  const notification = await provider.verifyNotification(raw);
  const providerMismatch = await processCommercialProviderNotification({ notification, rawBody: raw, provider: "WEBPAY_SANDBOX" });
  expect(providerMismatch.rejected).toBe(true);
  const first = await processCommercialProviderNotification({ notification, rawBody: raw, provider: provider.provider });
  const replay = await processCommercialProviderNotification({ notification, rawBody: raw, provider: provider.provider });

  expect(first.grantedAccess).toBe(true);
  expect(replay.duplicate).toBe(true);
  expect(await prisma.access.count({ where: { commercialOrderId: created.order.id } })).toBe(1);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).status).toBe("PAID");

  const access = await prisma.access.findUniqueOrThrow({ where: { commercialOrderId: created.order.id } });
  await prisma.access.update({ where: { id: access.id }, data: { attemptsAvailable: 0 } });
  await prisma.attempt.create({
    data: {
      userId: access.userId,
      testId: access.testId,
      accessId: access.id,
      status: "COMPLETED",
      startedAt: new Date(),
      finishedAt: new Date(),
      testSnapshot: {}
    }
  });
  const repurchase = await createCommercialOrder({
    productCode,
    email,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `order-${suffix}-after-completion`
  });
  expect(repurchase.order.id).not.toBe(created.order.id);
});

test("forged WebPay callback cannot pay, while an exact status response grants one access", async () => {
  process.env.WEBPAY_SANDBOX_STORE_ID = "e2e-store";
  process.env.WEBPAY_SANDBOX_SECRET_KEY = "e2e-secret";
  process.env.WEBPAY_SANDBOX_CHECKOUT_URL = "https://checkout.example.test";
  process.env.WEBPAY_SANDBOX_STATUS_URL = "https://status.example.test/payment";

  const created = await createCommercialOrder({
    productCode,
    email: webPayEmail,
    adultBuyerConfirmed: true,
    legalBundleVersion: "e2e-v1",
    idempotencyKey: `webpay-order-${suffix}`
  });
  const provider = new WebPaySandboxProvider();
  const payment = await createCommercialPaymentSession({
    publicId: created.order.publicId,
    idempotencyKey: `webpay-payment-${suffix}`,
    provider,
    appUrl: "http://localhost:3000"
  });
  const checkoutFields = payment.providerFields as Record<string, string>;
  const forgedCallback = new URLSearchParams({
    wsb_seed: checkoutFields.wsb_seed,
    wsb_storeid: checkoutFields.wsb_storeid,
    wsb_order_num: checkoutFields.wsb_order_num,
    wsb_test: checkoutFields.wsb_test,
    wsb_currency_id: checkoutFields.wsb_currency_id,
    wsb_total: checkoutFields.wsb_total,
    wsb_signature: checkoutFields.wsb_signature,
    wsb_result_code: "1",
    wsb_transaction_id: `forged-${suffix}`
  }).toString();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new URLSearchParams({
    wsb_order_num: payment.merchantReference,
    wsb_status: "pending",
    wsb_total: "10.00",
    wsb_currency_id: "BYN"
  }).toString(), { status: 200 });
  try {
    await webPayNotify(new Request("http://localhost:3000/api/payments/webpay/notify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: forgedCallback
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).status).toBe("PENDING");
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  expect(await prisma.access.count({ where: { commercialOrderId: created.order.id } })).toBe(0);

  globalThis.fetch = async () => new Response(new URLSearchParams({
    wsb_order_num: payment.merchantReference,
    wsb_result_code: "1",
    wsb_transaction_id: `authoritative-${suffix}`,
    wsb_total: "10.00",
    wsb_currency_id: "BYN"
  }).toString(), { status: 200 });
  let authoritative;
  try {
    authoritative = await provider.fetchPaymentStatus({ merchantReference: payment.merchantReference, providerPaymentId: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const processed = await processCommercialProviderNotification({
    notification: authoritative,
    rawBody: JSON.stringify(authoritative.redactedPayload),
    provider: provider.provider
  });

  expect(processed).toMatchObject({ rejected: false, grantedAccess: true });
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: created.order.id } })).status).toBe("PAID");
  expect(await prisma.access.count({ where: { commercialOrderId: created.order.id } })).toBe(1);
});

test("a paid order is not downgraded by callbacks for another payment attempt", async () => {
  const fixture = await createPendingFixture(stateEmail, "state-primary");
  const secondAttempt = await prisma.commercialPaymentAttempt.create({
    data: {
      commercialOrderId: fixture.order.id,
      provider: "LOCAL_FAKE",
      merchantReference: `state-secondary-reference-${suffix}`,
      status: "FAILED",
      amountMinor: 1000,
      currency: "BYN",
      checkoutIdempotencyKey: `state-secondary-checkout-${suffix}`
    }
  });
  const paid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `state-paid-${suffix}`
  });
  expect(await paid.process()).toMatchObject({ rejected: false, grantedAccess: true });

  for (const status of ["failed", "cancelled", "expired", "pending"] as const) {
    const late = await fakeEvent({
      merchantReference: secondAttempt.merchantReference,
      status,
      eventKey: `state-${status}-${suffix}`
    });
    expect(await late.process()).toMatchObject({ rejected: true, grantedAccess: false });
  }

  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PAID");
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: secondAttempt.id } })).status).toBe("FAILED");
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
});

test("parallel paid and failed callbacks cannot downgrade an already paid attempt", async () => {
  const fixture = await createPendingFixture(raceEmail, "race");
  const initialPaid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `race-initial-paid-${suffix}`,
    paymentId: `race-payment-${suffix}`
  });
  await initialPaid.process();
  const paid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `race-parallel-paid-${suffix}`,
    paymentId: `race-payment-${suffix}`,
    marker: "parallel-paid"
  });
  const failed = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "failed",
    eventKey: `race-parallel-failed-${suffix}`,
    paymentId: `race-payment-${suffix}`,
    marker: "parallel-failed"
  });
  await Promise.all([paid.process(), failed.process()]);

  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PAID");
  expect((await prisma.commercialPaymentAttempt.findUniqueOrThrow({ where: { id: fixture.attempt.id } })).status).toBe("PAID");
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
});

test("parallel paid callbacks with different event keys grant one access", async () => {
  const fixture = await createPendingFixture(doublePaidEmail, "double-paid");
  const first = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `double-paid-first-${suffix}`,
    paymentId: `double-paid-payment-${suffix}`,
    marker: "first"
  });
  const second = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey: `double-paid-second-${suffix}`,
    paymentId: `double-paid-payment-${suffix}`,
    marker: "second"
  });
  const results = await Promise.all([first.process(), second.process()]);

  expect(results.every((result) => !result.rejected)).toBe(true);
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("PAID");
});

test("an invalid event does not reserve its provider event key", async () => {
  const fixture = await createPendingFixture(reusedKeyEmail, "reused-key");
  const eventKey = `reused-transaction-${suffix}`;
  const invalid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey,
    paymentId: eventKey,
    signature: "invalid"
  });
  expect(await invalid.process()).toMatchObject({ rejected: true });
  const valid = await fakeEvent({
    merchantReference: fixture.attempt.merchantReference,
    status: "paid",
    eventKey,
    paymentId: eventKey,
    marker: "corrected"
  });
  expect(await valid.process()).toMatchObject({ rejected: false, grantedAccess: true });
  expect(await prisma.access.count({ where: { commercialOrderId: fixture.order.id } })).toBe(1);
});

test("a provider payment id P2002 is not reported as a duplicate payment event", async () => {
  const target = await createPendingFixture(conflictEmail, "conflict-target");
  const holder = await createPendingFixture(conflictHolderEmail, "conflict-holder");
  const providerPaymentId = `provider-payment-conflict-${suffix}`;
  await prisma.commercialPaymentAttempt.update({
    where: { id: holder.attempt.id },
    data: { providerPaymentId }
  });
  const conflicting = await fakeEvent({
    merchantReference: target.attempt.merchantReference,
    status: "paid",
    eventKey: `conflict-event-${suffix}`,
    paymentId: providerPaymentId
  });

  await expect(conflicting.process()).rejects.toMatchObject({ code: "P2002" });
  expect((await prisma.commercialOrder.findUniqueOrThrow({ where: { id: target.order.id } })).status).toBe("PENDING");
  expect(await prisma.access.count({ where: { commercialOrderId: target.order.id } })).toBe(0);
});
