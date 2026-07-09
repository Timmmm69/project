import type { MvpQuestionType } from "@/lib/questions/enums";

const AUTHENTIC_OPTION_LETTERS = ["A", "B", "C", "D", "E"] as const;

export type AuthenticOptionLetter = (typeof AUTHENTIC_OPTION_LETTERS)[number];

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
    .sort(
      (left, right) =>
        AUTHENTIC_OPTION_LETTERS.indexOf(left as AuthenticOptionLetter) -
        AUTHENTIC_OPTION_LETTERS.indexOf(right as AuthenticOptionLetter)
    )
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

export function normalizeShortAnswerTokenAnswer(answer: string) {
  return answer.trim().normalize("NFC").toLocaleLowerCase("ru");
}

export function normalizeCorrectAnswer(type: MvpQuestionType, answer: string) {
  if (type === "single_choice") {
    return normalizeSingleChoiceAnswer(answer);
  }
  if (type === "multiple_choice" || type === "multi_select_five") {
    return normalizeMultipleChoiceAnswer(answer);
  }
  if (type === "short_answer_token") {
    return normalizeShortAnswerTokenAnswer(answer);
  }
  return normalizeShortTextAnswer(answer);
}

export function isOptionLetter(value: string): value is AuthenticOptionLetter {
  return AUTHENTIC_OPTION_LETTERS.includes(value as AuthenticOptionLetter);
}

export function parseMultipleChoiceLetters(answer: string) {
  return normalizeMultipleChoiceAnswer(answer)
    .split(",")
    .filter(Boolean);
}
