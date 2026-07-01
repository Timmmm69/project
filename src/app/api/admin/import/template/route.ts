import ExcelJS from "exceljs";
import { buildCsvTemplate, IMPORT_TEMPLATE_COLUMNS } from "@/lib/imports/template";
import { apiFailure } from "@/lib/api-response";
import { requireAdmin } from "@/server/auth/session";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login required" }, 401);
  }

  const format = new URL(request.url).searchParams.get("format") ?? "xlsx";

  if (format === "csv") {
    return new Response(buildCsvTemplate(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="questions-import-template.csv"'
      }
    });
  }

  if (format !== "xlsx") {
    return apiFailure({ code: "VALIDATION_ERROR", message: "format must be xlsx or csv" }, 422);
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("questions");
  worksheet.addRow([...IMPORT_TEMPLATE_COLUMNS]);
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns = IMPORT_TEMPLATE_COLUMNS.map((header) => ({
    header,
    key: header,
    width: Math.max(header.length + 4, 18)
  }));

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="questions-import-template.xlsx"'
    }
  });
}
