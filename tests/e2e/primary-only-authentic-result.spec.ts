import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import { createVerifiedStudentSessionService } from "@/server/auth/verified-student-session/service";

test.skip(
  process.env.RUN_PROD03_PRIMARY_RESULT_E2E !== "true",
  "Set RUN_PROD03_PRIMARY_RESULT_E2E=true with the dedicated PostgreSQL schema."
);
test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const verifiedKey = Buffer.alloc(32, 103);
const verifiedConfig: VerifiedStudentSessionConfig = {
  mode: "enforce",
  activeKeyVersion: "v1",
  keys: new Map([["v1", verifiedKey]])
};

let attemptId = "";
let rawToken = "";
let testId = "";
let productId = "";
let userId = "";

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("PROD03_PRIMARY_RESULT_E2E_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "prod03_primary_result_e2e") {
    throw new Error("PROD03_PRIMARY_RESULT_E2E_REQUIRES_DEDICATED_SCHEMA");
  }
}

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

async function assertAggregateDom(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Результат попытки" })).toHaveCount(1);
  await expect(page.getByText("Статус: завершено вручную", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Общий первичный результат: 80 из 80" })).toBeVisible();
  await expect(page.getByText("Общий первичный результат", { exact: true })).toBeVisible();
  await expect(page.getByText("80 из 80", { exact: true })).toBeVisible();
  await expect(page.getByText("Part A: 36 из 36", { exact: true })).toBeVisible();
  await expect(page.getByText("Part B: 44 из 44", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Это первичный результат этой тренировочной попытки. Он не является прогнозом результата ЦЭ или ЦТ.",
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole("link", { name: "Вернуться в каталог" })).toHaveAttribute("href", "/");

  for (const prohibited of [
    "PROD-03 browser authentic result",
    "CE/CT Russian 2026 format",
    "Первичный балл",
    "80 / 80",
    "Ошибки",
    "Разбор",
    "Детали ответов",
    "Ошибки и правильные ответы",
    "Ответ ученика",
    "Browser Part A",
    "Browser Part B",
    "Тестовый балл",
    "Шкальный балл",
    "Результат можно открыть повторно в течение 12 месяцев."
  ]) {
    await expect(page.getByText(prohibited, { exact: true })).toHaveCount(0);
  }
  await expect(page.locator("body")).not.toContainText("private browser");
}

async function assertScoreTypography(page: Page, expected: { fontSize: string; lineHeight: string }) {
  const score = page.getByText("80 из 80", { exact: true });
  const style = await score.evaluate((element) => {
    const computed = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const lineTops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
    return {
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
      lineCount: new Set(lineTops).size,
      whiteSpace: computed.whiteSpace
    };
  });
  expect(style).toEqual({
    fontSize: expected.fontSize,
    fontWeight: "700",
    lineHeight: expected.lineHeight,
    lineCount: 1,
    whiteSpace: "nowrap"
  });
}

test.beforeAll(async () => {
  assertDedicatedTestSchema();
  const testRecord = await prisma.test.create({
    data: {
      title: "PROD-03 browser authentic result",
      slug: `prod03-browser-${randomUUID()}`,
      price: 1000,
      durationMinutes: 120,
      mode: "CE_CT",
      examMode: "RIKZ_RUSSIAN_2026",
      status: "PUBLISHED",
      questionsCount: 2,
      maxRawScore: 80,
      showCorrectAnswers: false,
      questions: {
        create: [
          {
            questionText: "Browser Part A",
            questionType: "MULTI_SELECT_FIVE",
            optionA: "A",
            optionB: "B",
            optionC: "C",
            optionD: "D",
            optionE: "E",
            correctAnswer: "A,C",
            explanation: "private browser Part A explanation",
            topic: "Browser Part A",
            points: 36,
            officialPart: "A",
            officialNumber: 1,
            orderIndex: 1
          },
          {
            questionText: "Browser Part B",
            questionType: "SHORT_ANSWER_TOKEN",
            correctAnswer: "token",
            acceptedAnswers: ["token"],
            explanation: "private browser Part B explanation",
            topic: "Browser Part B",
            points: 44,
            officialPart: "B",
            officialNumber: 1,
            responseSubtype: "WORD",
            orderIndex: 2
          }
        ]
      }
    },
    include: { questions: { orderBy: { orderIndex: "asc" } } }
  });
  testId = testRecord.id;
  const product = await prisma.commercialProduct.create({
    data: {
      code: `prod03-browser-${randomUUID()}`,
      testId,
      name: "PROD-03 browser product",
      priceMinor: 1000
    }
  });
  productId = product.id;
  const user = await prisma.user.create({
    data: { email: `prod03-browser-${randomUUID()}@example.test`, role: "STUDENT" }
  });
  userId = user.id;
  const access = await prisma.access.create({
    data: {
      userId,
      testId,
      source: "COMMERCIAL",
      attemptsTotal: 1,
      attemptsAvailable: 0,
      expiresAt: new Date(Date.now() + 86_400_000),
      commercialProductId: productId,
      grantedAt: new Date(),
      startDeadlineAt: new Date(Date.now() + 86_400_000)
    }
  });
  const snapshot = {
    testId,
    title: testRecord.title,
    subject: "russian",
    mode: "ce_ct",
    examMode: "rikz_russian_2026",
    durationMinutes: 120,
    maxRawScore: 80,
    questions: testRecord.questions.map((question, index) => ({
      snapshotQuestionId: `q_${index + 1}`,
      originalQuestionId: question.id,
      orderIndex: question.orderIndex,
      questionText: question.questionText,
      questionType: index === 0 ? "multi_select_five" : "short_answer_token",
      options: index === 0 ? { A: "A", B: "B", C: "C", D: "D", E: "E" } : {},
      correctAnswer: question.correctAnswer,
      topic: question.topic,
      subtopic: null,
      points: question.points,
      scoringRule: index === 0 ? "full_match" : "exact_text",
      explanation: question.explanation,
      officialPart: index === 0 ? "A" : "B",
      officialNumber: 1,
      responseSubtype: index === 0 ? null : "word",
      acceptedAnswers: index === 0 ? null : ["token"]
    }))
  };
  const now = new Date();
  const attempt = await prisma.attempt.create({
    data: {
      userId,
      testId,
      accessId: access.id,
      status: "COMPLETED",
      startedAt: new Date(now.getTime() - 60_000),
      finishedAt: now,
      durationSeconds: 60,
      rawScore: 80,
      maxRawScore: 80,
      percent: new Prisma.Decimal(100),
      scaledScore: 100,
      maxScaledScore: 100,
      level: "высокий",
      testSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      scoringSchemeSnapshot: {
        scoringSchemeId: randomUUID(),
        name: "internal browser scale",
        subject: "russian",
        examType: "ce_ct",
        year: 2026,
        maxRawScore: 80,
        maxScaledScore: 100,
        scale: [{ rawScore: 80, scaledScore: 100 }]
      },
      answers: {
        create: snapshot.questions.map((question, index) => ({
          questionId: testRecord.questions[index]!.id,
          snapshotQuestionId: question.snapshotQuestionId,
          questionSnapshot: question as unknown as Prisma.InputJsonValue,
          selectedAnswer: index === 0 ? "A,C" : "token",
          isCorrect: true,
          pointsEarned: question.points,
          maxPoints: question.points,
          answeredAt: now
        }))
      }
    }
  });
  attemptId = attempt.id;
  const issued = await createVerifiedStudentSessionService({ client: prisma, config: verifiedConfig }).issue({
    userId,
    commercialProductId: productId,
    testId,
    accessId: access.id,
    source: "COMMERCIAL_ORDER_CLAIM",
    sourceReferenceId: randomUUID(),
    issuanceOperationId: randomUUID()
  });
  rawToken = issued.rawToken;
});

test.afterAll(async () => {
  if (attemptId) {
    await prisma.verifiedStudentSession.deleteMany({ where: { userId } });
    await prisma.answer.deleteMany({ where: { attemptId } });
    await prisma.attempt.deleteMany({ where: { id: attemptId } });
    await prisma.access.deleteMany({ where: { userId } });
  }
  if (productId) await prisma.commercialProduct.deleteMany({ where: { id: productId } });
  if (testId) {
    await prisma.question.deleteMany({ where: { testId } });
    await prisma.test.deleteMany({ where: { id: testId } });
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

test("authentic Result is aggregate-only in DOM, network, refresh and responsive presentation", async ({ page, context }, testInfo) => {
  await context.addCookies([{
    name: "verified_student_session",
    value: rawToken,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax"
  }]);

  const resultResponses: Array<Record<string, unknown>> = [];
  const completionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/complete")) completionRequests.push(request.url());
  });
  page.on("response", async (response) => {
    if (response.url().includes(`/api/results/${attemptId}`) && response.ok()) {
      resultResponses.push((await response.json()).data.result as Record<string, unknown>);
    }
  });

  const attemptsBefore = await prisma.attempt.count({ where: { id: attemptId } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/results/${attemptId}`);
  await assertAggregateDom(page);
  const heading = page.getByRole("heading", { level: 1, name: "Результат попытки" });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAttribute("tabindex", "-1");
  await assertNoHorizontalScroll(page);
  await assertScoreTypography(page, { fontSize: "56px", lineHeight: "64px" });
  await expect.poll(() => resultResponses.length).toBe(1);

  const desktopPartA = await page.locator('[data-result-block="part-a"]').boundingBox();
  const desktopPartB = await page.locator('[data-result-block="part-b"]').boundingBox();
  expect(desktopPartA?.y).toBe(desktopPartB?.y);
  expect(Math.abs((desktopPartA?.width ?? 0) - (desktopPartB?.width ?? 0))).toBeLessThanOrEqual(1);
  await capture(page, testInfo, "res-01a-authentic-desktop-1440x900");

  const catalogAction = page.getByRole("link", { name: "Вернуться в каталог" });
  const actionBox = await catalogAction.boundingBox();
  expect(actionBox?.width).toBeGreaterThanOrEqual(44);
  expect(actionBox?.height).toBeGreaterThanOrEqual(44);
  const catalogStyle = await catalogAction.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { backgroundColor: computed.backgroundColor, color: computed.color };
  });
  expect(catalogStyle.backgroundColor).not.toBe("rgb(23, 107, 91)");
  expect(catalogStyle.color).not.toBe("rgb(255, 255, 255)");
  await page.keyboard.press("Tab");
  await expect(catalogAction).toBeFocused();
  expect(await catalogAction.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      outlineColor: computed.outlineColor,
      outlineOffset: computed.outlineOffset,
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth
    };
  })).toEqual({
    outlineColor: "rgb(29, 78, 216)",
    outlineOffset: "2px",
    outlineStyle: "solid",
    outlineWidth: "3px"
  });
  await capture(page, testInfo, "res-01a-authentic-keyboard-focus");

  for (const viewport of [
    { width: 1024, height: 768, screenshot: null },
    { width: 390, height: 844, screenshot: "res-01a-authentic-mobile-390x844" },
    { width: 320, height: 568, screenshot: "res-01a-authentic-narrow-320x568" },
    { width: 720, height: 450, screenshot: "res-01a-authentic-200-percent-reflow" }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await assertAggregateDom(page);
    await assertNoHorizontalScroll(page);
    if (viewport.width < 768) {
      await assertScoreTypography(page, { fontSize: "44px", lineHeight: "52px" });
    } else {
      await assertScoreTypography(page, { fontSize: "56px", lineHeight: "64px" });
    }
    const total = page.locator('[data-result-block="total"]');
    const partA = page.locator('[data-result-block="part-a"]');
    const partB = page.locator('[data-result-block="part-b"]');
    for (const block of [total, partA, partB]) {
      expect(await block.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }

    if (viewport.width < 768) {
      const [totalBox, partABox, partBBox] = await Promise.all([
        total.boundingBox(),
        partA.boundingBox(),
        partB.boundingBox()
      ]);
      expect(totalBox?.y).toBeLessThan(partABox?.y ?? Number.POSITIVE_INFINITY);
      expect(partABox?.y).toBeLessThan(partBBox?.y ?? Number.POSITIVE_INFINITY);
    }

    if (viewport.screenshot) await capture(page, testInfo, viewport.screenshot);
  }

  await page.reload();
  await assertAggregateDom(page);
  await expect.poll(() => resultResponses.length).toBe(2);
  expect(await prisma.attempt.count({ where: { id: attemptId } })).toBe(attemptsBefore);
  expect(completionRequests).toHaveLength(0);

  for (const response of resultResponses) {
    for (const key of ["scaled_score", "max_scaled_score", "scaled_score_note"]) {
      expect(key in response).toBe(false);
    }
  }
});

test("temporary error, invalid JSON, network failure and not-ready stay safe and retry only GET", async ({ page, context }, testInfo) => {
  await context.addCookies([{
    name: "verified_student_session",
    value: rawToken,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax"
  }]);
  await page.setViewportSize({ width: 1440, height: 900 });

  type ResponseMode = "temporary" | "invalid-json" | "network" | "not-ready" | "success";
  let mode: ResponseMode = "temporary";
  let resultGetCount = 0;
  const resultMethods: string[] = [];
  const completionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(`/api/results/${attemptId}`)) resultMethods.push(request.method());
    if (request.url().includes("/complete")) completionRequests.push(request.url());
  });

  await page.route(`**/api/results/${attemptId}`, async (route) => {
    resultGetCount += 1;
    if (mode === "success") {
      await route.fallback();
      return;
    }
    if (mode === "network") {
      await route.abort("failed");
      return;
    }
    if (mode === "invalid-json") {
      await route.fulfill({ status: 200, contentType: "text/plain", body: "not-json" });
      return;
    }
    if (mode === "not-ready") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "RESULT_NOT_READY", message: "private not-ready provider detail" }
        })
      });
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { code: "P1001", message: "Prisma PostgreSQL private provider detail" }
      })
    });
  });

  await page.goto(`/results/${attemptId}`);
  const temporaryCopy = "Не удалось загрузить результат. Попытка не будет завершена повторно. Повторите загрузку.";
  await expect(page.getByText(temporaryCopy, { exact: true })).toBeVisible();
  await expect(page.getByRole("alert", { name: "Результат попытки" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить загрузку" })).toBeVisible();
  const temporarySurfaceBox = await page.getByRole("alert", { name: "Результат попытки" }).boundingBox();
  expect(temporarySurfaceBox?.width).toBeLessThanOrEqual(680);
  const temporaryRetryStyle = await page.getByRole("button", { name: "Повторить загрузку" }).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { backgroundColor: computed.backgroundColor, color: computed.color };
  });
  expect(temporaryRetryStyle).toEqual({
    backgroundColor: "rgb(23, 107, 91)",
    color: "rgb(255, 255, 255)"
  });
  await expect(page.locator("body")).not.toContainText("P1001");
  await expect(page.locator("body")).not.toContainText("Prisma");
  await expect(page.locator("body")).not.toContainText("PostgreSQL");
  const requestsBeforeWait = resultGetCount;
  await page.waitForTimeout(350);
  expect(resultGetCount).toBe(requestsBeforeWait);
  await capture(page, testInfo, "res-01a-temporary-error");

  mode = "invalid-json";
  await page.reload();
  await expect(page.getByText(temporaryCopy, { exact: true })).toBeVisible();

  mode = "network";
  await page.reload();
  await expect(page.getByText(temporaryCopy, { exact: true })).toBeVisible();

  mode = "not-ready";
  await page.reload();
  await expect(page.getByText("Результат ещё не готов. Повторное завершение не требуется.", { exact: true })).toBeVisible();
  await expect(page.getByText("Общий первичный результат", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Part A:", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Part B:", { exact: false })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("private not-ready provider detail");
  const notReadySurfaceBox = await page.locator("section").filter({ hasText: "Результат ещё не готов." }).boundingBox();
  expect(notReadySurfaceBox?.width).toBeLessThanOrEqual(680);
  await capture(page, testInfo, "res-01a-not-ready");

  mode = "success";
  const requestsBeforeRetry = resultGetCount;
  const attemptsBeforeRetry = await prisma.attempt.count({ where: { id: attemptId } });
  const retry = page.getByRole("button", { name: "Повторить загрузку" });
  await retry.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await assertAggregateDom(page);
  await expect.poll(() => resultGetCount).toBe(requestsBeforeRetry + 1);
  expect(await prisma.attempt.count({ where: { id: attemptId } })).toBe(attemptsBeforeRetry);
  expect(resultMethods.every((method) => method === "GET")).toBe(true);
  expect(completionRequests).toHaveLength(0);
});
