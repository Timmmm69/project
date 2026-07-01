import ExcelJS from "exceljs";
import { parse as parseCsvSync } from "csv-parse/sync";
import { mapRecordToImportRow } from "@/lib/imports/validation";
import { IMPORT_TEMPLATE_COLUMNS } from "@/lib/imports/template";
import type { ImportError, ImportFileType, ImportRawRow } from "@/lib/imports/types";

type ParsedSheet = {
  header: string[];
  rows: ImportRawRow[];
  errors: ImportError[];
};

function cellToText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray((value as { richText?: Array<{ text?: string }> }).richText)) {
      return (value as { richText: Array<{ text?: string }> }).richText.map((item) => item.text ?? "").join("");
    }
    if ("text" in value) {
      return String((value as { text?: unknown }).text ?? "");
    }
    if ("result" in value) {
      return String((value as { result?: unknown }).result ?? "");
    }
  }
  return String(value);
}

function isFormulaCell(value: unknown) {
  return Boolean(value && typeof value === "object" && "formula" in value);
}

function nonEmptyRecord(record: string[]) {
  return record.some((value) => value.trim().length > 0);
}

export function detectImportFileType(fileName: string): ImportFileType | null {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".csv")) {
    return "csv";
  }
  if (normalized.endsWith(".xlsx")) {
    return "xlsx";
  }
  return null;
}

export function parseCsvImport(buffer: Uint8Array): ParsedSheet {
  const records = parseCsvSync(Buffer.from(buffer).toString("utf8"), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true
  }) as string[][];

  const header = (records[0] ?? []).map((value) => String(value).trim());
  const rows = records
    .slice(1)
    .map((record, index) => ({ record: record.map((value) => String(value ?? "")), rowNumber: index + 2 }))
    .filter(({ record }) => nonEmptyRecord(record))
    .map(({ record, rowNumber }) => mapRecordToImportRow(rowNumber, record));

  return { header, rows, errors: [] };
}

export async function parseXlsxImport(buffer: Uint8Array): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  type ExcelJsWorkbookBuffer = Parameters<typeof workbook.xlsx.load>[0];
  const binary = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await workbook.xlsx.load(binary as ExcelJsWorkbookBuffer);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return {
      header: [],
      rows: [],
      errors: [{ rowNumber: null, field: "file", code: "EMPTY_WORKBOOK", message: "В XLSX нет листов." }]
    };
  }

  const errors: ImportError[] = [];
  const width = Math.max(IMPORT_TEMPLATE_COLUMNS.length, worksheet.columnCount);
  const readRow = (rowNumber: number) => {
    const row = worksheet.getRow(rowNumber);
    const values: string[] = [];
    for (let column = 1; column <= width; column += 1) {
      const cell = row.getCell(column);
      if (isFormulaCell(cell.value)) {
        errors.push({
          rowNumber,
          field: column <= IMPORT_TEMPLATE_COLUMNS.length ? IMPORT_TEMPLATE_COLUMNS[column - 1] : "file",
          code: "FORMULA_NOT_ALLOWED",
          message: "Формулы в импортируемом файле не разрешены."
        });
      }
      values.push(cellToText(cell.value));
    }
    return values;
  };

  const header = readRow(1).map((value) => value.trim());
  const rows: ImportRawRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const record = readRow(rowNumber);
    if (nonEmptyRecord(record)) {
      rows.push(mapRecordToImportRow(rowNumber, record));
    }
  }

  return { header, rows, errors };
}
