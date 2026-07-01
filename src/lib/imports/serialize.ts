import type { ImportJob } from "@prisma/client";

export function serializeImportJob(job: ImportJob) {
  return {
    id: job.id,
    testId: job.testId,
    fileName: job.fileName,
    fileType: job.fileType,
    mode: job.mode === "APPEND" ? "append" : "replace",
    status: job.status.toLowerCase(),
    totalRows: job.totalRows ?? 0,
    validRows: job.validRows ?? 0,
    errorRows: job.errorRows ?? 0,
    warningRows: job.warningRows ?? 0,
    errors: job.errors ?? [],
    warnings: job.warnings ?? [],
    preview: job.preview ?? [],
    createdAt: job.createdAt,
    validatedAt: job.validatedAt,
    importedAt: job.importedAt
  };
}
