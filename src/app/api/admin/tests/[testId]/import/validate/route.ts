import { Prisma } from "@prisma/client";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { MAX_IMPORT_FILE_SIZE_BYTES } from "@/lib/imports/template";
import { detectImportFileType, parseCsvImport, parseXlsxImport } from "@/lib/imports/parse";
import { serializeImportJob } from "@/lib/imports/serialize";
import { validateImportRows } from "@/lib/imports/validation";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    testId: string;
  }>;
};

function toPrismaMode(mode: FormDataEntryValue | null) {
  if (mode === "replace") {
    return "REPLACE" as const;
  }
  return "APPEND" as const;
}

async function parseFile(file: File) {
  const fileType = detectImportFileType(file.name);
  if (!fileType) {
    throw new Error("UNSUPPORTED_FILE_TYPE");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (fileType === "csv") {
    return { fileType, parsed: parseCsvImport(buffer) };
  }
  return { fileType, parsed: await parseXlsxImport(buffer) };
}

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login required" }, 401);
  }

  const { testId } = await context.params;
  const parsedTestId = uuidSchema.safeParse(testId);
  if (!parsedTestId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Test not found" }, 404);
  }

  const test = await prisma.test.findFirst({
    where: { id: parsedTestId.data, deletedAt: null },
    select: { id: true }
  });
  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Test not found" }, 404);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return apiFailure({ code: "VALIDATION_ERROR", message: "multipart form-data is required" }, 422);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return apiFailure({ code: "VALIDATION_ERROR", message: "file is required" }, 422);
  }
  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    return apiFailure({ code: "FILE_TOO_LARGE", message: "Max file size is 5 MB" }, 413);
  }

  const mode = toPrismaMode(formData.get("mode"));

  try {
    const parsedFile = await parseFile(file);
    const validation = validateImportRows({
      header: parsedFile.parsed.header,
      rows: parsedFile.parsed.rows,
      parseErrors: parsedFile.parsed.errors
    });

    const job = await prisma.importJob.create({
      data: {
        testId: test.id,
        adminId: admin.id,
        fileName: file.name,
        fileType: parsedFile.fileType,
        mode,
        status: validation.errors.length > 0 ? "FAILED" : "VALIDATED",
        totalRows: validation.totalRows,
        validRows: validation.validRows,
        errorRows: validation.errorRows,
        warningRows: validation.warningRows,
        errors: validation.errors as Prisma.InputJsonValue,
        warnings: validation.warnings as Prisma.InputJsonValue,
        preview: validation.preview as Prisma.InputJsonValue,
        validatedAt: new Date()
      }
    });

    await logEvent({
      eventType: "import_validated",
      actorUserId: admin.id,
      entityType: "import_job",
      entityId: job.id,
      payload: {
        testId: test.id,
        status: job.status,
        mode: job.mode,
        totalRows: job.totalRows,
        errorRows: job.errorRows,
        warningRows: job.warningRows
      }
    });

    return apiSuccess(serializeImportJob(job), { status: validation.errors.length > 0 ? 422 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNSUPPORTED_FILE_TYPE") {
      return apiFailure({ code: "UNSUPPORTED_FILE_TYPE", message: "Only .xlsx and .csv files are supported" }, 422);
    }

    const job = await prisma.importJob.create({
      data: {
        testId: test.id,
        adminId: admin.id,
        fileName: file.name,
        fileType: "unknown",
        mode,
        status: "FAILED",
        totalRows: 0,
        validRows: 0,
        errorRows: 1,
        warningRows: 0,
        errors: [
          {
            rowNumber: null,
            field: "file",
            code: "PARSE_ERROR",
            message: "File could not be parsed"
          }
        ],
        warnings: [],
        preview: [],
        validatedAt: new Date()
      }
    });

    return apiSuccess(serializeImportJob(job), { status: 422 });
  }
}
