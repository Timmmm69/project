import { randomUUID } from "node:crypto";
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
  if (user) await prisma.verifiedStudentSession.deleteMany({ where: { userId: user.id } });
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

test("commercial checkout claims Access before the explicit verified Attempt start", async ({ page }) => {
  const commercialPosts: string[] = [];
  const attemptStartPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/commercial/orders/")) {
      commercialPosts.push(new URL(request.url()).pathname);
    }
    if (request.method() === "POST" && request.url().endsWith("/api/attempts/start")) {
      attemptStartPosts.push(new URL(request.url()).pathname);
    }
  });
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
  const paidOrderPublicId = new URL(page.url()).searchParams.get("commercialOrder");
  expect(paidOrderPublicId).toBeTruthy();
  const paidUser = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const paidAccess = await prisma.access.findFirstOrThrow({ where: { userId: paidUser.id, testId } });
  await expect(checkout.getByRole("button", { name: "Перейти к началу" })).toBeVisible();

  const claimResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/commercial/orders/${paidOrderPublicId}/claim-access`) &&
    response.request().method() === "POST"
  );
  await checkout.getByRole("button", { name: "Перейти к началу" }).click();
  const claimResponse = await claimResponsePromise;
  expect(claimResponse.ok()).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/tests/${testSlug}$`));
  expect(commercialPosts.some((path) => path.endsWith("/claim-access"))).toBe(true);
  expect(commercialPosts.some((path) => path.endsWith("/start-attempt"))).toBe(false);

  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(0);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: paidAccess.id } })).attemptsAvailable).toBe(1);
  expect(await prisma.eventLog.count({ where: { actorUserId: paidUser.id, eventType: "attempt_started" } })).toBe(0);

  const prestart = page.locator("section.prestart-surface");
  const prestartHeading = page.getByRole("heading", { name: "Перед началом попытки" });
  const startButton = page.getByRole("button", {
    name: "Начать единственную попытку и запустить непрерывный таймер на 120 минут"
  });
  const cancelButton = page.getByRole("button", { name: "Вернуться без старта" });
  await expect(prestartHeading).toBeFocused();
  await expect(prestart).toContainText("Это единственная попытка по данной покупке.");
  await expect(prestart).toContainText("После старта непрерывно идёт 120 минут. Паузы нет.");
  await expect(prestart).toContainText("Закрытие страницы, вкладки или браузера не останавливает время.");
  await expect(prestart).toContainText("После завершения показывается первичный результат: общий, Part A и Part B.");
  await expect(page.getByText("Тестовая оплата")).toHaveCount(0);
  await expect(page.getByText("Что входит")).toHaveCount(0);
  await expect(page.getByText("Как проходит тест")).toHaveCount(0);
  await expect(page.getByText("Начать или продолжить тест")).toHaveCount(0);
  await expect(page.getByText(/auto|автосохран/i)).toHaveCount(0);
  await expect(page.getByText(/Осталось|Таймер/i)).toHaveCount(0);

  await page.keyboard.press("Enter");
  expect(attemptStartPosts).toHaveLength(0);
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(0);
  await page.keyboard.press("Tab");
  await expect(startButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelButton).toBeFocused();

  const surfaceBox = await prestart.boundingBox();
  expect(surfaceBox).not.toBeNull();
  expect(surfaceBox!.width).toBeLessThanOrEqual(761);
  expect(Math.abs(surfaceBox!.x - ((await page.viewportSize())!.width - surfaceBox!.width) / 2)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await cancelButton.click();
  await expect(page).toHaveURL(new RegExp(`/tests/${testSlug}\\?view=product$`));
  await expect(page.getByText("Доступ готов. Попытка ещё не начата.")).toBeVisible();
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(0);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: paidAccess.id } })).attemptsAvailable).toBe(1);
  expect(await prisma.eventLog.count({ where: { actorUserId: paidUser.id, eventType: "attempt_started" } })).toBe(0);
  await page.getByRole("link", { name: "Перейти к началу" }).click();
  await expect(page).toHaveURL(new RegExp(`/tests/${testSlug}$`));

  await page.setViewportSize({ width: 375, height: 812 });
  const mobileStart = page.getByRole("button", {
    name: "Начать единственную попытку и запустить непрерывный таймер на 120 минут"
  });
  const mobileCancel = page.getByRole("button", { name: "Вернуться без старта" });
  const mobileStartBox = await mobileStart.boundingBox();
  const mobileCancelBox = await mobileCancel.boundingBox();
  expect(mobileStartBox).not.toBeNull();
  expect(mobileCancelBox).not.toBeNull();
  expect(mobileStartBox!.y).toBeLessThan(mobileCancelBox!.y);
  expect(Math.abs(mobileStartBox!.width - mobileCancelBox!.width)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });

  const legacy = await page.request.post(`/api/commercial/orders/${paidOrderPublicId}/start-attempt`, {
    headers: {
      origin: "http://localhost:3000",
      "Idempotency-Key": randomUUID()
    }
  });
  expect(legacy.ok()).toBe(true);
  expect((await legacy.json()).data).toMatchObject({
    nextAction: "OPEN_PRE",
    nextUrl: `/tests/${testSlug}`,
    testId
  });
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(0);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: paidAccess.id } })).attemptsAvailable).toBe(1);
  expect(await prisma.eventLog.count({ where: { actorUserId: paidUser.id, eventType: "attempt_started" } })).toBe(0);

  const restoredAttemptId = randomUUID();
  await page.route("**/api/attempts/start", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          nextAction: "OPEN_ATTEMPT",
          nextUrl: `/attempts/${restoredAttemptId}`,
          restored: true
        }
      }
    });
  });
  const requestsBeforeRestored = attemptStartPosts.length;
  await page.getByRole("button", {
    name: "Начать единственную попытку и запустить непрерывный таймер на 120 минут"
  }).click();
  await expect(page.getByRole("heading", { name: "Попытка уже началась" })).toBeVisible();
  await expect(page.getByText("Новая попытка не создаётся. Время продолжает идти с первоначального старта.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Продолжить попытку" })).toBeVisible();
  expect(attemptStartPosts).toHaveLength(requestsBeforeRestored + 1);
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(0);
  await page.unroute("**/api/attempts/start");
  await page.reload();

  await page.route("**/api/attempts/start", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      json: { success: false, error: "RAW_INTERNAL_FAILURE" }
    });
  });
  const requestsBeforeFailure = attemptStartPosts.length;
  const failureStart = page.getByRole("button", {
    name: "Начать единственную попытку и запустить непрерывный таймер на 120 минут"
  });
  await failureStart.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("status")).toHaveText("Запускаем попытку…");
  await expect(failureStart).toBeDisabled();
  await expect(page.getByRole("button", { name: "Вернуться без старта" })).toBeDisabled();
  const startError = page.locator(".prestart-error");
  await expect(startError).toHaveText("Не удалось запустить попытку. Система проверит, не была ли она уже создана. Повторите действие.");
  await expect(startError).toBeFocused();
  await expect(page.getByText("RAW_INTERNAL_FAILURE")).toHaveCount(0);
  expect(attemptStartPosts).toHaveLength(requestsBeforeFailure + 1);
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(0);
  await page.unroute("**/api/attempts/start");

  const explicitStartResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/attempts/start") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Проверить и повторить" }).click();
  const explicitStart = await explicitStartResponse;
  expect(explicitStart.ok()).toBe(true);
  await expect(page).toHaveURL(/\/attempts\/[0-9a-f-]{36}$/);
  const attemptUrl = new URL(page.url()).pathname;
  const attemptId = attemptUrl.split("/").at(-1)!;

  await expect.poll(() => prisma.access.count({ where: { user: { email }, testId } })).toBe(1);
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId, status: "STARTED" } })).toBe(1);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: paidAccess.id } })).attemptsAvailable).toBe(0);
  expect(await prisma.eventLog.count({ where: { actorUserId: paidUser.id, eventType: "attempt_started" } })).toBe(1);

  const startedBeforeReentry = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });

  await page.goto(`/tests/${testSlug}`);
  await expect(page).toHaveURL(new RegExp(`${attemptUrl}$`));
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(1);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: paidAccess.id } })).attemptsAvailable).toBe(0);
  expect(await prisma.eventLog.count({ where: { actorUserId: paidUser.id, eventType: "attempt_started" } })).toBe(1);
  expect(await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).toEqual(startedBeforeReentry);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${attemptUrl}$`));
  await expect(page.getByRole("heading", { name: "Перед началом попытки" })).toHaveCount(0);

  const repeatedStart = await page.request.post("/api/attempts/start", { data: { testId } });
  expect(repeatedStart.ok()).toBe(true);
  expect(await repeatedStart.json()).toMatchObject({
    data: {
      nextAction: "OPEN_ATTEMPT",
      nextUrl: attemptUrl,
      attempt: { attemptId },
      restored: true
    }
  });
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(1);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: paidAccess.id } })).attemptsAvailable).toBe(0);
  expect(await prisma.eventLog.count({ where: { actorUserId: paidUser.id, eventType: "attempt_started" } })).toBe(1);
  expect(await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).toEqual(startedBeforeReentry);
});
