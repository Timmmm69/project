import type { MvpQuestionType } from "@/lib/questions/enums";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

export type OptionLetter = (typeof OPTION_LETTERS)[number];

export function normalizeSingleChoiceAnswer(answer: string) {
  return answer.trim().toUpperCase();
}

export function normalizeMultipleChoiceAnswer(answer: string) {
  return Array.from(
    new Set(
      answer
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  )
    .sort((left, right) => OPTION_LETTERS.indexOf(left as OptionLetter) - OPTION_LETTERS.indexOf(right as OptionLetter))
    .join(",");
}

export function normalizeShortTextAnswer(answer: string) {
  return Array.from(
    new Set(
      answer
        .split(";")
        .map((item) => item.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean)
    )
  ).join(";");
}

export function normalizeCorrectAnswer(type: MvpQuestionType, answer: string) {
  if (type === "single_choice") {
    return normalizeSingleChoiceAnswer(answer);
  }
  if (type === "multiple_choice") {
    return normalizeMultipleChoiceAnswer(answer);
  }
  return normalizeShortTextAnswer(answer);
}

export function isOptionLetter(value: string): value is OptionLetter {
  return OPTION_LETTERS.includes(value as OptionLetter);
}

export function parseMultipleChoiceLetters(answer: string) {
  return normalizeMultipleChoiceAnswer(answer)
    .split(",")
    .filter(Boolean);
}
