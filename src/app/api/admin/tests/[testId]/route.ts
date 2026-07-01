import { apiFailure, apiSuccess } from "@/lib/api-response";
import { toPrismaTestMode, toPrismaTestStatus } from "@/lib/tests/enums";
import { serializeTest } from "@/lib/tests/serialize";
import { adminUpdateTestSchema } from "@/lib/tests/test-schemas";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    testId: string;
  }>;
};

async function parseTestId(context: RouteContext) {
  const { testId } = await context.params;
  return uuidSchema.safeParse(testId);
}

export async function GET(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await parseTestId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const test = await prisma.test.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null
    }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  return apiSuccess(serializeTest(test));
}

export async function PATCH(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await parseTestId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const parsed = adminUpdateTestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Некорректные данные теста",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const existing = await prisma.test.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null
    },
    select: { id: true }
  });

  if (!existing) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const test = await prisma.test.update({
    where: { id: parsedId.data },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.mode !== undefined ? { mode: toPrismaTestMode(parsed.data.mode) } : {}),
      ...(parsed.data.shortDescription !== undefined
        ? { shortDescription: parsed.data.shortDescription }
        : {}),
      ...(parsed.data.fullDescription !== undefined ? { fullDescription: parsed.data.fullDescription } : {}),
      ...(parsed.data.price !== undefined ? { price: parsed.data.price } : {}),
      ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
      ...(parsed.data.durationMinutes !== undefined
        ? { durationMinutes: parsed.data.durationMinutes }
        : {}),
      ...(parsed.data.attemptsLimit !== undefined ? { attemptsLimit: parsed.data.attemptsLimit } : {}),
      ...(parsed.data.accessDays !== undefined ? { accessDays: parsed.data.accessDays } : {}),
      ...(parsed.data.status !== undefined ? { status: toPrismaTestStatus(parsed.data.status) } : {}),
      ...(parsed.data.scoringSchemeId !== undefined
        ? { scoringSchemeId: parsed.data.scoringSchemeId }
        : {}),
      ...(parsed.data.showScaledScore !== undefined
        ? { showScaledScore: parsed.data.showScaledScore }
        : {}),
      ...(parsed.data.showPercent !== undefined ? { showPercent: parsed.data.showPercent } : {}),
      ...(parsed.data.showCorrectAnswers !== undefined
        ? { showCorrectAnswers: parsed.data.showCorrectAnswers }
        : {}),
      ...(parsed.data.showTopicResult !== undefined
        ? { showTopicResult: parsed.data.showTopicResult }
        : {}),
      ...(parsed.data.showRecommendations !== undefined
        ? { showRecommendations: parsed.data.showRecommendations }
        : {})
    }
  });

  await logEvent({
    eventType: "test_updated",
    actorUserId: admin.id,
    entityType: "test",
    entityId: test.id
  });

  return apiSuccess(serializeTest(test));
}

export async function DELETE(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsedId = await parseTestId(context);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const test = await prisma.test.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null
    },
    include: {
      _count: {
        select: {
          payments: true,
          accesses: true,
          attempts: true
        }
      }
    }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const hasHistory = test._count.payments > 0 || test._count.accesses > 0 || test._count.attempts > 0;
  const updated = await prisma.test.update({
    where: { id: test.id },
    data: {
      deletedAt: new Date(),
      status: hasHistory ? "ARCHIVED" : "DRAFT"
    }
  });

  await logEvent({
    eventType: "test_deleted",
    actorUserId: admin.id,
    entityType: "test",
    entityId: test.id,
    payload: { softDelete: true, hadHistory: hasHistory }
  });

  return apiSuccess(serializeTest(updated));
}
