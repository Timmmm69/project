import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.skip(
  process.env.RUN_ACC01A_RECOVERY_UI_E2E !== "true",
  "Set RUN_ACC01A_RECOVERY_UI_E2E=true with the dedicated PostgreSQL schema."
);

const prisma = new PrismaClient();
const productCode = "russian-training-variant-01";
const email = "recovery-browser@example.test";
let testSlug = "";
let createdTestId: string | null = null;
let createdProductId: string | null = null;

function assertDedicatedSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ACC01A_RECOVERY_UI_E2E_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "acc01a_recovery_ui_e2e") {
    throw new Error("ACC01A_RECOVERY_UI_E2E_REQUIRES_DEDICATED_SCHEMA");
  }
}

test.beforeAll(async () => {
  assertDedicatedSchema();
  const existing = await prisma.commercialProduct.findUnique({
    where: { code: productCode },
    include: { test: { select: { slug: true, status: true } } }
  });
  if (existing) {
    if (existing.test.status !== "PUBLISHED") {
      throw new Error("ACC01A_RECOVERY_UI_E2E_PRODUCT_MUST_BE_PUBLISHED");
    }
    testSlug = existing.test.slug;
    return;
  }

  const testRecord = await prisma.test.create({
    data: {
      title: "ACC-01A recovery UI fixture",
      slug: `acc01a-recovery-ui-${randomUUID()}`,
      subject: "RUSSIAN",
      mode: "CE_CT",
      examMode: "RIKZ_RUSSIAN_2026",
      price: 1000,
      currency: "BYN",
      durationMinutes: 120,
      attemptsLimit: 1,
      accessDays: 90,
      status: "PUBLISHED",
      publishedAt: new Date(),
      questionsCount: 40,
      maxRawScore: 80,
      showCorrectAnswers: false
    }
  });
  const product = await prisma.commercialProduct.create({
    data: {
      code: productCode,
      testId: testRecord.id,
      name: "ACC-01A recovery UI fixture",
      priceMinor: 1000,
      currency: "BYN",
      attemptLimit: 1,
      startWindowDays: 90,
      resultRetentionDays: 365,
      isActive: true
    }
  });
  createdTestId = testRecord.id;
  createdProductId = product.id;
  testSlug = testRecord.slug;
});

test.afterAll(async () => {
  if (createdProductId) {
    await prisma.commercialProduct.deleteMany({ where: { id: createdProductId } });
  }
  if (createdTestId) {
    await prisma.test.deleteMany({ where: { id: createdTestId } });
  }
  await prisma.$disconnect();
});

function error(route: Route, status: number, code: string, headers?: Record<string, string>) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify({ error: { code, message: "not rendered by the UI" } })
  });
}

async function mockInitialSessionRequired(page: Page) {
  await page.route("**/api/recovery/state", (route) =>
    error(route, 401, "RECOVERY_SESSION_REQUIRED"));
}

test("recovery flow is neutral, validates OTP, resumes an attempt and stays private on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let verified = false;
  let continuationRequests = 0;
  const challengeBodies: Array<Record<string, unknown>> = [];
  const verifyBodies: Array<Record<string, unknown>> = [];
  const continuationBodies: Array<Record<string, unknown>> = [];
  const attemptId = "11111111-1111-4111-8111-111111111111";

  await page.route("**/api/recovery/state", (route) => {
    if (!verified) return error(route, 401, "RECOVERY_SESSION_REQUIRED");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "attempt_active",
        screen: "REC-01",
        nextAction: "CONTINUE"
      })
    });
  });
  await page.route("**/api/recovery/challenges", async (route) => {
    challengeBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        state: "code_sent",
        messageKey: "email.sent_neutral",
        emailMasked: "r***y@example.test",
        resendAfterSeconds: 60
      })
    });
  });
  await page.route("**/api/recovery/challenges/verify", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    verifyBodies.push(body);
    if (body.code === "000000") return error(route, 401, "CODE_INVALID");
    verified = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "verified",
        messageKey: "email.code.verified",
        nextAction: "RESOLVE"
      })
    });
  });
  await page.route("**/api/recovery/continue", async (route) => {
    continuationRequests += 1;
    continuationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nextAction: "OPEN_ATTEMPT",
        nextUrl: `/attempts/${attemptId}`
      })
    });
  });
  await page.route(`**/attempts/${attemptId}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Safe internal recovery destination</title>"
  }));

  await page.goto(`/tests/${testSlug}`);
  await expect(page.getByRole("button", { name: "Восстановить доступ" })).toBeVisible();
  await page.getByRole("button", { name: "Восстановить доступ" }).click();
  await expect(page.getByLabel("Email для восстановления")).toBeVisible();
  await expect(page.locator(".recovery-panel .form-error")).toHaveCount(0);
  await page.getByLabel("Email для восстановления").fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();

  await expect(page.getByText("Если этот email связан с доступом, на него отправлен одноразовый код."))
    .toBeVisible();
  await expect(page.getByText("Адрес: r***y@example.test")).toBeVisible();
  await expect(page.getByRole("button", { name: /Отправить код повторно через/ })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("заказ найден");
  await expect(page.locator("body")).not.toContainText("оплата прошла");
  expect(challengeBodies[0]).toMatchObject({
    email,
    productCode,
    intent: "recovery"
  });
  expect(challengeBodies[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);

  await page.getByLabel("Код из письма").fill("000000");
  await page.getByRole("button", { name: "Подтвердить код" }).click();
  await expect(page.locator(".recovery-panel .form-error")).toContainText("Код не подошёл");

  await page.getByLabel("Код из письма").fill("123456");
  await page.getByRole("button", { name: "Подтвердить код" }).click();
  await expect(page.getByText("Найдена активная попытка.")) .toBeVisible();
  expect(verifyBodies).toHaveLength(2);
  expect(verifyBodies[0]?.operationId).not.toBe(verifyBodies[1]?.operationId);

  const continueButton = page.getByRole("button", { name: "Продолжить тест" });
  await continueButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page).toHaveURL(new RegExp(`/attempts/${attemptId}$`));
  expect(continuationRequests).toBe(1);
  expect(continuationBodies).toHaveLength(1);

  const currentUrl = page.url();
  expect(currentUrl).not.toContain(email);
  expect(currentUrl).not.toContain("123456");
  const browserState = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  }));
  const serializedStorage = JSON.stringify({
    local: browserState.local,
    session: browserState.session
  });
  expect(serializedStorage).not.toContain(email);
  expect(serializedStorage).not.toContain("000000");
  expect(serializedStorage).not.toContain("123456");
  expect(serializedStorage).not.toMatch(/recovery/i);
  expect(browserState.width).toBeLessThanOrEqual(browserState.viewport);
});

test("reload restores result_available and exposes only the Result CTA", async ({ page }) => {
  await page.route("**/api/recovery/state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      state: "result_available",
      screen: "REC-01",
      nextAction: "CONTINUE"
    })
  }));

  await page.goto(`/tests/${testSlug}`);
  await expect(page.getByRole("button", { name: "Посмотреть результат" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Продолжить тест" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Перейти к тесту" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Посмотреть результат" })).toBeVisible();
});

test("non-actionable and support states do not start checkout", async ({ page }) => {
  let state = "start_window_expired";
  let orderRequests = 0;
  await page.route("**/api/recovery/state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ state, screen: "REC-01", nextAction: null })
  }));
  await page.route("**/api/commercial/orders", async (route) => {
    orderRequests += 1;
    await route.abort();
  });

  await page.goto(`/tests/${testSlug}`);
  await expect(page.getByText("Срок начала попытки истёк.")).toBeVisible();
  expect(orderRequests).toBe(0);

  state = "no_access";
  await page.reload();
  await expect(page.getByText("Для этого email оплаченный доступ не найден.")) .toBeVisible();
  await expect(page.getByRole("link", { name: "Вернуться к оплате" })).toHaveAttribute(
    "href",
    "#commercial-checkout"
  );
  expect(orderRequests).toBe(0);

  state = "support_required";
  await page.reload();
  await expect(page.getByText("Не удалось безопасно определить состояние доступа.")) .toBeVisible();
  await expect(page.getByRole("link", { name: "support@example.test" }))
    .toHaveAttribute("href", "mailto:support@example.test");
  expect(orderRequests).toBe(0);
});

test("backend feature unavailability removes the recovery CTA", async ({ page }) => {
  await page.route("**/api/recovery/state", (route) => error(route, 404, "FEATURE_UNAVAILABLE"));
  await page.goto(`/tests/${testSlug}`);
  await expect(page.getByRole("button", { name: "Восстановить доступ" })).toHaveCount(0);
});

test("390px layout has no horizontal scroll", async ({ page }) => {
  await mockInitialSessionRequired(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tests/${testSlug}`);
  await page.getByRole("button", { name: "Восстановить доступ" }).click();
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
});

test("network retry reuses the challenge UUID and cancel clears the local flow", async ({ page }) => {
  await mockInitialSessionRequired(page);
  const requestBodies: Array<Record<string, unknown>> = [];
  let requestCount = 0;
  let deleteCount = 0;
  await page.route("**/api/recovery/challenges", async (route) => {
    requestCount += 1;
    requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requestCount === 1) return route.abort("failed");
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        state: "code_sent",
        messageKey: "email.sent_neutral",
        resendAfterSeconds: 60
      })
    });
  });
  await page.route("**/api/recovery/session", async (route) => {
    deleteCount += 1;
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto(`/tests/${testSlug}`);
  await page.getByRole("button", { name: "Восстановить доступ" }).click();
  await page.getByLabel("Email для восстановления").fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.locator(".recovery-panel .form-error")).toContainText("Не удалось связаться");
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByText("Если этот email связан с доступом")) .toBeVisible();
  expect(requestBodies).toHaveLength(2);
  expect(requestBodies[0]?.idempotencyKey).toBe(requestBodies[1]?.idempotencyKey);

  await page.getByRole("button", { name: "Отменить восстановление" }).click();
  await expect(page.getByRole("button", { name: "Восстановить доступ" })).toBeVisible();
  expect(deleteCount).toBe(1);
  expect(page.url()).not.toContain(email);
});

test("access_unstarted rejects an external continuation destination", async ({ page }) => {
  await page.route("**/api/recovery/state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      state: "access_unstarted",
      screen: "REC-01",
      nextAction: "CONTINUE"
    })
  }));
  await page.route("**/api/recovery/continue", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ nextAction: "OPEN_PRE", nextUrl: "https://evil.example.test/" })
  }));

  await page.goto(`/tests/${testSlug}`);
  await expect(page.getByText("Доступ найден. Можно перейти к началу теста.")) .toBeVisible();
  const originalUrl = page.url();
  await page.getByRole("button", { name: "Перейти к тесту" }).click();
  await expect(page.locator(".recovery-panel .form-error")).toContainText("некорректный ответ");
  expect(page.url()).toBe(originalUrl);
});
