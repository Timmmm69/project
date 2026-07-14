import { apiFailure, apiSuccess } from "@/lib/api-response";
import { saveAttemptAnswerSchema } from "@/lib/attempts/attempt-schemas";
import { saveAttemptAnswer } from "@/lib/attempts/attempt-service";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireStudent } from "@/server/auth/student-session";
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

export async function POST(request: Request, context: RouteContext) {
  const { attemptId } = await context.params;
  const parsedId = uuidSchema.safeParse(attemptId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  let authorization;
  try {
    authorization = await authorizeVerifiedStudentDestination({
      destination: "ATT",
      attemptId: parsedId.data
    }, request);
  } catch {
    return verifiedDestinationUnavailable();
  }
  if (authorization.status === "REJECTED") {
    return verifiedDestinationRejection(authorization);
  }
  const studentId = authorization.status === "AUTHORIZED"
    ? authorization.context.userId
    : (await requireStudent())?.id;
  if (!studentId) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Student session is required" }, 401);
  }

  const parsed = saveAttemptAnswerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid answer data",
        details: parsed.error.flatten()
      },
      422
    );
  }

  try {
    const answer = await saveAttemptAnswer({
      attemptId: parsedId.data,
      studentId,
      ...(authorization.status === "AUTHORIZED"
        ? { authorizedAccessId: authorization.context.accessId }
        : {}),
      snapshotQuestionId: parsed.data.snapshotQuestionId,
      selectedAnswer: parsed.data.selectedAnswer
    });

    return finalizeVerifiedDestinationResponse(apiSuccess({
      saved: true,
      answer: {
        snapshotQuestionId: answer.snapshotQuestionId,
        selectedAnswer: answer.selectedAnswer,
        answeredAt: answer.answeredAt
      }
    }), authorization);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ANSWER_SAVE_FAILED";
    const messages: Record<string, string> = {
      ATTEMPT_NOT_FOUND: "Attempt not found",
      ATTEMPT_FINISHED: "Attempt is already finished",
      QUESTION_NOT_FOUND: "Question not found in attempt snapshot"
    };
    const status = code === "ATTEMPT_NOT_FOUND" || code === "QUESTION_NOT_FOUND" ? 404 : 409;
    return apiFailure({ code, message: messages[code] ?? "Answer cannot be saved" }, status);
  }
}
