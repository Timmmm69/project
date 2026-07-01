import { apiFailure, apiSuccess } from "@/lib/api-response";
import { recalculateTestQuestionCounters } from "@/lib/questions/counters";
import { scoringRuleForQuestionType, toPrismaDifficulty, toPrismaQuestionType } from "@/lib/questions/enums";
import { adminQuestionInputSchema } from "@/lib/questions/question-schemas";
import { serializeQuestion } from "@/lib/questions/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    questionId: string;
  }>;
};

async function getQuestionId(context: RouteContext) {
  const { questionId } = await context.params;
  return uuidSchema.safeParse(questionId);
}

export async function GET(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await getQuestionId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  const question = await prisma.question.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null,
      test: {
        deletedAt: null
      }
    }
  });

  if (!question) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  return apiSuccess(serializeQuestion(question));
}

export async function PATCH(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await getQuestionId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  const parsed = adminQuestionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Некорректные данные вопроса",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const existing = await prisma.question.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null,
      test: {
        deletedAt: null
      }
    },
    select: {
      id: true,
      testId: true
    }
  });

  if (!existing) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  const question = await prisma.$transaction(async (tx) => {
    const updated = await tx.question.update({
      where: { id: existing.id },
      data: {
        questionText: parsed.data.questionText,
        questionType: toPrismaQuestionType(parsed.data.questionType),
        optionA: parsed.data.optionA,
        optionB: parsed.data.optionB,
        optionC: parsed.data.optionC,
        optionD: parsed.data.optionD,
        correctAnswer: parsed.data.correctAnswer,
        topic: parsed.data.topic,
        subtopic: parsed.data.subtopic,
        difficulty: toPrismaDifficulty(parsed.data.difficulty),
        points: parsed.data.points,
        scoringRule: scoringRuleForQuestionType(parsed.data.questionType),
        explanation: parsed.data.explanation,
        source: parsed.data.source
      }
    });
    await recalculateTestQuestionCounters(tx, existing.testId);
    return updated;
  });

  await logEvent({
    eventType: "question_updated",
    actorUserId: admin.id,
    entityType: "question",
    entityId: question.id,
    payload: { testId: existing.testId, questionType: parsed.data.questionType }
  });

  return apiSuccess(serializeQuestion(question));
}

export async function DELETE(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await getQuestionId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  const existing = await prisma.question.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null,
      test: {
        deletedAt: null
      }
    },
    select: {
      id: true,
      testId: true
    }
  });

  if (!existing) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  const question = await prisma.$transaction(async (tx) => {
    const deleted = await tx.question.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date()
      }
    });
    await recalculateTestQuestionCounters(tx, existing.testId);
    return deleted;
  });

  await logEvent({
    eventType: "question_deleted",
    actorUserId: admin.id,
    entityType: "question",
    entityId: question.id,
    payload: { testId: existing.testId, softDelete: true }
  });

  return apiSuccess(serializeQuestion(question));
}
