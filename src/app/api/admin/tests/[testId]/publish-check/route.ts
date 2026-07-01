import { apiFailure, apiSuccess } from "@/lib/api-response";
import { runPublishCheck } from "@/lib/tests/publish-check";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";

type RouteContext = {
  params: Promise<{
    testId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
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

  const result = runPublishCheck(test);

  return apiSuccess({
    canPublish: result.canPublish,
    errors: result.errors,
    warnings: result.warnings
  });
}
