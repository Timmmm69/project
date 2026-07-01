import { apiFailure, apiSuccess } from "@/lib/api-response";
import { runPublishCheck } from "@/lib/tests/publish-check";
import { serializeTest } from "@/lib/tests/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    testId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const { testId } = await context.params;
  const parsedId = uuidSchema.safeParse(testId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const test = await prisma.test.findFirst({
    where: {
      id: parsedId.data,
      deletedAt: null
    },
    include: {
      questions: {
        where: { deletedAt: null },
        orderBy: { orderIndex: "asc" }
      },
      scoringScheme: {
        include: {
          scales: true
        }
      }
    }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Тест не найден" }, 404);
  }

  const check = runPublishCheck(test);
  if (!check.canPublish) {
    return apiFailure(
      {
        code: "PUBLISH_CHECK_FAILED",
        message: "Тест нельзя опубликовать",
        details: {
          errors: check.errors,
          warnings: check.warnings
        }
      },
      409
    );
  }

  const updated = await prisma.test.update({
    where: { id: test.id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date()
    }
  });

  await logEvent({
    eventType: "test_published",
    actorUserId: admin.id,
    entityType: "test",
    entityId: test.id
  });

  return apiSuccess(serializeTest(updated));
}
