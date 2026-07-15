import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import { createVerifiedStudentSessionService } from "@/server/auth/verified-student-session/service";

test.skip(
  process.env.RUN_PROD03_PRIMARY_RESULT_E2E !== "true",
  "Set RUN_PROD03_PRIMARY_RESULT_E2E=true with the dedicated PostgreSQL schema."
);

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

test("authentic Result stays primary-only in DOM, network, refresh and mobile", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{
    name: "verified_student_session",
    value: rawToken,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax"
  }]);

  const resultResponses: Array<Record<string, unknown>> = [];
  page.on("response", async (response) => {
    if (response.url().includes(`/api/results/${attemptId}`) && response.ok()) {
      resultResponses.push((await response.json()).data.result as Record<string, unknown>);
    }
  });

  await page.goto(`/results/${attemptId}`);
  await expect(page.getByText("Первичный балл")).toBeVisible();
  await expect(page.getByText("80 / 80", { exact: true })).toBeVisible();
  await expect(page.getByText("Part A", { exact: true })).toBeVisible();
  await expect(page.getByText("Part B", { exact: true })).toBeVisible();
  await expect(page.getByText("36 / 36 первичных баллов")).toBeVisible();
  await expect(page.getByText("44 / 44 первичных баллов")).toBeVisible();
  await expect(page.getByText(/Тестовый балл/i)).toHaveCount(0);
  await expect(page.getByText(/Шкальный балл/i)).toHaveCount(0);
  await expect(page.getByText(/таблиц[аеы]/i)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("private browser");
  await expect.poll(() => resultResponses.length).toBe(1);
  for (const key of ["scaled_score", "max_scaled_score", "scaled_score_note"]) {
    expect(key in resultResponses[0]!).toBe(false);
  }

  await page.reload();
  await expect(page.getByText("80 / 80", { exact: true })).toBeVisible();
  await expect(page.getByText(/Тестовый балл/i)).toHaveCount(0);
  await expect.poll(() => resultResponses.length).toBe(2);
  for (const key of ["scaled_score", "max_scaled_score", "scaled_score_note"]) {
    expect(key in resultResponses[1]!).toBe(false);
  }
});
