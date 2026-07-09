export const MVP_DEFAULTS = {
  subject: "russian",
  currency: "BYN",
  accessDays: 7,
  attemptsLimit: 1
} as const;

export const QUESTION_TYPES = [
  "single_choice",
  "multiple_choice",
  "short_text",
  "multi_select_five",
  "short_answer_token"
] as const;

export const TEST_MODES = ["training", "ce_ct"] as const;

export const EXAM_MODES = ["generic", "rikz_russian_2026"] as const;

export const TEST_STATUSES = ["draft", "published", "hidden", "archived"] as const;
