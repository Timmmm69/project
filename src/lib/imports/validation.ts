import { isOptionLetter, normalizeCorrectAnswer, parseMultipleChoiceLetters } from "@/lib/questions/normalization";
import type { MvpDifficulty, MvpQuestionType } from "@/lib/questions/enums";
import {
  AUTHENTIC_IMPORT_TEMPLATE_COLUMNS,
  GENERIC_IMPORT_TEMPLATE_COLUMNS,
  IMPORT_TEMPLATE_COLUMNS,
  MAX_IMPORT_ROWS,
  type ImportTemplateColumn
} from "@/lib/imports/template";
import type {
  ImportError,
  ImportExamMode,
  ImportPreviewQuestion,
  ImportRawRow,
  ImportValidationResult,
  ImportWarning
} from "@/lib/imports/types";

const GENERIC_QUESTION_TYPES = new Set<MvpQuestionType>(["single_choice", "multiple_choice", "short_text"]);
const AUTHENTIC_QUESTION_TYPES = new Set<MvpQuestionType>(["multi_select_five", "short_answer_token"]);
const DIFFICULTIES = new Set<MvpDifficulty>(["easy", "medium", "hard"]);
const RESPONSE_SUBTYPES = new Set(["word", "digits", "alnum"]);

function trim(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function optional(value: string) {
  const normalized = trim(value);
  return normalized.length > 0 ? normalized : null;
}

function distinctRows(issues: Array<ImportError | ImportWarning>) {
  return new Set(issues.map((issue) => issue.rowNumber ?? 1)).size;
}

function issue(rowNumber: number | null, field: ImportError["field"], code: string, message: string): ImportError {
  return { rowNumber, field, code, message };
}

function optionMap(input: Pick<ImportPreviewQuestion, "optionA" | "optionB" | "optionC" | "optionD" | "optionE">) {
  return {
    A: input.optionA,
    B: input.optionB,
    C: input.optionC,
    D: input.optionD,
    E: input.optionE
  } as const;
}

function filledOptions(input: Pick<ImportPreviewQuestion, "optionA" | "optionB" | "optionC" | "optionD" | "optionE">) {
  return Object.values(optionMap(input)).filter((value) => value && value.length > 0);
}

function optionExists(letter: string, input: Pick<ImportPreviewQuestion, "optionA" | "optionB" | "optionC" | "optionD" | "optionE">) {
  const options = optionMap(input);
  return Boolean(options[letter as keyof typeof options]);
}

function expectedColumnsForExamMode(examMode: ImportExamMode) {
  return examMode === "rikz_russian_2026" ? AUTHENTIC_IMPORT_TEMPLATE_COLUMNS : GENERIC_IMPORT_TEMPLATE_COLUMNS;
}

function validateHeader(header: string[], examMode: ImportExamMode) {
  const normalized = header.map((value) => trim(value));
  const expected = expectedColumnsForExamMode(examMode);
  const errors: ImportError[] = [];

  if (normalized.length === 0 || normalized.every((value) => value.length === 0)) {
    errors.push(issue(1, "file", "EMPTY_HEADER", "The file has no header row."));
    return errors;
  }

  for (const [index, expectedColumn] of expected.entries()) {
    const actual = normalized[index] ?? "";
    if (actual !== expectedColumn) {
      errors.push(
        issue(
          1,
          "file",
          "INVALID_HEADER",
          `Column ${index + 1} must be "${expectedColumn}", currently "${actual || "empty"}".`
        )
      );
    }
  }

  if (normalized.length > expected.length) {
    const extra = normalized.slice(expected.length).filter(Boolean);
    if (extra.length > 0) {
      errors.push(issue(1, "file", "UNKNOWN_COLUMNS", `Unknown columns: ${extra.join(", ")}.`));
    }
  }

  return errors;
}

function parsePoints(value: string, rowNumber: number, errors: ImportError[]) {
  const raw = trim(value);
  if (!raw) {
    errors.push(issue(rowNumber, "points", "REQUIRED", "points is required."));
    return null;
  }

  if (!/^\d+$/.test(raw)) {
    errors.push(issue(rowNumber, "points", "INVALID_POINTS", "points must be a positive integer."));
    return null;
  }

  const points = Number(raw);
  if (points < 1 || points > 100) {
    errors.push(issue(rowNumber, "points", "INVALID_POINTS", "points must be from 1 to 100."));
    return null;
  }

  return points;
}

function parseQuestionType(value: string, rowNumber: number, errors: ImportError[], examMode: ImportExamMode) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    errors.push(issue(rowNumber, "question_type", "REQUIRED", "question_type is required."));
    return null;
  }

  const allowed = examMode === "rikz_russian_2026" ? AUTHENTIC_QUESTION_TYPES : GENERIC_QUESTION_TYPES;
  if (!allowed.has(normalized as MvpQuestionType)) {
    errors.push(
      issue(
        rowNumber,
        "question_type",
        "INVALID_QUESTION_TYPE",
        examMode === "rikz_russian_2026"
          ? "For rikz_russian_2026 question_type must be multi_select_five or short_answer_token."
          : "question_type must be single_choice, multiple_choice or short_text."
      )
    );
    return null;
  }

  return normalized as MvpQuestionType;
}

function parseDifficulty(value: string, rowNumber: number, errors: ImportError[]) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return "medium" as const;
  }
  if (!DIFFICULTIES.has(normalized as MvpDifficulty)) {
    errors.push(issue(rowNumber, "difficulty", "INVALID_DIFFICULTY", "difficulty must be easy, medium or hard."));
    return null;
  }
  return normalized as MvpDifficulty;
}

function parseOfficialPart(value: string, rowNumber: number, errors: ImportError[]) {
  const normalized = trim(value).toUpperCase();
  if (normalized !== "A" && normalized !== "B") {
    errors.push(issue(rowNumber, "official_part", "INVALID_OFFICIAL_PART", "official_part must be A or B."));
    return null;
  }
  return normalized;
}

function parseOfficialNumber(value: string, rowNumber: number, errors: ImportError[]) {
  const raw = trim(value);
  if (!/^\d+$/.test(raw)) {
    errors.push(issue(rowNumber, "official_number", "INVALID_OFFICIAL_NUMBER", "official_number must be a positive integer."));
    return null;
  }
  return Number(raw);
}

function parseResponseSubtype(value: string, rowNumber: number, errors: ImportError[]) {
  const normalized = trim(value).toLowerCase();
  if (!RESPONSE_SUBTYPES.has(normalized)) {
    errors.push(issue(rowNumber, "response_subtype", "INVALID_RESPONSE_SUBTYPE", "response_subtype must be word, digits or alnum."));
    return null;
  }
  return normalized as "word" | "digits" | "alnum";
}

function parseAcceptedAnswers(value: string, rowNumber: number, errors: ImportError[]) {
  const raw = trim(value);
  if (!raw) {
    errors.push(issue(rowNumber, "accepted_answers", "REQUIRED", "accepted_answers is required for Part B."));
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      errors.push(issue(rowNumber, "accepted_answers", "INVALID_ACCEPTED_ANSWERS", "accepted_answers must be a JSON array of non-empty strings."));
      return null;
    }
    return parsed.map((item) => item.trim());
  } catch {
    errors.push(issue(rowNumber, "accepted_answers", "INVALID_ACCEPTED_ANSWERS_JSON", "accepted_answers must be a valid JSON array."));
    return null;
  }
}

function validateChoiceAnswer(rowNumber: number, candidate: ImportPreviewQuestion, errors: ImportError[]) {
  if (filledOptions(candidate).length < 2) {
    errors.push(issue(rowNumber, "option_a", "NOT_ENOUGH_OPTIONS", "Choice questions need at least two filled options."));
  }

  if (candidate.questionType === "single_choice") {
    if (!isOptionLetter(candidate.correctAnswer) || !optionExists(candidate.correctAnswer, candidate)) {
      errors.push(
        issue(rowNumber, "correct_answer", "INVALID_SINGLE_CHOICE_ANSWER", "correct_answer must be A/B/C/D/E and point to a filled option.")
      );
    }
    return;
  }

  const letters = parseMultipleChoiceLetters(candidate.correctAnswer);
  if (candidate.points !== 2) {
    errors.push(issue(rowNumber, "points", "MULTIPLE_CHOICE_POINTS_UNSUPPORTED", "For multiple_choice in MVP points must be 2."));
  }

  if (letters.length === 0 || letters.some((letter) => !isOptionLetter(letter) || !optionExists(letter, candidate))) {
    errors.push(
      issue(rowNumber, "correct_answer", "INVALID_MULTIPLE_CHOICE_ANSWER", "correct_answer must contain A/B/C/D/E letters for filled options.")
    );
  }
}

function validateShortTextAnswer(rowNumber: number, candidate: ImportPreviewQuestion, errors: ImportError[], warnings: ImportWarning[]) {
  if (candidate.correctAnswer.length === 0) {
    errors.push(issue(rowNumber, "correct_answer", "INVALID_SHORT_TEXT_ANSWER", "short_text needs at least one accepted answer."));
  }

  if (filledOptions(candidate).length > 0) {
    warnings.push(issue(rowNumber, "option_a", "SHORT_TEXT_OPTIONS_IGNORED", "short_text options are ignored."));
  }
}

function validateAuthenticRow(rowNumber: number, candidate: ImportPreviewQuestion, errors: ImportError[]) {
  if (candidate.examMode !== "rikz_russian_2026") {
    errors.push(issue(rowNumber, "exam_mode", "INVALID_EXAM_MODE", "exam_mode must be rikz_russian_2026."));
  }
  if (!candidate.officialPart) {
    errors.push(issue(rowNumber, "official_part", "REQUIRED", "official_part is required."));
  }
  if (!candidate.officialNumber) {
    errors.push(issue(rowNumber, "official_number", "REQUIRED", "official_number is required."));
  }

  if (candidate.officialPart === "A") {
    if (candidate.questionType !== "multi_select_five") {
      errors.push(issue(rowNumber, "question_type", "AUTHENTIC_PART_A_TYPE", "Part A must use multi_select_five."));
    }
    if (candidate.points !== 2) {
      errors.push(issue(rowNumber, "points", "AUTHENTIC_PART_A_POINTS", "Part A points must be 2."));
    }
    if (filledOptions(candidate).length !== 5) {
      errors.push(issue(rowNumber, "option_e", "AUTHENTIC_PART_A_OPTIONS", "Part A must have exactly five options A-E."));
    }
    const letters = parseMultipleChoiceLetters(candidate.correctAnswer);
    if (letters.length === 0 || letters.some((letter) => !isOptionLetter(letter) || !optionExists(letter, candidate))) {
      errors.push(issue(rowNumber, "correct_answer", "AUTHENTIC_PART_A_ANSWER", "Part A correct_answer may contain only A-E letters for filled options."));
    }
  }

  if (candidate.officialPart === "B") {
    if (candidate.questionType !== "short_answer_token") {
      errors.push(issue(rowNumber, "question_type", "AUTHENTIC_PART_B_TYPE", "Part B must use short_answer_token."));
    }
    if (!candidate.responseSubtype) {
      errors.push(issue(rowNumber, "response_subtype", "REQUIRED", "response_subtype is required for Part B."));
    }
    if (!candidate.acceptedAnswers || candidate.acceptedAnswers.length === 0) {
      errors.push(issue(rowNumber, "accepted_answers", "REQUIRED", "accepted_answers is required for Part B."));
    }
    if (filledOptions(candidate).length > 0) {
      errors.push(issue(rowNumber, "option_a", "AUTHENTIC_PART_B_OPTIONS", "Part B must not use answer options."));
    }
  }
}

function validateAuthenticTotals(preview: ImportPreviewQuestion[], errors: ImportError[]) {
  const partA = preview.filter((question) => question.officialPart === "A");
  const partB = preview.filter((question) => question.officialPart === "B");
  const totalPoints = preview.reduce((sum, question) => sum + question.points, 0);

  if (preview.length !== 40) {
    errors.push(issue(null, "file", "AUTHENTIC_QUESTION_COUNT", "rikz_russian_2026 import must contain exactly 40 questions."));
  }
  if (partA.length !== 18) {
    errors.push(issue(null, "official_part", "AUTHENTIC_PART_A_COUNT", "rikz_russian_2026 import must contain exactly 18 Part A questions."));
  }
  if (partB.length !== 22) {
    errors.push(issue(null, "official_part", "AUTHENTIC_PART_B_COUNT", "rikz_russian_2026 import must contain exactly 22 Part B questions."));
  }
  if (totalPoints !== 80) {
    errors.push(issue(null, "points", "AUTHENTIC_TOTAL_POINTS", "rikz_russian_2026 import must contain exactly 80 primary points."));
  }
}

function validateRow(row: ImportRawRow, examMode: ImportExamMode) {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const values = row.values;

  const questionText = trim(values.question_text);
  const topic = trim(values.topic);
  const questionType = parseQuestionType(values.question_type, row.rowNumber, errors, examMode);
  const difficulty = parseDifficulty(values.difficulty, row.rowNumber, errors);
  const points = parsePoints(values.points, row.rowNumber, errors);
  const officialPart = examMode === "rikz_russian_2026" ? parseOfficialPart(values.official_part, row.rowNumber, errors) : null;
  const officialNumber = examMode === "rikz_russian_2026" ? parseOfficialNumber(values.official_number, row.rowNumber, errors) : null;
  const responseSubtype =
    examMode === "rikz_russian_2026" && trim(values.response_subtype)
      ? parseResponseSubtype(values.response_subtype, row.rowNumber, errors)
      : null;
  const acceptedAnswers =
    examMode === "rikz_russian_2026" && officialPart === "B"
      ? parseAcceptedAnswers(values.accepted_answers, row.rowNumber, errors)
      : null;

  if (!questionText) {
    errors.push(issue(row.rowNumber, "question_text", "REQUIRED", "question_text is required."));
  }
  if (!trim(values.correct_answer) && !(examMode === "rikz_russian_2026" && officialPart === "B" && acceptedAnswers?.[0])) {
    errors.push(issue(row.rowNumber, "correct_answer", "REQUIRED", "correct_answer is required."));
  }
  if (!topic) {
    errors.push(issue(row.rowNumber, "topic", "REQUIRED", "topic is required."));
  }

  if (!questionType || !difficulty || points === null) {
    return { errors, warnings, preview: null };
  }

  const candidate: ImportPreviewQuestion = {
    examMode,
    officialPart,
    officialNumber,
    questionText,
    questionType,
    optionA: optional(values.option_a),
    optionB: optional(values.option_b),
    optionC: optional(values.option_c),
    optionD: optional(values.option_d),
    optionE: optional(values.option_e),
    correctAnswer: normalizeCorrectAnswer(questionType, values.correct_answer || acceptedAnswers?.[0] || ""),
    acceptedAnswers,
    responseSubtype,
    topic,
    subtopic: optional(values.subtopic),
    difficulty,
    points,
    source: optional(values.source),
    explanation: optional(values.explanation)
  };

  if (examMode === "rikz_russian_2026") {
    validateAuthenticRow(row.rowNumber, candidate, errors);
  } else if (candidate.questionType === "short_text") {
    validateShortTextAnswer(row.rowNumber, candidate, errors, warnings);
    candidate.optionA = null;
    candidate.optionB = null;
    candidate.optionC = null;
    candidate.optionD = null;
    candidate.optionE = null;
  } else {
    validateChoiceAnswer(row.rowNumber, candidate, errors);
  }

  return {
    errors,
    warnings,
    preview: errors.length === 0 ? candidate : null
  };
}

export function validateImportRows(input: {
  header: string[];
  rows: ImportRawRow[];
  parseErrors?: ImportError[];
  examMode?: ImportExamMode;
}): ImportValidationResult {
  const examMode = input.examMode ?? "generic";
  const errors: ImportError[] = [...(input.parseErrors ?? []), ...validateHeader(input.header, examMode)];
  const warnings: ImportWarning[] = [];
  const preview: ImportPreviewQuestion[] = [];

  if (input.rows.length > MAX_IMPORT_ROWS) {
    errors.push(issue(null, "file", "TOO_MANY_ROWS", `One file can import at most ${MAX_IMPORT_ROWS} questions.`));
  }

  for (const row of input.rows) {
    const rowResult = validateRow(row, examMode);
    errors.push(...rowResult.errors);
    warnings.push(...rowResult.warnings);
    if (rowResult.preview) {
      preview.push(rowResult.preview);
    }
  }

  if (examMode === "rikz_russian_2026" && errors.length === 0) {
    validateAuthenticTotals(preview, errors);
  }

  return {
    totalRows: input.rows.length,
    validRows: errors.length === 0 ? preview.length : preview.length,
    errorRows: distinctRows(errors),
    warningRows: distinctRows(warnings),
    errors,
    warnings,
    preview
  };
}

export function mapRecordToImportRow(
  rowNumber: number,
  record: string[],
  columns: readonly ImportTemplateColumn[] = IMPORT_TEMPLATE_COLUMNS
): ImportRawRow {
  const values = Object.fromEntries(
    AUTHENTIC_IMPORT_TEMPLATE_COLUMNS.map((column) => [column, ""])
  ) as Record<ImportTemplateColumn, string>;

  columns.forEach((column, index) => {
    values[column] = trim(record[index]);
  });

  return { rowNumber, values };
}
