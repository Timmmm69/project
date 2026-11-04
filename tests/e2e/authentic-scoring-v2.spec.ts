import { expect, test, type Page } from "@playwright/test";

// Browser contract tests for the real AttemptRunner; backend scoring/persistence
// is covered separately by the dedicated-schema integration suite.
const id = "10000000-0000-4000-8000-000000000001";
const questions = [
  { snapshotQuestionId: "q_1", orderIndex: 1, questionText: "Выберите цифры", questionType: "short_answer_token", officialPart: "B", officialNumber: 1, options: {}, topic: "Набор", subtopic: null, answerFormat: { version: 1, kind: "set", alphabet: "12345" } },
  { snapshotQuestionId: "q_2", orderIndex: 2, questionText: "Установите соответствия", questionType: "short_answer_token", officialPart: "B", officialNumber: 19, options: {}, topic: "Соответствия", subtopic: null, answerFormat: { version: 1, kind: "matching", positions: "АБВГ", values: "12345" } }
];
async function activeAttempt(page: Page, seconds = 120) {
  await page.route(`**/api/attempts/${id}`, (route) => route.fulfill({ json: {
    success: true, data: { attempt: {
      attemptId: id, testId: "test", status: "started", startedAt: new Date().toISOString(), finishedAt: null,
      durationMinutes: 120, serverNow: new Date().toISOString(), endsAt: new Date(Date.now() + seconds * 1000).toISOString(),
      questions, answers: []
    } }
  } }));
  await page.route(`**/results/${id}`, (route) => route.fulfill({ contentType: "text/html", body: "<p>Результат сохранён</p>" }));
  await page.goto(`/attempts/${id}`);
  await expect(page.getByRole("heading", { name: "Попытка", exact: true })).toBeVisible();
}

test("keeps raw edits, serializes quick saves and waits before manual completion", async ({ page }) => {
  const saved: string[] = [];
  let releaseFirst: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route(`**/api/attempts/${id}/answers`, async (route) => {
    const body = route.request().postDataJSON() as { selectedAnswer: string };
    if (saved.length === 0) await gate;
    saved.push(body.selectedAnswer);
    await route.fulfill({ json: { success: true, data: { saved: true } } });
  });
  let completeCalls = 0;
  await page.route(`**/api/attempts/${id}/complete`, async (route) => {
    completeCalls += 1;
    expect(saved.at(-1)).toBe("531");
    await route.fulfill({ json: { success: true, data: { resultUrl: `/results/${id}` } } });
  });
  await activeAttempt(page);
  const input = page.getByRole("textbox").first();
  await input.fill("1");
  await input.fill("13");
  await input.fill("531");
  await expect(input).toHaveValue("531");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Завершить тест", exact: true }).click();
  await expect(input).toBeDisabled();
  expect(completeCalls).toBe(0);
  releaseFirst();
  await expect(page).toHaveURL(`/results/${id}`);
  expect(saved).toEqual(["1", "13", "531"]);
  expect(completeCalls).toBe(1);
});

test("shows format errors without stripping or blocking incomplete matching input", async ({ page }) => {
  const saved: string[] = [];
  await page.route(`**/api/attempts/${id}/answers`, async (route) => {
    saved.push((route.request().postDataJSON() as { selectedAnswer: string }).selectedAnswer);
    await route.fulfill({ json: { success: true, data: { saved: true } } });
  });
  await activeAttempt(page);
  const input = page.getByRole("textbox").nth(1);
  await input.fill("А2Б");
  await input.blur();
  await expect(input).toHaveValue("А2Б");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("А2Б3В1Г4");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect.poll(() => saved.at(-1)).toBe("А2Б3В1Г4");
  await input.fill("А2А2Б3В1Г4");
  await expect(input).toHaveValue("А2А2Б3В1Г4");
  await expect(input).toHaveAttribute("aria-invalid", "true");
});

test("does not complete after failed save and allows a safe retry", async ({ page }) => {
  let failSave = true;
  let completeCalls = 0;
  await page.route(`**/api/attempts/${id}/answers`, (route) => route.fulfill(failSave
    ? { status: 503, json: { success: false, error: { code: "SAVE_FAILED", message: "Не удалось сохранить" } } }
    : { json: { success: true, data: { saved: true } } }));
  await page.route(`**/api/attempts/${id}/complete`, (route) => {
    completeCalls += 1;
    return route.fulfill({ json: { success: true, data: { resultUrl: `/results/${id}` } } });
  });
  await activeAttempt(page);
  const input = page.getByRole("textbox").first();
  await input.fill("13");
  await expect(page.getByText("Не удалось сохранить", { exact: true })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Завершить тест", exact: true }).click();
  await expect(input).toBeEnabled();
  expect(completeCalls).toBe(0);
  failSave = false;
  await page.getByRole("button", { name: "Завершить тест", exact: true }).click();
  await expect(page).toHaveURL(`/results/${id}`);
  expect(completeCalls).toBe(1);
});

test("finishes once on the timer after queued saves settle", async ({ page }) => {
  await page.clock.install();
  let expireCalls = 0;
  await page.route(`**/api/attempts/${id}/expire`, (route) => {
    expireCalls += 1;
    return route.fulfill({ json: { success: true, data: { resultUrl: `/results/${id}` } } });
  });
  await activeAttempt(page, 2);
  await page.clock.runFor(3000);
  await expect(page).toHaveURL(`/results/${id}`);
  expect(expireCalls).toBe(1);
});

test("does not expire a fractional second early and retries a transient expiry failure", async ({ page }) => {
  await page.clock.install();
  let expireCalls = 0;
  await page.route(`**/api/attempts/${id}/expire`, (route) => {
    expireCalls += 1;
    return route.fulfill(expireCalls === 1
      ? { status: 503, json: { success: false, error: { code: "TEMPORARY", message: "Временная ошибка завершения" } } }
      : { json: { success: true, data: { resultUrl: `/results/${id}` } } });
  });
  await activeAttempt(page, 0.6);
  await page.clock.runFor(500);
  expect(expireCalls).toBe(0);
  await page.clock.runFor(600);
  await expect(page.getByText("Временная ошибка завершения", { exact: true })).toBeVisible();
  await page.clock.runFor(1500);
  await expect(page).toHaveURL(`/results/${id}`);
  expect(expireCalls).toBe(2);
});
