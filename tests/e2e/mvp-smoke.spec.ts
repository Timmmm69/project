import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.skip(process.env.RUN_E2E_WITH_DB !== "true", "Set RUN_E2E_WITH_DB=true and provide PostgreSQL to run MVP smoke e2e.");

const prisma = new PrismaClient();
const slug = `e2e-mvp-smoke-${Date.now()}`;
const studentEmail = `e2e-${Date.now()}@example.com`;

test.beforeAll(async () => {
  await prisma.test.create({
    data: {
      title: "E2E MVP Smoke Test",
      slug,
      subject: "RUSSIAN",
      mode: "TRAINING",
      shortDescription: "E2E fixture",
      price: 0,
      currency: "BYN",
      durationMinutes: 30,
      attemptsLimit: 1,
      accessDays: 7,
      status: "PUBLISHED",
      publishedAt: new Date(),
      questionsCount: 3,
      maxRawScore: 4,
      questions: {
        create: [
          {
            questionText: "Choose B",
            questionType: "SINGLE_CHOICE",
            optionA: "Wrong",
            optionB: "Correct",
            correctAnswer: "B",
            topic: "Орфография",
            subtopic: "Буквы",
            points: 1,
            scoringRule: "FULL_MATCH",
            orderIndex: 1
          },
          {
            questionText: "Choose A and C",
            questionType: "MULTIPLE_CHOICE",
            optionA: "Correct 1",
            optionB: "Wrong",
            optionC: "Correct 2",
            correctAnswer: "A,C",
            topic: "Пунктуация",
            subtopic: "Запятые",
            points: 2,
            scoringRule: "FULL_MATCH",
            orderIndex: 2
          },
          {
            questionText: "Type synonym",
            questionType: "SHORT_TEXT",
            correctAnswer: "смелый;храбрый",
            topic: "Лексика",
            subtopic: "Синонимы",
            points: 1,
            scoringRule: "EXACT_TEXT",
            orderIndex: 3
          }
        ]
      }
    }
  });
});

test.afterAll(async () => {
  const testRecord = await prisma.test.findUnique({ where: { slug }, select: { id: true } });
  if (testRecord) {
    const attemptIds = await prisma.attempt.findMany({
      where: { testId: testRecord.id },
      select: { id: true }
    });
    await prisma.answer.deleteMany({ where: { attemptId: { in: attemptIds.map((attempt) => attempt.id) } } });
    await prisma.attempt.deleteMany({ where: { testId: testRecord.id } });
    await prisma.access.deleteMany({ where: { testId: testRecord.id } });
    await prisma.payment.deleteMany({ where: { testId: testRecord.id } });
    await prisma.accessCode.deleteMany({ where: { testId: testRecord.id } });
    await prisma.question.deleteMany({ where: { testId: testRecord.id } });
    await prisma.test.delete({ where: { id: testRecord.id } });
  }
  await prisma.emailLog.deleteMany({ where: { email: studentEmail } });
  await prisma.eventLog.deleteMany({ where: { actorUser: { email: studentEmail } } });
  await prisma.user.deleteMany({ where: { email: studentEmail } });
  await prisma.$disconnect();
});

test("student can buy access, complete a test, and see the result", async ({ page }) => {
  await page.goto(`/tests/${slug}`);

  await page.getByLabel("Email для доступа").fill(studentEmail);
  await page.getByRole("button", { name: "Проверить доступ" }).click();
  await expect(page.getByText("Для этого email пока нет доступа к тесту.")).toBeVisible();

  await page.getByRole("button", { name: "Создать тестовую оплату" }).click();
  await page.getByRole("button", { name: "Подтвердить тестовую оплату" }).click();
  await expect(page.getByText("Доступ открыт.")).toBeVisible();

  await page.getByRole("button", { name: "Начать тест" }).click();
  await expect(page).toHaveURL(/\/attempts\//);

  await page.getByLabel("B. Correct").check();
  await page.getByLabel("A. Correct 1").check();
  await page.getByLabel("C. Correct 2").check();
  await page.getByLabel("Ответ").fill("храбрый");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Завершить тест" }).click();
  await expect(page).toHaveURL(/\/results\//);
  await expect(page.getByText("Первичный балл")).toBeVisible();
  await expect(page.getByText("4 / 4")).toBeVisible();
  await expect(page.getByText("Ошибок нет.")).toBeVisible();
});
