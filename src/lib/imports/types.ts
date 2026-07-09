import type { MvpDifficulty, MvpQuestionType } from "@/lib/questions/enums";
import type { ImportTemplateColumn } from "@/lib/imports/template";

export type ImportFileType = "csv" | "xlsx";
export type ImportModeValue = "append" | "replace";
export type ImportExamMode = "generic" | "rikz_russian_2026";

export type ImportRawRow = {
  rowNumber: number;
  values: Record<ImportTemplateColumn, string>;
};

export type ImportIssue = {
  rowNumber: number | null;
  field?: ImportTemplateColumn | "file";
  code: string;
  message: string;
};

export type ImportWarning = ImportIssue;
export type ImportError = ImportIssue;

export type ImportPreviewQuestion = {
  examMode?: ImportExamMode;
  officialPart: "A" | "B" | null;
  officialNumber: number | null;
  questionText: string;
  questionType: MvpQuestionType;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  optionE: string | null;
  correctAnswer: string;
  acceptedAnswers: string[] | null;
  responseSubtype: "word" | "digits" | "alnum" | null;
  topic: string;
  subtopic: string | null;
  difficulty: MvpDifficulty;
  points: number;
  source: string | null;
  explanation: string | null;
};

export type ParsedImportRows = {
  fileType: ImportFileType;
  rows: ImportRawRow[];
  errors: ImportError[];
};

export type ImportValidationResult = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  errors: ImportError[];
  warnings: ImportWarning[];
  preview: ImportPreviewQuestion[];
};
