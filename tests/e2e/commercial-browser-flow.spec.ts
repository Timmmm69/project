import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide local PostgreSQL to run commercial browser e2e.");

const prisma = new PrismaClient();
const email = `commercial-browser-${Date.now()}@example.test`;
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
  const orders = await prisma.commercialOrder.findMany({ where: { emailNormalized: email }, select: { id: true } });
  const paymentAttempts = await prisma.commercialPaymentAttempt.findMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } }, select: { id: true } });
  await prisma.commercialPaymentEvent.deleteMany({ where: { commercialPaymentAttemptId: { in: paymentAttempts.map((attempt) => attempt.id) } } });
  await prisma.access.deleteMany({ where: { commercialOrderId: { in: orders.map((order) => order.id) } } });
  await prisma.commercialPaymentAttempt.deleteMany({ where: { id: { in: paymentAttempts.map((attempt) => attempt.id) } } });
  await prisma.commercialOrder.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
  if (user) {
    await prisma.eventLog.deleteMany({ where: { actorUserId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

test("commercial checkout returns, claims access, and resumes the existing attempt", async ({ page }) => {
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

  await page.addInitScript(() => {
    document.addEventListener("focusin", (event) => {
      if (!(event.target instanceof HTMLElement) || event.target.id !== "prestart-access-expired-title") return;
      const root = document.documentElement;
      const current = Number(root.dataset.expiredHeadingFocusTransfers ?? "0");
      root.dataset.expiredHeadingFocusTransfers = String(current + 1);
    }, true);
  });
  const expiredAt = new Date(Date.now() - 1_000);
  await prisma.access.update({
    where: { id: paidAccess.id },
    data: { expiresAt: expiredAt, startDeadlineAt: expiredAt }
  });
  const attemptsBeforeExpiredPresentation = await prisma.attempt.count({ where: { userId: paidUser.id, testId } });
  const startPostsBeforeExpiredPresentation = attemptStartPosts.length;
  await page.reload();
  const expiredHeading = page.getByRole("heading", { name: "Срок начала попытки истёк" });
  const expiredDescription = page.locator("#prestart-access-expired-description");
  const expiredSurface = page.locator('section[aria-labelledby="prestart-access-expired-title"]');
  await expect(expiredHeading).toBeFocused();
  await expect(expiredHeading).toHaveAttribute("tabindex", "-1");
  await expect(expiredHeading).toHaveAttribute(
    "aria-describedby",
    "prestart-access-expired-description"
  );
  await expect(expiredDescription).toHaveText(
    "Начать попытку по этому доступу нельзя. Обратитесь в поддержку для проверки ситуации."
  );
  await expect(expiredSurface).toHaveAttribute("aria-labelledby", "prestart-access-expired-title");
  await expect(expiredSurface).not.toHaveAttribute("role", "alert");
  await expect(expiredSurface).not.toHaveAttribute("aria-live", /.+/);
  await expect(expiredSurface.locator('[role="alert"], [aria-live]')).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-expired-heading-focus-transfers", "1");
  await expect(page.getByRole("button", { name: /Начать попытку|Проверить и повторить/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Обратиться в поддержку" })).toHaveCount(0);
  await expect(page.getByText("Тестовая оплата")).toHaveCount(0);
  await expect(page.getByText("RAW_INTERNAL_FAILURE")).toHaveCount(0);
  const expiredHtml = await page.content();
  for (const sensitive of [paidUser.id, paidAccess.id, paidOrderPublicId!, testId, "support@example.test"]) {
    expect(expiredHtml).not.toContain(sensitive);
  }
  await page.keyboard.press("Enter");
  expect(attemptStartPosts).toHaveLength(startPostsBeforeExpiredPresentation);
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(attemptsBeforeExpiredPresentation);
  await page.reload();
  await expect(expiredHeading).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-expired-heading-focus-transfers", "1");
  expect(await prisma.attempt.count({ where: { userId: paidUser.id, testId } })).toBe(attemptsBeforeExpiredPresentation);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: paidAccess.id } })).attemptsAvailable).toBe(1);
  expect(await prisma.eventLog.count({ where: { actorUserId: paidUser.id, eventType: "attempt_started" } })).toBe(0);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(expiredHeading).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 640, height: 720 });
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });

  await prisma.access.update({
    where: { id: paidAccess.id },
    data: {
      expiresAt: paidAccess.expiresAt,
      startDeadlineAt: paidAccess.startDeadlineAt
    }
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Перед началом попытки" })).toBeFocused();



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
