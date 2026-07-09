export const GENERIC_IMPORT_TEMPLATE_COLUMNS = [
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

export const AUTHENTIC_IMPORT_TEMPLATE_COLUMNS = [
  "exam_mode",
  "official_part",
  "official_number",
  "question_text",
  "question_type",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "correct_answer",
  "accepted_answers",
  "response_subtype",
  "topic",
  "subtopic",
  "difficulty",
  "points",
  "source",
  "explanation"
] as const;

export const IMPORT_TEMPLATE_COLUMNS = GENERIC_IMPORT_TEMPLATE_COLUMNS;

export type ImportTemplateColumn = (typeof AUTHENTIC_IMPORT_TEMPLATE_COLUMNS)[number];
export type ImportTemplateMode = "generic" | "rikz_russian_2026";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const AUTHENTIC_IMPORT_EXAMPLE_ROWS = Array.from({ length: 40 }, (_, index) => {
  const number = index + 1;
  if (number <= 18) {
    return {
      exam_mode: "rikz_russian_2026",
      official_part: "A",
      official_number: String(number),
      question_text: `Placeholder Part A question ${number}`,
      question_type: "multi_select_five",
      option_a: "Option A",
      option_b: "Option B",
      option_c: "Option C",
      option_d: "Option D",
      option_e: "Option E",
      correct_answer: "A,C",
      accepted_answers: "",
      response_subtype: "",
      topic: "Placeholder topic",
      subtopic: "",
      difficulty: "medium",
      points: "2",
      source: "Original placeholder content",
      explanation: "Placeholder explanation"
    };
  }

  return {
    exam_mode: "rikz_russian_2026",
    official_part: "B",
    official_number: String(number - 18),
    question_text: `Placeholder Part B question ${number - 18}`,
    question_type: "short_answer_token",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    option_e: "",
    correct_answer: "",
    accepted_answers: "[\"placeholder\"]",
    response_subtype: "word",
    topic: "Placeholder topic",
    subtopic: "",
    difficulty: "medium",
    points: "2",
    source: "Original placeholder content",
    explanation: "Placeholder explanation"
  };
});

export function columnsForImportTemplate(mode: ImportTemplateMode = "generic") {
  return mode === "rikz_russian_2026" ? AUTHENTIC_IMPORT_TEMPLATE_COLUMNS : GENERIC_IMPORT_TEMPLATE_COLUMNS;
}

export function buildCsvTemplate(mode: ImportTemplateMode = "generic") {
  const columns = columnsForImportTemplate(mode);
  const rows =
    mode === "rikz_russian_2026"
      ? AUTHENTIC_IMPORT_EXAMPLE_ROWS.map((row) =>
          columns.map((column) => JSON.stringify(row[column] ?? "")).join(",")
        )
      : [];

  return `${columns.join(",")}\n${rows.join("\n")}${rows.length > 0 ? "\n" : ""}`;
}
