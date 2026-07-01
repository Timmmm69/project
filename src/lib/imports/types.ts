import type { MvpDifficulty, MvpQuestionType } from "@/lib/questions/enums";
import type { ImportTemplateColumn } from "@/lib/imports/template";

export type ImportFileType = "csv" | "xlsx";
export type ImportModeValue = "append" | "replace";

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
  questionText: string;
  questionType: MvpQuestionType;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string;
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
