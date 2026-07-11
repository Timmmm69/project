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
  await page.goto(`/tests/${testSlug}`);
  const checkout = page.locator("section.subpanel").filter({ has: page.getByRole("heading", { name: "Тестовая оплата" }) });
  await expect(checkout).toContainText("10.00 BYN");
  await expect(checkout).toContainText("90 дней");
  await expect(checkout).not.toContainText("шкала РИКЗ");
  await checkout.locator('input[type="email"]').fill(email);
  await checkout.locator('input[type="checkbox"]').check();
  await checkout.getByRole("button", { name: /Перейти к оплате/ }).click();
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
