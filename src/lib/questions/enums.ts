import type { Difficulty, QuestionType, ScoringRule } from "@prisma/client";

export type MvpQuestionType =
  | "single_choice"
  | "multiple_choice"
  | "short_text"
  | "multi_select_five"
  | "short_answer_token";
export type MvpDifficulty = "easy" | "medium" | "hard";

export function toPrismaQuestionType(type: MvpQuestionType): QuestionType {
  const values = {
    single_choice: "SINGLE_CHOICE",
    multiple_choice: "MULTIPLE_CHOICE",
    short_text: "SHORT_TEXT",
    multi_select_five: "MULTI_SELECT_FIVE",
    short_answer_token: "SHORT_ANSWER_TOKEN"
  } as const;
  return values[type];
}

export function fromPrismaQuestionType(type: QuestionType): MvpQuestionType {
  const values = {
    SINGLE_CHOICE: "single_choice",
    MULTIPLE_CHOICE: "multiple_choice",
    SHORT_TEXT: "short_text",
    MULTI_SELECT_FIVE: "multi_select_five",
    SHORT_ANSWER_TOKEN: "short_answer_token"
  } as const;
  return values[type];
}

export function toPrismaDifficulty(difficulty: MvpDifficulty): Difficulty {
  const values = {
    easy: "EASY",
    medium: "MEDIUM",
    hard: "HARD"
  } as const;
  return values[difficulty];
}

export function fromPrismaDifficulty(difficulty: Difficulty | null): MvpDifficulty | null {
  if (!difficulty) {
    return null;
  }

  const values = {
    EASY: "easy",
    MEDIUM: "medium",
    HARD: "hard"
  } as const;
  return values[difficulty];
}

export function scoringRuleForQuestionType(type: MvpQuestionType): ScoringRule {
  return type === "short_text" || type === "short_answer_token" ? "EXACT_TEXT" : "FULL_MATCH";
}
