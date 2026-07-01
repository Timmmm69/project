import { describe, expect, it } from "vitest";
import { adminQuestionInputSchema } from "@/lib/questions/question-schemas";
import {
  normalizeMultipleChoiceAnswer,
  normalizeShortTextAnswer
} from "@/lib/questions/normalization";

describe("question validation", () => {
  it("normalizes multiple choice answers", () => {
    expect(normalizeMultipleChoiceAnswer(" c, A, c ")).toBe("A,C");
  });

  it("normalizes short text variants", () => {
    expect(normalizeShortTextAnswer(" Пришёл ;  пришел  ")).toBe("пришёл;пришел");
  });

  it("accepts a valid single choice question", () => {
    const parsed = adminQuestionInputSchema.safeParse({
      questionText: "Укажите правильный вариант",
      questionType: "single_choice",
      optionA: "А",
      optionB: "Б",
      correctAnswer: " a ",
      topic: "Орфография",
      points: 1
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.correctAnswer).toBe("A");
    }
  });

  it("rejects multiple choice with partial invalid option letters", () => {
    const parsed = adminQuestionInputSchema.safeParse({
      questionText: "Выберите варианты",
      questionType: "multiple_choice",
      optionA: "А",
      optionB: "Б",
      correctAnswer: "A,D",
      topic: "Пунктуация",
      points: 2
    });

    expect(parsed.success).toBe(false);
  });

  it("clears options for short text questions", () => {
    const parsed = adminQuestionInputSchema.safeParse({
      questionText: "Введите слово",
      questionType: "short_text",
      optionA: "не нужно",
      correctAnswer: " Пришёл ; пришел ",
      topic: "Грамматика",
      points: 1
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.correctAnswer).toBe("пришёл;пришел");
      expect(parsed.data.optionA).toBeNull();
    }
  });
});
