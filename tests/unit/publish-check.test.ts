import { describe, expect, it } from "vitest";
import { runPublishCheck } from "@/lib/tests/publish-check";

const validQuestion = {
  questionText: "Укажите правильный вариант",
  questionType: "SINGLE_CHOICE",
  correctAnswer: "A",
  topic: "Орфография",
  subtopic: "О/А",
  points: 1,
  optionA: "вариант А",
  optionB: "вариант Б",
  explanation: "Пояснение",
  deletedAt: null
};

describe("runPublishCheck", () => {
  it("allows a valid training test", () => {
    const result = runPublishCheck({
      title: "Русский язык",
      price: 1500,
      durationMinutes: 60,
      accessDays: 7,
      questionsCount: 1,
      maxRawScore: 1,
      mode: "TRAINING",
      showScaledScore: false,
      questions: [validQuestion]
    });

    expect(result.canPublish).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("blocks a test without questions", () => {
    const result = runPublishCheck({
      title: "Русский язык",
      price: 1500,
      durationMinutes: 60,
      accessDays: 7,
      questionsCount: 0,
      maxRawScore: 0,
      mode: "TRAINING",
      showScaledScore: false,
      questions: []
    });

    expect(result.canPublish).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("NO_QUESTIONS");
  });

  it("blocks scaled score without a scoring scheme", () => {
    const result = runPublishCheck({
      title: "Русский язык",
      price: 1500,
      durationMinutes: 60,
      accessDays: 7,
      questionsCount: 1,
      maxRawScore: 1,
      mode: "CE_CT",
      showScaledScore: true,
      scoringSchemeId: null,
      questions: [validQuestion]
    });

    expect(result.canPublish).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("SCORING_SCHEME_REQUIRED");
  });
});
