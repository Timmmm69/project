import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAttemptForStudent } from "@/lib/attempts/attempt-service";
import { serializeAttemptForStudent } from "@/lib/attempts/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireStudent } from "@/server/auth/student-session";

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

  const attempt = await getAttemptForStudent({
    attemptId: parsedId.data,
    studentId: student.id
  });

  if (!attempt) {
    return apiFailure({ code: "NOT_FOUND", message: "Attempt not found" }, 404);
  }

  return apiSuccess({ attempt: serializeAttemptForStudent(attempt) });
}
