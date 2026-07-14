import { apiFailure, apiSuccess } from "@/lib/api-response";
import { serializeResult } from "@/lib/scoring/result-serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireStudent } from "@/server/auth/student-session";
import { prisma } from "@/server/db/client";
import { authorizeVerifiedStudentDestination } from "@/server/auth/verified-student-session/destination-guard";
import {
  finalizeVerifiedDestinationResponse,
  verifiedDestinationRejection,
  verifiedDestinationUnavailable
} from "@/server/auth/verified-student-session/destination-response";

type RouteContext = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { attemptId } = await context.params;
  const parsedId = uuidSchema.safeParse(attemptId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  let authorization;
  try {
    authorization = await authorizeVerifiedStudentDestination({ destination: "RES", attemptId: parsedId.data }, request);
  } catch {
    return verifiedDestinationUnavailable();
  }
  if (authorization.status === "REJECTED") return verifiedDestinationRejection(authorization);
  const studentId = authorization.status === "AUTHORIZED"
    ? authorization.context.userId
    : (await requireStudent())?.id;
  if (!studentId) return apiFailure({ code: "UNAUTHORIZED", message: "Student session is required" }, 401);

  const attempt = await prisma.attempt.findFirst({
    where: {
      id: parsedId.data,
      userId: studentId,
      ...(authorization.status === "AUTHORIZED" ? {
        accessId: authorization.context.accessId,
        access: { revokedAt: null }
      } : {})
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

  return finalizeVerifiedDestinationResponse(
    apiSuccess({ result: serializeResult(attempt) }),
    authorization
  );
}
