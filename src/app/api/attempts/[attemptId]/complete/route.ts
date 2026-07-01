import { apiFailure, apiSuccess } from "@/lib/api-response";
import { completeAttempt } from "@/lib/attempts/attempt-service";
import { serializeAttemptSummary } from "@/lib/attempts/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireStudent } from "@/server/auth/student-session";

type RouteContext = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const student = await requireStudent();
  if (!student) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Student session is required" }, 401);
  }

  const { attemptId } = await context.params;
  const parsedId = uuidSchema.safeParse(attemptId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  try {
    const attempt = await completeAttempt({
      attemptId: parsedId.data,
      studentId: student.id,
      expire: false
    });

    return apiSuccess({
      attempt: serializeAttemptSummary(attempt),
      resultUrl: `/results/${attempt.id}`
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ATTEMPT_COMPLETE_FAILED";
    const status = code === "ATTEMPT_NOT_FOUND" ? 404 : 409;
    return apiFailure({ code, message: code === "ATTEMPT_NOT_FOUND" ? "Attempt not found" : "Attempt cannot be completed" }, status);
  }
}
