import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createCommercialOrder, createCommercialPaymentSession, processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { LocalFakeCommercialProvider } from "@/lib/commercial/providers";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide PostgreSQL to run commercial checkout integration.");

const prisma = new PrismaClient();
const suffix = Date.now().toString();
const productCode = `commercial-e2e-${suffix}`;
const email = `commercial-e2e-${suffix}@example.test`;
let productId = "";

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
  await prisma.user.deleteMany({ where: { email } });
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
