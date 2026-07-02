import { apiFailure, apiSuccess } from "@/lib/api-response";
import { serializeResult } from "@/lib/scoring/result-serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

type RouteContext = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const { attemptId } = await context.params;
  const parsedId = uuidSchema.safeParse(attemptId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  const attempt = await prisma.attempt.findUnique({
    where: { id: parsedId.data },
    include: {
      user: { select: { email: true } },
      test: {
        select: {
          title: true,
          slug: true,
          mode: true,
          showPercent: true,
          showCorrectAnswers: true,
          showTopicResult: true,
          showRecommendations: true
        }
      },
      answers: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!attempt) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  return apiSuccess({ result: serializeResult(attempt) });
}
