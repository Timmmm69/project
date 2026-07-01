export const IMPORT_TEMPLATE_COLUMNS = [
  "question_text",
  "question_type",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_answer",
  "topic",
  "subtopic",
  "difficulty",
  "points",
  "source",
  "explanation"
] as const;

export type ImportTemplateColumn = (typeof IMPORT_TEMPLATE_COLUMNS)[number];

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export function buildCsvTemplate() {
  return `${IMPORT_TEMPLATE_COLUMNS.join(",")}\n`;
}
