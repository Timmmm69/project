import { apiFailure, apiSuccess } from "@/lib/api-response";
import { recalculateTestQuestionCounters, getNextQuestionOrderIndex } from "@/lib/questions/counters";
import { scoringRuleForQuestionType, toPrismaDifficulty, toPrismaQuestionType } from "@/lib/questions/enums";
import { adminQuestionInputSchema } from "@/lib/questions/question-schemas";
import { serializeQuestion } from "@/lib/questions/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    testId: string;
  }>;
};

async function getTestId(context: RouteContext) {
  const { testId } = await context.params;
  return uuidSchema.safeParse(testId);
}

export async function GET(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await getTestId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const test = await prisma.test.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null
    },
    select: { id: true }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const questions = await prisma.question.findMany({
    where: {
      testId: test.id,
      deletedAt: null
    },
    orderBy: { orderIndex: "asc" }
  });

  return apiSuccess({
    items: questions.map(serializeQuestion)
  });
}

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await getTestId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
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

  const test = await prisma.test.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null
    },
    select: { id: true }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const question = await prisma.$transaction(async (tx) => {
    const orderIndex = await getNextQuestionOrderIndex(tx, test.id);
    const created = await tx.question.create({
      data: {
        testId: test.id,
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
        source: parsed.data.source,
        orderIndex
      }
    });
    await recalculateTestQuestionCounters(tx, test.id);
    return created;
  });

  await logEvent({
    eventType: "question_created",
    actorUserId: admin.id,
    entityType: "question",
    entityId: question.id,
    payload: { testId: test.id, questionType: parsed.data.questionType }
  });

  return apiSuccess(serializeQuestion(question), { status: 201 });
}
