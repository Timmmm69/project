import { Prisma } from "@prisma/client";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import type { ImportPreviewQuestion } from "@/lib/imports/types";
import { serializeImportJob } from "@/lib/imports/serialize";
import { recalculateTestQuestionCounters } from "@/lib/questions/counters";
import { scoringRuleForQuestionType, toPrismaDifficulty, toPrismaQuestionType } from "@/lib/questions/enums";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

function asPreview(value: Prisma.JsonValue): ImportPreviewQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as unknown as ImportPreviewQuestion[];
}

function issueCount(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.length : 0;
}

export async function POST(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login required" }, 401);
  }

  const { importJobId } = await context.params;
  const parsedId = uuidSchema.safeParse(importJobId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Import job not found" }, 404);
  }

  const job = await prisma.importJob.findFirst({
    where: { id: parsedId.data, adminId: admin.id },
    include: { test: { select: { id: true, deletedAt: true } } }
  });
  if (!job || job.test.deletedAt) {
    return apiFailure({ code: "NOT_FOUND", message: "Import job not found" }, 404);
  }

  if (job.status !== "VALIDATED") {
    return apiFailure({ code: "INVALID_IMPORT_STATUS", message: "Only validated imports can be committed" }, 409);
  }
  if (issueCount(job.errors) > 0) {
    return apiFailure({ code: "IMPORT_HAS_ERRORS", message: "Import with critical errors cannot be committed" }, 409);
  }

  const preview = asPreview(job.preview);
  if (preview.length === 0) {
    return apiFailure({ code: "EMPTY_IMPORT", message: "Import has no valid rows" }, 409);
  }

  const updatedJob = await prisma.$transaction(async (tx) => {
    const startOrder =
      job.mode === "APPEND"
        ? (
            await tx.question.aggregate({
              where: { testId: job.testId, deletedAt: null },
              _max: { orderIndex: true }
            })
          )._max.orderIndex ?? 0
        : 0;

    if (job.mode === "REPLACE") {
      await tx.question.updateMany({
        where: { testId: job.testId, deletedAt: null },
        data: { deletedAt: new Date() }
      });
    }

    await tx.question.createMany({
      data: preview.map((question, index) => ({
        testId: job.testId,
        questionText: question.questionText,
        questionType: toPrismaQuestionType(question.questionType),
        optionA: question.optionA,
        optionB: question.optionB,
        optionC: question.optionC,
        optionD: question.optionD,
        correctAnswer: question.correctAnswer,
        topic: question.topic,
        subtopic: question.subtopic,
        difficulty: toPrismaDifficulty(question.difficulty),
        points: question.points,
        scoringRule: scoringRuleForQuestionType(question.questionType),
        explanation: question.explanation,
        source: question.source,
        orderIndex: startOrder + index + 1
      }))
    });

    await recalculateTestQuestionCounters(tx, job.testId);

    return tx.importJob.update({
      where: { id: job.id },
      data: {
        status: "IMPORTED",
        importedAt: new Date()
      }
    });
  });

  await logEvent({
    eventType: "import_committed",
    actorUserId: admin.id,
    entityType: "import_job",
    entityId: job.id,
    payload: { testId: job.testId, mode: job.mode, importedRows: preview.length }
  });

  return apiSuccess(serializeImportJob(updatedJob));
}
