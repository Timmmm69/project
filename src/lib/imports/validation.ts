import { isOptionLetter, normalizeCorrectAnswer, parseMultipleChoiceLetters } from "@/lib/questions/normalization";
import type { MvpDifficulty, MvpQuestionType } from "@/lib/questions/enums";
import { IMPORT_TEMPLATE_COLUMNS, MAX_IMPORT_ROWS, type ImportTemplateColumn } from "@/lib/imports/template";
import type { ImportError, ImportPreviewQuestion, ImportRawRow, ImportValidationResult, ImportWarning } from "@/lib/imports/types";

const QUESTION_TYPES = new Set<MvpQuestionType>(["single_choice", "multiple_choice", "short_text"]);
const DIFFICULTIES = new Set<MvpDifficulty>(["easy", "medium", "hard"]);

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

function optionMap(input: Pick<ImportPreviewQuestion, "optionA" | "optionB" | "optionC" | "optionD">) {
  return {
    A: input.optionA,
    B: input.optionB,
    C: input.optionC,
    D: input.optionD
  } as const;
}

function filledOptions(input: Pick<ImportPreviewQuestion, "optionA" | "optionB" | "optionC" | "optionD">) {
  return Object.values(optionMap(input)).filter((value) => value && value.length > 0);
}

function optionExists(letter: string, input: Pick<ImportPreviewQuestion, "optionA" | "optionB" | "optionC" | "optionD">) {
  const options = optionMap(input);
  return Boolean(options[letter as keyof typeof options]);
}

function validateHeader(header: string[]) {
  const normalized = header.map((value) => trim(value));
  const errors: ImportError[] = [];

  if (normalized.length === 0 || normalized.every((value) => value.length === 0)) {
    errors.push(issue(1, "file", "EMPTY_HEADER", "В файле нет строки заголовков."));
    return errors;
  }

  for (const [index, expected] of IMPORT_TEMPLATE_COLUMNS.entries()) {
    const actual = normalized[index] ?? "";
    if (actual !== expected) {
      errors.push(
        issue(
          1,
          "file",
          "INVALID_HEADER",
          `Колонка ${index + 1} должна быть "${expected}", сейчас "${actual || "пусто"}".`
        )
      );
    }
  }

  if (normalized.length > IMPORT_TEMPLATE_COLUMNS.length) {
    const extra = normalized.slice(IMPORT_TEMPLATE_COLUMNS.length).filter(Boolean);
    if (extra.length > 0) {
      errors.push(issue(1, "file", "UNKNOWN_COLUMNS", `Лишние колонки: ${extra.join(", ")}.`));
    }
  }

  return errors;
}

function parsePoints(value: string, rowNumber: number, errors: ImportError[]) {
  const raw = trim(value);
  if (!raw) {
    errors.push(issue(rowNumber, "points", "REQUIRED", "points обязателен."));
    return null;
  }

  if (!/^\d+$/.test(raw)) {
    errors.push(issue(rowNumber, "points", "INVALID_POINTS", "points должен быть положительным целым числом."));
    return null;
  }

  const points = Number(raw);
  if (points < 1 || points > 100) {
    errors.push(issue(rowNumber, "points", "INVALID_POINTS", "points должен быть от 1 до 100."));
    return null;
  }

  return points;
}

function parseQuestionType(value: string, rowNumber: number, errors: ImportError[]) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    errors.push(issue(rowNumber, "question_type", "REQUIRED", "question_type обязателен."));
    return null;
  }
  if (!QUESTION_TYPES.has(normalized as MvpQuestionType)) {
    errors.push(
      issue(rowNumber, "question_type", "INVALID_QUESTION_TYPE", "question_type должен быть single_choice, multiple_choice или short_text.")
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
    errors.push(issue(rowNumber, "difficulty", "INVALID_DIFFICULTY", "difficulty должен быть easy, medium или hard."));
    return null;
  }
  return normalized as MvpDifficulty;
}

function validateChoiceAnswer(
  rowNumber: number,
  candidate: ImportPreviewQuestion,
  errors: ImportError[]
) {
  if (filledOptions(candidate).length < 2) {
    errors.push(issue(rowNumber, "option_a", "NOT_ENOUGH_OPTIONS", "Для выбора ответа нужно минимум 2 заполненных варианта."));
  }

  if (candidate.questionType === "single_choice") {
    if (!isOptionLetter(candidate.correctAnswer) || !optionExists(candidate.correctAnswer, candidate)) {
      errors.push(
        issue(rowNumber, "correct_answer", "INVALID_SINGLE_CHOICE_ANSWER", "correct_answer должен быть A/B/C/D и указывать на заполненный вариант.")
      );
    }
    return;
  }

  const letters = parseMultipleChoiceLetters(candidate.correctAnswer);
  if (letters.length === 0 || letters.some((letter) => !isOptionLetter(letter) || !optionExists(letter, candidate))) {
    errors.push(
      issue(rowNumber, "correct_answer", "INVALID_MULTIPLE_CHOICE_ANSWER", "correct_answer должен содержать A/B/C/D через запятую и указывать на заполненные варианты.")
    );
  }
}

function validateShortTextAnswer(rowNumber: number, candidate: ImportPreviewQuestion, errors: ImportError[], warnings: ImportWarning[]) {
  if (candidate.correctAnswer.length === 0) {
    errors.push(issue(rowNumber, "correct_answer", "INVALID_SHORT_TEXT_ANSWER", "Для short_text нужен хотя бы один вариант ответа."));
  }

  if (filledOptions(candidate).length > 0) {
    warnings.push(
      issue(rowNumber, "option_a", "SHORT_TEXT_OPTIONS_IGNORED", "У short_text варианты ответов не используются; option_a-option_d будут проигнорированы.")
    );
  }
}

function validateRow(row: ImportRawRow) {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const values = row.values;

  const questionText = trim(values.question_text);
  const topic = trim(values.topic);
  const questionType = parseQuestionType(values.question_type, row.rowNumber, errors);
  const difficulty = parseDifficulty(values.difficulty, row.rowNumber, errors);
  const points = parsePoints(values.points, row.rowNumber, errors);

  if (!questionText) {
    errors.push(issue(row.rowNumber, "question_text", "REQUIRED", "question_text обязателен."));
  }
  if (!trim(values.correct_answer)) {
    errors.push(issue(row.rowNumber, "correct_answer", "REQUIRED", "correct_answer обязателен."));
  }
  if (!topic) {
    errors.push(issue(row.rowNumber, "topic", "REQUIRED", "topic обязателен."));
  }

  if (!questionType || !difficulty || points === null) {
    return { errors, warnings, preview: null };
  }

  const candidate: ImportPreviewQuestion = {
    questionText,
    questionType,
    optionA: optional(values.option_a),
    optionB: optional(values.option_b),
    optionC: optional(values.option_c),
    optionD: optional(values.option_d),
    correctAnswer: normalizeCorrectAnswer(questionType, values.correct_answer),
    topic,
    subtopic: optional(values.subtopic),
    difficulty,
    points,
    source: optional(values.source),
    explanation: optional(values.explanation)
  };

  if (candidate.questionType === "short_text") {
    validateShortTextAnswer(row.rowNumber, candidate, errors, warnings);
    candidate.optionA = null;
    candidate.optionB = null;
    candidate.optionC = null;
    candidate.optionD = null;
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
}): ImportValidationResult {
  const errors: ImportError[] = [...(input.parseErrors ?? []), ...validateHeader(input.header)];
  const warnings: ImportWarning[] = [];
  const preview: ImportPreviewQuestion[] = [];

  if (input.rows.length > MAX_IMPORT_ROWS) {
    errors.push(issue(null, "file", "TOO_MANY_ROWS", `В одном файле можно импортировать максимум ${MAX_IMPORT_ROWS} вопросов.`));
  }

  for (const row of input.rows) {
    const rowResult = validateRow(row);
    errors.push(...rowResult.errors);
    warnings.push(...rowResult.warnings);
    if (rowResult.preview) {
      preview.push(rowResult.preview);
    }
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

export function mapRecordToImportRow(rowNumber: number, record: string[]): ImportRawRow {
  const values = Object.fromEntries(
    IMPORT_TEMPLATE_COLUMNS.map((column, index) => [column, trim(record[index])])
  ) as Record<ImportTemplateColumn, string>;

  return { rowNumber, values };
}
