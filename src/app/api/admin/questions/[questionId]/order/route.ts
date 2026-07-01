import { apiFailure, apiSuccess } from "@/lib/api-response";
import { adminQuestionOrderSchema } from "@/lib/questions/question-schemas";
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

export async function PATCH(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const { questionId } = await context.params;
  const parsedId = uuidSchema.safeParse(questionId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  const parsed = adminQuestionOrderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Некорректное направление перемещения",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const current = await prisma.question.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null,
      test: {
        deletedAt: null
      }
    }
  });

  if (!current) {
    return apiFailure({ code: "NOT_FOUND", message: "Вопрос не найден" }, 404);
  }

  const neighbor = await prisma.question.findFirst({
    where: {
      testId: current.testId,
      deletedAt: null,
      orderIndex:
        parsed.data.direction === "up"
          ? { lt: current.orderIndex }
          : { gt: current.orderIndex }
    },
    orderBy: {
      orderIndex: parsed.data.direction === "up" ? "desc" : "asc"
    }
  });

  if (!neighbor) {
    return apiSuccess(serializeQuestion(current));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const tempOrderIndex = -Math.abs(current.orderIndex || 1) - 100000;

    await tx.question.update({
      where: { id: current.id },
      data: { orderIndex: tempOrderIndex }
    });
    await tx.question.update({
      where: { id: neighbor.id },
      data: { orderIndex: current.orderIndex }
    });
    return tx.question.update({
      where: { id: current.id },
      data: { orderIndex: neighbor.orderIndex }
    });
  });

  await logEvent({
    eventType: "question_reordered",
    actorUserId: admin.id,
    entityType: "question",
    entityId: current.id,
    payload: { testId: current.testId, direction: parsed.data.direction }
  });

  return apiSuccess(serializeQuestion(updated));
}
