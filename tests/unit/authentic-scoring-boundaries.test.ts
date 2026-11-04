import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsvImport } from "@/lib/imports/parse";
import { validateImportRows } from "@/lib/imports/validation";
import { toPrismaQuestionType } from "@/lib/questions/enums";
import { parseTestSnapshot, serializeQuestionForStudent, type SnapshotQuestion } from "@/lib/attempts/snapshot";
import { validateAnswerConfiguration, type PolicyQuestion } from "@/lib/scoring/answer-policy";
import { scoreAttemptSnapshot } from "@/lib/scoring/scoring-engine";
import { runPublishCheck, type PublishCheckInput } from "@/lib/tests/publish-check";

const numeric: PolicyQuestion = {
  officialPart: "B", officialNumber: 1, responseSubtype: "DIGITS", points: 2,
  correctAnswer: "135", acceptedAnswers: ["135"], partialPolicy: "set_partial",
  normalizationPolicy: { version: 1, kind: "set", alphabet: "12345" }
};
function parsedContent() {
  return parseCsvImport(readFileSync("content/rikz_russian_2026/variant-01/questions.import.csv"));
}
function publication(): PublishCheckInput {
  const parsed = parsedContent();
  const validation = validateImportRows({ ...parsed, examMode: "rikz_russian_2026" });
  expect(validation.errors).toEqual([]);
  return {
    title: "Real content", price: 0, durationMinutes: 120, accessDays: 7, maxRawScore: 80,
    mode: "CE_CT", examMode: "RIKZ_RUSSIAN_2026", scoringSchemeId: "scheme",
    questions: validation.preview.map((question) => ({ ...question,
      questionType: toPrismaQuestionType(question.questionType), responseSubtype: question.responseSubtype?.toUpperCase() ?? null
    }))
  };
}

describe("authentic publication and input boundaries", () => {
  it.each([
    { ...numeric, correctAnswer: "AC", acceptedAnswers: ["AC"], normalizationPolicy: { version: 1, kind: "set", alphabet: "ABCDE" } },
    { ...numeric, officialNumber: 2, responseSubtype: "WORD", partialPolicy: "exact_match", normalizationPolicy: { version: 1, kind: "exact", subtype: "digits" } },
    { ...numeric, officialNumber: 19, responseSubtype: "WORD", partialPolicy: "exact_match", correctAnswer: "слово", acceptedAnswers: ["слово"], normalizationPolicy: { version: 1, kind: "exact", subtype: "word" } },
    { ...numeric, officialPart: "A", responseSubtype: null, correctAnswer: "AC", acceptedAnswers: ["AC"], normalizationPolicy: { version: 1, kind: "set", alphabet: "AC" } }
  ])("rejects contradictory task metadata", (question) => {
    expect(validateAnswerConfiguration(question).length).toBeGreaterThan(0);
  });
  it("accepts explicit numeric domains beyond five without inferring them from keys", () => {
    expect(validateAnswerConfiguration({ ...numeric, normalizationPolicy: { version: 1, kind: "set", alphabet: "123456789" } })).toEqual([]);
  });
  it("rejects malformed A keys before lossy legacy normalization", () => {
    const parsed = parsedContent();
    parsed.rows[0].values.correct_answer = "A,A,C";
    const result = validateImportRows({ ...parsed, examMode: "rikz_russian_2026" });
    expect(result.errors.map((error) => error.code)).toContain("AUTHENTIC_SCORING_CONFIGURATION");
  });
  it("imports explicit alternative A keys through accepted_answers", () => {
    const parsed = parsedContent();
    parsed.rows[0].values.accepted_answers = '["A,C","B,D"]';
    const result = validateImportRows({ ...parsed, examMode: "rikz_russian_2026" });
    expect(result.errors).toEqual([]);
    expect(result.preview[0].acceptedAnswers).toEqual(["A,C", "B,D"]);
  });
  it("rejects a digit task reconfigured to score letters through the real importer", () => {
    const parsed = parsedContent();
    const b1 = parsed.rows[18];
    b1.values.correct_answer = "AC";
    b1.values.accepted_answers = '["AC"]';
    b1.values.normalization_policy = '{"version":1,"kind":"set","alphabet":"ABCDE"}';
    const result = validateImportRows({ ...parsed, examMode: "rikz_russian_2026" });
    expect(result.errors.some((error) => error.rowNumber === b1.rowNumber && error.code === "AUTHENTIC_SCORING_CONFIGURATION")).toBe(true);
  });
  it("validates every question maximum even if compensating values sum to eighty", () => {
    const paper = publication();
    paper.questions![18].points = 1;
    paper.questions![19].points = 3;
    expect(runPublishCheck(paper).errors.map((error) => error.code)).toContain("RIKZ_RUSSIAN_QUESTION_POINTS_INVALID");
  });
  it("rejects unknown strategies, malformed alternatives and mismatched exact policies at publication", () => {
    for (const change of [
      { partialPolicy: "mystery" },
      { acceptedAnswers: ["35", "335"] },
      { acceptedAnswers: { key: "35" } },
      { normalizationPolicy: { version: 1, kind: "exact", subtype: "digits" } }
    ]) {
      const paper = publication();
      Object.assign(paper.questions![18], change);
      expect(runPublishCheck(paper).errors.map((error) => error.code)).toContain("RIKZ_RUSSIAN_SCORING_CONFIGURATION_INVALID");
    }
  });
  it("makes the authored B14 variation visible as a publication warning", () => {
    const result = runPublishCheck(publication());
    expect(result.canPublish).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("RIKZ_RUSSIAN_B14_AUTHORED_VARIATION");
  });
});

describe("student snapshot projection", () => {
  const question: SnapshotQuestion = {
    snapshotQuestionId: "q_1", originalQuestionId: "1", orderIndex: 1, questionType: "short_answer_token",
    questionText: "Установите соответствие.\nЗапишите ответ без пробелов в формате А2Б3В1Г4.",
    correctAnswer: "а2б3в1г4", acceptedAnswers: ["А2Б3В1Г4"], options: {},
    officialPart: "B", officialNumber: 19, responseSubtype: "alnum", topic: "Matching", subtopic: null,
    points: 2, scoringRule: "exact_text", explanation: "Private explanation"
  };
  it("redacts the known answer-bearing legacy example without mutating stored snapshot or grading", () => {
    const original = JSON.stringify(question);
    const projected = serializeQuestionForStudent(question);
    expect(projected.questionText).not.toContain("А2Б3В1Г4");
    expect(projected.questionText).toContain("в порядке А, Б, В, Г");
    expect(projected).not.toHaveProperty("acceptedAnswers");
    expect(projected).not.toHaveProperty("correctAnswer");
    expect(JSON.stringify(question)).toBe(original);
  });
  it("does not rewrite unrelated or generic wording", () => {
    const generic = { ...question, officialPart: null, questionText: "Сохраните исходный текст." };
    expect(serializeQuestionForStudent(generic).questionText).toBe(generic.questionText);
  });
  it("rejects an unsupported future scoring version rather than guessing legacy rules", () => {
    const snapshot = parseTestSnapshot(JSON.parse(JSON.stringify({
      testId: "t", title: "t", subject: "russian", mode: "ce_ct", examMode: "rikz_russian_2026",
      scoringVersion: 3, durationMinutes: 120, maxRawScore: 2, questions: [question]
    })));
    expect(() => scoreAttemptSnapshot(snapshot, [], null)).toThrow("UNSUPPORTED_SCORING_VERSION");
  });
});
