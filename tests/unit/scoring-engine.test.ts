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
      explanation: "Use full match"
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
    expect(result.level).toBe("высокий");
    expect(result.recommendations[0]?.message).toContain("Ошибок нет");
  });

  it("does not award partial points for multiple choice", () => {
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
    expect(multipleAnswer?.pointsEarned).toBe(0);
    expect(result.rawScore).toBe(2);
  });

  it("treats missing answers as mistakes", () => {
    const result = scoreAttemptSnapshot(baseSnapshot, [], null);

    expect(result.rawScore).toBe(0);
    expect(result.answers).toHaveLength(3);
    expect(result.answers.every((answer) => !answer.isCorrect)).toBe(true);
    expect(result.topicResults.every((topic) => topic.status === "weak")).toBe(true);
  });

  it("maps scaled score from scoring scheme snapshot for CE/CT mode", () => {
    const ceCtSnapshot: TestSnapshot = {
      ...baseSnapshot,
      mode: "ce_ct"
    };
    const scoringScheme: ScoringSchemeSnapshot = {
      scoringSchemeId: "scheme-1",
      name: "Training scale",
      subject: "russian",
      examType: "ct",
      year: 2026,
      maxRawScore: 4,
      maxScaledScore: 100,
      scale: [
        { rawScore: 0, scaledScore: 0 },
        { rawScore: 2, scaledScore: 51 },
        { rawScore: 4, scaledScore: 100 }
      ]
    };

    const result = scoreAttemptSnapshot(
      ceCtSnapshot,
      [
        { snapshotQuestionId: "q_1", selectedAnswer: "B" },
        { snapshotQuestionId: "q_2", selectedAnswer: "A" },
        { snapshotQuestionId: "q_3", selectedAnswer: "молоко" }
      ],
      scoringScheme
    );

    expect(result.rawScore).toBe(2);
    expect(result.scaledScore).toBe(51);
    expect(result.maxScaledScore).toBe(100);
  });
});
