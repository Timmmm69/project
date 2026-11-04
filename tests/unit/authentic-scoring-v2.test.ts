import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { buildTestSnapshot, type SnapshotQuestion, type TestSnapshot } from "@/lib/attempts/snapshot";
import { scoreAttemptSnapshot } from "@/lib/scoring/scoring-engine";
import { parseCsvImport } from "@/lib/imports/parse";
import { validateImportRows } from "@/lib/imports/validation";
import { toPrismaQuestionType } from "@/lib/questions/enums";

const question: SnapshotQuestion = {
  snapshotQuestionId: "q_1", originalQuestionId: "q1", orderIndex: 1,
  questionText: "B1", questionType: "short_answer_token", options: {},
  correctAnswer: "135", acceptedAnswers: ["135"], points: 2,
  topic: "Test", subtopic: null, explanation: null, scoringRule: "exact_text",
  officialPart: "B", officialNumber: 1, responseSubtype: "digits",
  partialPolicy: "set_partial", normalizationPolicy: { version: 1, kind: "set", alphabet: "12345" }
};
function snapshot(overrides: Partial<SnapshotQuestion> = {}): TestSnapshot {
  return {
    testId: "t", title: "Test", subject: "russian", mode: "ce_ct", examMode: "rikz_russian_2026",
    durationMinutes: 120, maxRawScore: 2, scoringVersion: 2,
    questions: [{ ...question, ...overrides }]
  };
}
function score(answer: string | null, overrides: Partial<SnapshotQuestion> = {}) {
  return scoreAttemptSnapshot(snapshot(overrides), [{ snapshotQuestionId: "q_1", selectedAnswer: answer }], null).answers[0];
}
function realImportedSnapshot() {
  const buffer = readFileSync(resolve(process.cwd(), "content/rikz_russian_2026/variant-01/questions.import.csv"));
  const parsed = parseCsvImport(buffer);
  const validated = validateImportRows({ ...parsed, parseErrors: parsed.errors, examMode: "rikz_russian_2026" });
  expect(validated.errors).toEqual([]);
  expect(validated.preview).toHaveLength(40);
  return buildTestSnapshot({
    id: "real-content", title: "Actual authored training variant", mode: "CE_CT", examMode: "RIKZ_RUSSIAN_2026",
    durationMinutes: 120, maxRawScore: 80,
    questions: validated.preview.map((item, index) => ({
      ...item,
      id: `${item.officialPart}${item.officialNumber}`,
      orderIndex: index + 1,
      questionType: toPrismaQuestionType(item.questionType),
      responseSubtype: item.responseSubtype === "word" ? "WORD" : item.responseSubtype === "digits" ? "DIGITS" : item.responseSubtype === "alnum" ? "ALNUM" : null,
      normalizationPolicy: item.normalizationPolicy as Prisma.JsonValue
    }))
  });
}

describe("versioned authentic scoring", () => {
  it("awards a partial B set point", () => expect(score("13").pointsEarned).toBe(1));
  it("compares matching values per position", () => expect(score("А2Б3В1Г5", {
    correctAnswer: "А2Б3В1Г4", acceptedAnswers: ["А2Б3В1Г4"], partialPolicy: "matching_partial",
    normalizationPolicy: { version: 1, kind: "matching", positions: "АБВГ", values: "12345" }
  }).pointsEarned).toBe(1));
  it("does not clean duplicate A choices into a correct answer", () => expect(score("A,A,C", {
    questionType: "multi_select_five", officialPart: "A", correctAnswer: "A,C", acceptedAnswers: null,
    normalizationPolicy: { version: 1, kind: "set", alphabet: "ABCDE" }
  }).pointsEarned).toBe(0));

  it("preserves original invalid input in scoring output instead of overwriting it with a valid normalized set", () => {
    const result = score("A,A,C", {
      questionType: "multi_select_five", officialPart: "A", correctAnswer: "A,C", acceptedAnswers: null,
      normalizationPolicy: { version: 1, kind: "set", alphabet: "ABCDE" }
    });
    expect(result.selectedAnswer).toBe("A,A,C");
    expect(result.pointsEarned).toBe(0);
  });

  it("does not reinterpret an old authentic snapshot's Part B after policy fields change", () => {
    const oldSnapshot = snapshot();
    delete oldSnapshot.scoringVersion;
    const before = JSON.stringify(oldSnapshot);
    expect(scoreAttemptSnapshot(oldSnapshot, [{ snapshotQuestionId: "q_1", selectedAnswer: "13" }], null).rawScore).toBe(0);
    expect(scoreAttemptSnapshot(oldSnapshot, [{ snapshotQuestionId: "q_1", selectedAnswer: "135" }], null).rawScore).toBe(2);
    expect(JSON.stringify(oldSnapshot)).toBe(before);
  });

  it("keeps old Part A snapshot normalization unchanged and isolates the corrected v2 path", () => {
    const oldSnapshot = snapshot({ questionType: "multi_select_five", officialPart: "A", correctAnswer: "A,C", acceptedAnswers: null });
    delete oldSnapshot.scoringVersion;
    expect(scoreAttemptSnapshot(oldSnapshot, [{ snapshotQuestionId: "q_1", selectedAnswer: "A,A,C" }], null).rawScore).toBe(2);
    expect(score("A,A,C", { questionType: "multi_select_five", officialPart: "A", correctAnswer: "A,C", acceptedAnswers: null, normalizationPolicy: { version: 1, kind: "set", alphabet: "ABCDE" } }).pointsEarned).toBe(0);
  });

  it("leaves generic multiple choice partial scoring intact even if a v2 marker is present", () => {
    const generic: TestSnapshot = { ...snapshot({ questionType: "multiple_choice", correctAnswer: "A,C", acceptedAnswers: null }), examMode: "generic", mode: "training" };
    expect(scoreAttemptSnapshot(generic, [{ snapshotQuestionId: "q_1", selectedAnswer: "A" }], null).rawScore).toBe(1);
    expect(scoreAttemptSnapshot(generic, [{ snapshotQuestionId: "q_1", selectedAnswer: "C,A" }], null).rawScore).toBe(2);
  });

  it("scores omitted, empty, invalid and valid-wrong answers as concrete zeroes", () => {
    for (const answer of [null, "", " ", "1135", "0", "24"]) expect(score(answer).pointsEarned).toBe(0);
    expect(scoreAttemptSnapshot(snapshot(), [], null).rawScore).toBe(0);
  });

  it("captures all 40 real imported policies and awards exactly 80 for their keys", () => {
    const imported = realImportedSnapshot();
    expect(imported.scoringVersion).toBe(2);
    expect(imported.questions.filter((item) => item.officialPart === "A")).toHaveLength(18);
    const partB = imported.questions.filter((item) => item.officialPart === "B");
    expect(partB.filter((item) => item.partialPolicy === "set_partial")).toHaveLength(5);
    expect(partB.filter((item) => item.partialPolicy === "matching_partial")).toHaveLength(4);
    expect(partB.filter((item) => item.partialPolicy === "exact_match")).toHaveLength(13);
    expect(partB.find((item) => item.officialNumber === 14)).toMatchObject({ partialPolicy: "exact_match", responseSubtype: "word", correctAnswer: "лексикология" });
    const result = scoreAttemptSnapshot(imported, imported.questions.map((item) => ({ snapshotQuestionId: item.snapshotQuestionId, selectedAnswer: item.correctAnswer })), null);
    expect(result.answers.map((answer) => answer.pointsEarned)).toEqual(Array(40).fill(2));
    expect(result.rawScore).toBe(80);
    expect(result.maxRawScore).toBe(80);
    expect(result.percent).toBe(100);
  });

  it("awards exactly one point in all 18 A and all 9 partial B tasks through the imported snapshot", () => {
    const imported = realImportedSnapshot();
    const answers = imported.questions.map((item) => {
      let selectedAnswer = item.correctAnswer;
      if (item.partialPolicy === "set_partial") selectedAnswer = item.correctAnswer.replaceAll(",", "").slice(1);
      if (item.partialPolicy === "matching_partial") {
        const last = item.correctAnswer.at(-1);
        selectedAnswer = item.correctAnswer.slice(0, -1) + (last === "5" ? "4" : "5");
      }
      return { snapshotQuestionId: item.snapshotQuestionId, selectedAnswer };
    });
    const result = scoreAttemptSnapshot(imported, answers, null);
    expect(result.answers.filter((item) => item.question.officialPart === "A").map((item) => item.pointsEarned)).toEqual(Array(18).fill(1));
    expect(result.answers.filter((item) => item.question.officialPart === "B" && item.question.partialPolicy !== "exact_match").map((item) => item.pointsEarned)).toEqual(Array(9).fill(1));
    expect(result.answers.filter((item) => item.question.officialPart === "B" && item.question.partialPolicy === "exact_match").map((item) => item.pointsEarned)).toEqual(Array(13).fill(2));
    expect(result.rawScore).toBe(53);
  });

  it("gives no partial credit to any of the 13 exact B tasks", () => {
    const imported = realImportedSnapshot();
    const answers = imported.questions.map((item) => ({ snapshotQuestionId: item.snapshotQuestionId, selectedAnswer: item.partialPolicy === "exact_match" ? item.correctAnswer.slice(0, -1) : item.correctAnswer }));
    const result = scoreAttemptSnapshot(imported, answers, null);
    expect(result.answers.filter((item) => item.question.partialPolicy === "exact_match").map((item) => item.pointsEarned)).toEqual(Array(13).fill(0));
    expect(result.rawScore).toBe(54);
  });

  it("uses the snapshotted lookup scale, preserving supplied values rather than calculating percentages", () => {
    const imported = realImportedSnapshot();
    const scale = { scoringSchemeId: "immutable-lookup", name: "Fixture with non-linear values", subject: "russian" as const, examType: "ce_ct", year: 2026, maxRawScore: 80, maxScaledScore: 100, scale: [{ rawScore: 0, scaledScore: 0 }, { rawScore: 2, scaledScore: 2 }, { rawScore: 80, scaledScore: 100 }] };
    const firstQuestion = imported.questions[0];
    const result = scoreAttemptSnapshot(imported, [{ snapshotQuestionId: firstQuestion.snapshotQuestionId, selectedAnswer: firstQuestion.correctAnswer }], scale);
    expect(result.rawScore).toBe(2);
    expect(result.percent).toBe(2.5);
    expect(result.scaledScore).toBe(2);
    expect(result.maxScaledScore).toBe(100);
    expect(scale.scale).toEqual([{ rawScore: 0, scaledScore: 0 }, { rawScore: 2, scaledScore: 2 }, { rawScore: 80, scaledScore: 100 }]);
  });
});
