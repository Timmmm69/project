import { apiFailure, apiSuccess } from "@/lib/api-response";
import { serializeResult } from "@/lib/scoring/result-serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireStudent } from "@/server/auth/student-session";
import { prisma } from "@/server/db/client";

type RouteContext = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const student = await requireStudent();
  if (!student) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Student session is required" }, 401);
  }

  const { attemptId } = await context.params;
  const parsedId = uuidSchema.safeParse(attemptId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  const attempt = await prisma.attempt.findFirst({
    where: {
      id: parsedId.data,
      userId: student.id
    },
    include: {
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
  if (attempt.status === "STARTED") {
    return apiFailure({ code: "RESULT_NOT_READY", message: "Result is available after attempt completion" }, 409);
  }

  return apiSuccess({ result: serializeResult(attempt) });
}
