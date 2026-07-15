import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide a dedicated PostgreSQL database.");
test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const runId = `${Date.now()}`;
const authenticSlug = `catalog-authentic-${runId}`;
const genericSlug = `catalog-generic-${runId}`;

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function assertNoHorizontalScroll(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.beforeAll(async () => {
  await prisma.test.deleteMany({ where: { slug: { in: [authenticSlug, genericSlug] } } });
  await prisma.test.createMany({
    data: [
      {
        title: "Тренировочный тест по русскому языку",
        slug: authenticSlug,
        subject: "RUSSIAN",
        mode: "CE_CT",
        examMode: "RIKZ_RUSSIAN_2026",
        shortDescription: "Оригинальный тренировочный материал для самостоятельной подготовки.",
        price: 1000,
        currency: "BYN",
        durationMinutes: 120,
        attemptsLimit: 1,
        accessDays: 90,
        status: "PUBLISHED",
        questionsCount: 40,
        maxRawScore: 80,
        showScaledScore: false,
        publishedAt: new Date("2026-07-15T12:00:00.000Z")
      },
      {
        title: "Длинное название generic-теста по лексике и грамматике русского языка",
        slug: genericSlug,
        subject: "RUSSIAN",
        mode: "CE_CT",
        examMode: "GENERIC",
        shortDescription: "Длинное второстепенное описание для проверки переносов и порядка: цена, основные факты и действия должны оставаться выше этого текста.",
        price: 123456,
        currency: "BYN",
        durationMinutes: 120,
        attemptsLimit: 1,
        accessDays: 14,
        status: "PUBLISHED",
        questionsCount: 40,
        maxRawScore: 80,
        showScaledScore: false,
        publishedAt: new Date("2026-07-14T12:00:00.000Z")
      }
    ]
  });
});

test.afterAll(async () => {
  await prisma.test.deleteMany({ where: { slug: { in: [authenticSlug, genericSlug] } } });
  await prisma.$disconnect();
});

test("desktop success, authentic content, generic regression and product navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Тренировочные тесты по русскому языку" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Админка" })).toHaveCount(0);
  await expect(page.getByText("разбор ошибок", { exact: false })).toHaveCount(0);
  await expect(page.getByText("близком к реальной проверке", { exact: false })).toHaveCount(0);

  const authenticCard = page.locator(`[data-catalog-kind="authentic"]:has(a[href="/tests/${authenticSlug}"])`);
  const genericCard = page.locator(`[data-catalog-kind="generic"]:has(a[href="/tests/${genericSlug}"])`);
  await expect(authenticCard).toContainText("Оригинальный тренировочный вариант");
  await expect(authenticCard).toContainText("40 заданий");
  await expect(authenticCard).toContainText("120 минут");
  await expect(authenticCard).toContainText("10 BYN");
  await expect(authenticCard).toContainText("Только первичный результат");
  await expect(authenticCard).toContainText("Не является официальным материалом ЦЭ/ЦТ.");

  await expect(genericCard).toContainText("40 заданий");
  await expect(genericCard).toContainText("120 минут");
  await expect(genericCard).toContainText("1 попытка");
  await expect(genericCard).toContainText("1234,56 BYN");
  await expect(genericCard).not.toContainText("Оригинальный тренировочный вариант");
  await expect(genericCard).not.toContainText("Одна покупка — одна попытка");
  await expect(genericCard).not.toContainText("Только первичный результат");
  await expect(genericCard).not.toContainText("Не является официальным материалом ЦЭ/ЦТ.");

  await assertNoHorizontalScroll(page);
  await capture(page, testInfo, "cat-01-desktop-1440x900");

  const primary = authenticCard.getByRole("link", { name: "Подробнее о тесте" });
  const existingAccess = authenticCard.getByRole("link", { name: "Уже есть доступ?" });
  await expect(primary).toHaveAttribute("href", `/tests/${authenticSlug}`);
  await expect(existingAccess).toHaveAttribute("href", `/tests/${authenticSlug}`);
  await primary.click();
  await expect(page).toHaveURL(new RegExp(`/tests/${authenticSlug}$`));
  await page.goBack();
  await expect(authenticCard).toBeVisible();

  await expect(page.getByText("Доступ готов. Попытка ещё не начата.")).toHaveCount(0);
  await expect(page.getByText("Попытка активна. Время продолжает идти.")).toHaveCount(0);
  await expect(page.getByText("Результат доступен")).toHaveCount(0);
});

test("keyboard order and visible focus", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");
  const pageLinks = page.locator("main a");
  await expect(pageLinks.nth(0)).toHaveAccessibleName(/Русский язык.*главная/);
  await expect(pageLinks.nth(1)).toHaveAccessibleName("Подробнее о тесте");
  await expect(pageLinks.nth(2)).toHaveAccessibleName("Уже есть доступ?");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /Русский язык.*главная/ })).toBeFocused();
  const primary = page.locator(`[data-catalog-kind="authentic"]:has(a[href="/tests/${authenticSlug}"])`).getByRole("link", { name: "Подробнее о тесте" });
  for (let step = 0; step < 4 && !await primary.evaluate((element) => element === document.activeElement); step += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(primary).toBeFocused();
  expect(await primary.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await capture(page, testInfo, "cat-01-keyboard-focus");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/tests/${authenticSlug}$`));
});

for (const viewport of [
  { height: 800, label: "1280x800", width: 1280 },
  { height: 768, label: "1024x768", width: 1024 },
  { height: 844, label: "390x844", width: 390 },
  { height: 568, label: "320x568", width: 320 }
]) {
  test(`responsive catalog at ${viewport.label}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await page.goto("/");

    const authenticCard = page.locator(`[data-catalog-kind="authentic"]:has(a[href="/tests/${authenticSlug}"])`);
    const price = authenticCard.getByText("10 BYN", { exact: true });
    const primary = authenticCard.getByRole("link", { name: "Подробнее о тесте" });
    const description = authenticCard.getByText("Оригинальный тренировочный материал для самостоятельной подготовки.");

    await expect(price).toBeVisible();
    await expect(primary).toBeVisible();
    await expect(authenticCard.getByText("40 заданий")).toBeVisible();
    await expect(authenticCard.getByText("120 минут")).toBeVisible();
    await assertNoHorizontalScroll(page);

    const [priceBox, primaryBox, descriptionBox] = await Promise.all([
      price.boundingBox(),
      primary.boundingBox(),
      description.boundingBox()
    ]);
    expect(priceBox?.y).toBeLessThan(descriptionBox?.y ?? Number.POSITIVE_INFINITY);
    expect(primaryBox?.y).toBeLessThan(descriptionBox?.y ?? Number.POSITIVE_INFINITY);
    expect(primaryBox?.width).toBeGreaterThanOrEqual(44);
    expect(primaryBox?.height).toBeGreaterThanOrEqual(44);

    if (viewport.width <= 390) {
      await capture(page, testInfo, `cat-01-mobile-${viewport.label}`);
    }
  });
}

test("200 percent zoom equivalent reflows without lost content", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 450, width: 720 });
  await page.goto("/");
  const authenticCard = page.locator(`[data-catalog-kind="authentic"]:has(a[href="/tests/${authenticSlug}"])`);
  await expect(authenticCard.getByRole("heading", { name: "Тренировочный тест по русскому языку" })).toBeVisible();
  await expect(authenticCard.getByRole("link", { name: "Подробнее о тесте" })).toBeVisible();
  await assertNoHorizontalScroll(page);
  await capture(page, testInfo, "cat-01-200-percent-zoom-equivalent");
});

test("empty state has no product or inactive support action", async ({ page }, testInfo) => {
  const published = await prisma.test.findMany({ where: { status: "PUBLISHED" }, select: { id: true } });
  try {
    await prisma.test.updateMany({ where: { id: { in: published.map(({ id }) => id) } }, data: { status: "HIDDEN" } });
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Сейчас нет доступных тестов" })).toBeVisible();
    await expect(page.getByText("Покупка недоступна. Можно вернуться позже или обратиться в поддержку.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Подробнее о тесте" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /обратиться в поддержку/i })).toHaveCount(0);
    await capture(page, testInfo, "cat-01-empty-state");
  } finally {
    await prisma.test.updateMany({ where: { id: { in: published.map(({ id }) => id) } }, data: { status: "PUBLISHED" } });
  }
});
