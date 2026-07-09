import ExcelJS from "exceljs";
import { AUTHENTIC_IMPORT_EXAMPLE_ROWS, buildCsvTemplate, columnsForImportTemplate, type ImportTemplateMode } from "@/lib/imports/template";
import { apiFailure } from "@/lib/api-response";
import { requireAdmin } from "@/server/auth/session";

function templateModeFromRequest(request: Request): ImportTemplateMode {
  const examMode = new URL(request.url).searchParams.get("examMode");
  return examMode === "rikz_russian_2026" ? "rikz_russian_2026" : "generic";
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login required" }, 401);
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "xlsx";
  const templateMode = templateModeFromRequest(request);
  const columns = columnsForImportTemplate(templateMode);

  if (format === "csv") {
    return new Response(buildCsvTemplate(templateMode), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${templateMode}-questions-import-template.csv"`
      }
    });
  }

  if (format !== "xlsx") {
    return apiFailure({ code: "VALIDATION_ERROR", message: "format must be xlsx or csv" }, 422);
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("questions");
  worksheet.addRow([...columns]);
  if (templateMode === "rikz_russian_2026") {
    for (const row of AUTHENTIC_IMPORT_EXAMPLE_ROWS) {
      worksheet.addRow(columns.map((column) => row[column] ?? ""));
    }
  }
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns = columns.map((header) => ({
    header,
    key: header,
    width: Math.max(header.length + 4, 18)
  }));

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${templateMode}-questions-import-template.xlsx"`
    }
  });
}
