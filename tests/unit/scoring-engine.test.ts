import { describe, expect, it } from "vitest";
import type { ScoringSchemeSnapshot, TestSnapshot } from "@/lib/attempts/snapshot";
import { scoreAttemptSnapshot } from "@/lib/scoring/scoring-engine";

const baseSnapshot: TestSnapshot = {
  testId: "test-1",
  title: "Demo",
  subject: "russian",
  mode: "training",
  durationMinutes: 60,
  maxRawScore: 4,
  questions: [
    {
      snapshotQuestionId: "q_1",
      originalQuestionId: "question-1",
      orderIndex: 1,
      questionText: "Single",
      questionType: "single_choice",
      options: { A: "One", B: "Two" },
      correctAnswer: "B",
      topic: "Орфография",
      subtopic: "Н/НН",
      points: 1,
      scoringRule: "full_match",
      explanation: null
    },
    {
      snapshotQuestionId: "q_2",
      originalQuestionId: "question-2",
      orderIndex: 2,
      questionText: "Multiple",
      questionType: "multiple_choice",
      options: { A: "One", B: "Two", C: "Three" },
      correctAnswer: "A,C",
      topic: "Пунктуация",
      subtopic: "Запятая",
      points: 2,
      scoringRule: "full_match",
      explanation: "Use partial match"
    },
    {
      snapshotQuestionId: "q_3",
      originalQuestionId: "question-3",
      orderIndex: 3,
      questionText: "Text",
      questionType: "short_text",
      options: {},
      correctAnswer: "молоко;млеко",
      topic: "Лексика",
      subtopic: null,
      points: 1,
      scoringRule: "exact_text",
      explanation: null
    }
  ]
};

const rikz2026Scale: ScoringSchemeSnapshot = {
  scoringSchemeId: "scheme-1",
  name: "РИКЗ 2026 русский язык ЦЭ/ЦТ",
  subject: "russian",
  examType: "ce_ct",
  year: 2026,
  maxRawScore: 80,
  maxScaledScore: 100,
  scale: [
    { rawScore: 0, scaledScore: 0 },
    { rawScore: 40, scaledScore: 52 },
    { rawScore: 80, scaledScore: 100 }
  ]
};

describe("scoreAttemptSnapshot", () => {
  it("scores exact matches and short text alternatives", () => {
    const result = scoreAttemptSnapshot(
      baseSnapshot,
      [
        { snapshotQuestionId: "q_1", selectedAnswer: " b " },
        { snapshotQuestionId: "q_2", selectedAnswer: "C,A" },
        { snapshotQuestionId: "q_3", selectedAnswer: " МЛЕКО " }
      ],
      null
    );

    expect(result.rawScore).toBe(4);
    expect(result.maxRawScore).toBe(4);
    expect(result.percent).toBe(100);
    expect(result.answers.every((answer) => answer.isCorrect)).toBe(true);
  });

  it("awards one partial point for one multiple choice error", () => {
    const result = scoreAttemptSnapshot(
      baseSnapshot,
      [
        { snapshotQuestionId: "q_1", selectedAnswer: "B" },
        { snapshotQuestionId: "q_2", selectedAnswer: "A" },
        { snapshotQuestionId: "q_3", selectedAnswer: "молоко" }
      ],
      null
    );

    const multipleAnswer = result.answers.find((answer) => answer.snapshotQuestionId === "q_2");
    expect(multipleAnswer?.isCorrect).toBe(false);
    expect(multipleAnswer?.pointsEarned).toBe(1);
    expect(result.rawScore).toBe(3);
  });

  it("awards zero multiple choice points for two or more errors", () => {
    const result = scoreAttemptSnapshot(
      baseSnapshot,
      [
        { snapshotQuestionId: "q_1", selectedAnswer: "B" },
        { snapshotQuestionId: "q_2", selectedAnswer: "B" },
        { snapshotQuestionId: "q_3", selectedAnswer: "молоко" }
      ],
      null
    );

    const multipleAnswer = result.answers.find((answer) => answer.snapshotQuestionId === "q_2");
    expect(multipleAnswer?.isCorrect).toBe(false);
    expect(multipleAnswer?.pointsEarned).toBe(0);
    expect(result.rawScore).toBe(2);
  });

  it("does not award partial points for short text", () => {
    const result = scoreAttemptSnapshot(
      baseSnapshot,
      [
        { snapshotQuestionId: "q_1", selectedAnswer: "B" },
        { snapshotQuestionId: "q_2", selectedAnswer: "A,C" },
        { snapshotQuestionId: "q_3", selectedAnswer: "мол" }
      ],
      null
    );

    const shortTextAnswer = result.answers.find((answer) => answer.snapshotQuestionId === "q_3");
    expect(shortTextAnswer?.isCorrect).toBe(false);
    expect(shortTextAnswer?.pointsEarned).toBe(0);
    expect(result.rawScore).toBe(3);
  });

  it("treats missing answers as mistakes", () => {
    const result = scoreAttemptSnapshot(baseSnapshot, [], null);

    expect(result.rawScore).toBe(0);
    expect(result.answers).toHaveLength(3);
    expect(result.answers.every((answer) => !answer.isCorrect)).toBe(true);
    expect(result.topicResults.every((topic) => topic.status === "weak")).toBe(true);
  });

  it("does not map scaled score for incomplete CE/CT tests", () => {
    const result = scoreAttemptSnapshot(
      { ...baseSnapshot, mode: "ce_ct" },
      [
        { snapshotQuestionId: "q_1", selectedAnswer: "B" },
        { snapshotQuestionId: "q_2", selectedAnswer: "A" },
        { snapshotQuestionId: "q_3", selectedAnswer: "молоко" }
      ],
      rikz2026Scale
    );

    expect(result.rawScore).toBe(3);
    expect(result.maxRawScore).toBe(4);
    expect(result.scaledScore).toBeNull();
    expect(result.maxScaledScore).toBeNull();
  });

  it("maps scaled score only for a full Russian CE/CT 2026 scale", () => {
    const fullSnapshot: TestSnapshot = {
      ...baseSnapshot,
      mode: "ce_ct",
      maxRawScore: 80,
      questions: [
        {
          ...baseSnapshot.questions[0],
          points: 80
        }
      ]
    };

    const result = scoreAttemptSnapshot(
      fullSnapshot,
      [{ snapshotQuestionId: "q_1", selectedAnswer: "B" }],
      rikz2026Scale
    );

    expect(result.rawScore).toBe(80);
    expect(result.scaledScore).toBe(100);
    expect(result.maxScaledScore).toBe(100);
  });
});
