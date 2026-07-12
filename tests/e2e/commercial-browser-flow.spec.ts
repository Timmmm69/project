import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { lookupTokenMatches } from "@/lib/commercial/security";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide local PostgreSQL to run commercial browser e2e.");

const prisma = new PrismaClient();
const email = `commercial-browser-${Date.now()}@example.test`;
const routeRetryEmail = `commercial-route-retry-${Date.now()}@example.test`;
const routeConcurrentEmail = `commercial-route-concurrent-${Date.now()}@example.test`;
let testSlug = "";
let testId = "";

test.beforeAll(async () => {
  const product = await prisma.commercialProduct.findUnique({
    where: { code: "russian-training-variant-01" },
    include: { test: { select: { id: true, slug: true, status: true } } }
  });
  if (!product || product.test.status !== "PUBLISHED") throw new Error("A seeded published commercial product is required for browser e2e.");
  testSlug = product.test.slug;
  testId = product.test.id;
});

test.afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const attempts = await prisma.attempt.findMany({ where: { userId: user.id, testId }, select: { id: true } });
    await prisma.answer.deleteMany({ where: { attemptId: { in: attempts.map((attempt) => attempt.id) } } });
    await prisma.attempt.deleteMany({ where: { id: { in: attempts.map((attempt) => attempt.id) } } });
  }
  const orders = await prisma.commercialOrder.findMany({
    where: { emailNormalized: { in: [email, routeRetryEmail, routeConcurrentEmail] } },
    select: { id: true, checkoutFlowId: true }
  });
  const paymentAttempts = await prisma.commercialPaymentAttempt.findMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } }, select: { id: true } });
  await prisma.commercialPaymentEvent.deleteMany({ where: { commercialPaymentAttemptId: { in: paymentAttempts.map((attempt) => attempt.id) } } });
  await prisma.access.deleteMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } } });
  await prisma.commercialPaymentAttempt.deleteMany({ where: { id: { in: paymentAttempts.map((attempt) => attempt.id) } } });
  await prisma.commercialOrder.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
  await prisma.commercialCheckoutFlow.deleteMany({
    where: { id: { in: orders.flatMap((order) => order.checkoutFlowId ? [order.checkoutFlowId] : []) } }
  });
  if (user) {
    await prisma.eventLog.deleteMany({ where: { actorUserId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

function cookieValue(response: { headers(): Record<string, string> }, cookieName: string) {
  const header = response.headers()["set-cookie"] ?? "";
  const match = header.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match) throw new Error("Expected commercial order Set-Cookie header");
  return match[1];
}

async function createFlow(request: { post(url: string, options: object): Promise<{ ok(): boolean; json(): Promise<unknown> }> }, clientKey: string) {
  const response = await request.post("/api/commercial/checkout-flows", {
    headers: { origin: "http://localhost:3000", "x-forwarded-for": clientKey },
    data: { productCode: "russian-training-variant-01" }
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { success: true; data: { checkout_flow_id: string } };
  return body.data.checkout_flow_id;
}

test("idempotent order route retries preserve the original HttpOnly cookie", async ({ page }) => {
  const clientKey = `route-retry-${Date.now()}`;
  const checkoutFlowId = await createFlow(page.request, clientKey);
  const idempotencyKey = `route-retry-idempotency-${Date.now()}`;
  const options = {
    headers: {
      origin: "http://localhost:3000",
      "x-forwarded-for": clientKey,
      "Idempotency-Key": idempotencyKey
    },
    data: {
      productCode: "russian-training-variant-01",
      checkout_flow_id: checkoutFlowId,
      email: routeRetryEmail,
      adultBuyerConfirmed: true,
      legalBundleVersion: "e2e-v1"
    }
  };

  const first = await page.request.post("/api/commercial/orders", options);
  expect(first.status()).toBe(201);
  const firstBody = await first.json() as { success: true; data: { order: { publicId: string } } };
  const cookieName = `commercial_order_${firstBody.data.order.publicId}`;
  const firstToken = cookieValue(first, cookieName);
  const storedAfterCreate = await prisma.commercialOrder.findUniqueOrThrow({
    where: { publicId: firstBody.data.order.publicId }
  });
  expect(lookupTokenMatches(firstToken, storedAfterCreate.lookupTokenHash)).toBe(true);

  const retried = await page.request.post("/api/commercial/orders", options);
  expect(retried.status()).toBe(201);
  const retryToken = cookieValue(retried, cookieName);
  expect(retryToken).toBe(firstToken);
  const storedAfterRetry = await prisma.commercialOrder.findUniqueOrThrow({ where: { id: storedAfterCreate.id } });
  expect(storedAfterRetry.lookupTokenHash).toBe(storedAfterCreate.lookupTokenHash);
  expect(lookupTokenMatches(firstToken, storedAfterRetry.lookupTokenHash)).toBe(true);
  expect((await page.request.get(`/api/commercial/orders/${firstBody.data.order.publicId}/status`)).status()).toBe(200);
});

test("concurrent order route responses set interchangeable valid cookies", async ({ page }) => {
  const clientKey = `route-concurrent-${Date.now()}`;
  const checkoutFlowId = await createFlow(page.request, clientKey);
  const idempotencyKey = `route-concurrent-idempotency-${Date.now()}`;
  const options = {
    headers: {
      origin: "http://localhost:3000",
      "x-forwarded-for": clientKey,
      "Idempotency-Key": idempotencyKey
    },
    data: {
      productCode: "russian-training-variant-01",
      checkout_flow_id: checkoutFlowId,
      email: routeConcurrentEmail,
      adultBuyerConfirmed: true,
      legalBundleVersion: "e2e-v1"
    }
  };
  const [first, second] = await Promise.all([
    page.request.post("/api/commercial/orders", options),
    page.request.post("/api/commercial/orders", options)
  ]);
  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);
  const firstBody = await first.json() as { success: true; data: { order: { publicId: string } } };
  const secondBody = await second.json() as { success: true; data: { order: { publicId: string } } };
  expect(secondBody.data.order.publicId).toBe(firstBody.data.order.publicId);
  const cookieName = `commercial_order_${firstBody.data.order.publicId}`;
  const firstToken = cookieValue(first, cookieName);
  const secondToken = cookieValue(second, cookieName);
  expect(secondToken).toBe(firstToken);
  const stored = await prisma.commercialOrder.findUniqueOrThrow({ where: { publicId: firstBody.data.order.publicId } });
  expect(await prisma.commercialOrder.count({ where: { checkoutFlowId } })).toBe(1);
  expect(lookupTokenMatches(firstToken, stored.lookupTokenHash)).toBe(true);
  expect(lookupTokenMatches(secondToken, stored.lookupTokenHash)).toBe(true);
  const browserCookie = (await page.context().cookies()).find((cookie) => cookie.name === cookieName);
  expect(browserCookie?.httpOnly).toBe(true);
  expect(lookupTokenMatches(browserCookie?.value, stored.lookupTokenHash)).toBe(true);
});

test("commercial checkout returns, claims access, and resumes the existing attempt", async ({ page }) => {
  await page.goto(`/tests/${testSlug}`);
  const checkout = page.locator("section.subpanel").filter({ has: page.getByRole("heading", { name: "Тестовая оплата" }) });
  await expect(checkout).toContainText("10.00 BYN");
  await expect(checkout).toContainText("90 дней");
  await expect(checkout).not.toContainText("шкала РИКЗ");
  await checkout.locator('input[type="email"]').fill(email);
  await checkout.locator('input[type="checkbox"]').check();
  const flowResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/commercial/checkout-flows") && response.request().method() === "POST"
  );
  await checkout.getByRole("button", { name: /Перейти к оплате/ }).click();
  const flowResponse = await flowResponsePromise;
  const flowBody = await flowResponse.json() as { success: boolean; data?: { checkout_flow_id?: string } };
  expect(flowResponse.status()).toBe(201);
  expect(flowBody.data?.checkout_flow_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await checkout.getByRole("button", { name: /Открыть тестовую оплату/ }).click();

  await expect(page).toHaveURL(/commercialOrder=.*paymentReturn=1/);
  await expect(checkout).toContainText("Оплата подтверждена");
  await checkout.getByRole("button", { name: "Начать тест" }).click();
  await expect(page).toHaveURL(/\/attempts\//);

  await expect.poll(() => prisma.access.count({ where: { user: { email }, testId } })).toBe(1);
  await page.goto(`/tests/${testSlug}`);
  const reopened = page.locator("section.subpanel").filter({ has: page.getByRole("heading", { name: "Тестовая оплата" }) });
  await reopened.locator('input[type="email"]').fill(email);
  await reopened.locator('input[type="checkbox"]').check();
  await reopened.getByRole("button", { name: /Перейти к оплате/ }).click();
  await expect(reopened.getByRole("button", { name: "Продолжить тест" })).toBeVisible();
  await reopened.getByRole("button", { name: "Продолжить тест" }).click();
  await expect(page).toHaveURL(/\/attempts\//);
  await expect.poll(() => prisma.access.count({ where: { user: { email }, testId } })).toBe(1);
});
