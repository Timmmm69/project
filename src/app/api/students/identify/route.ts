import { apiFailure, apiSuccess } from "@/lib/api-response";
import { studentIdentifySchema } from "@/lib/validation/schemas";
import { setStudentSessionCookie } from "@/server/auth/student-session";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

export async function POST(request: Request) {
  const parsed = studentIdentifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid student data",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      deletedAt: true
    }
  });

  if (existing && (existing.role !== "STUDENT" || existing.deletedAt)) {
    return apiFailure({ code: "EMAIL_NOT_AVAILABLE", message: "Email cannot be used for student access" }, 409);
  }

  const student =
    existing ??
    (await prisma.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        role: "STUDENT"
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true
      }
    }));

  if (!existing) {
    await logEvent({
      eventType: "student_identified",
      actorUserId: student.id,
      entityType: "user",
      entityId: student.id,
      payload: { email: student.email }
    });
  }

  await setStudentSessionCookie({
    userId: student.id,
    email: student.email,
    role: "STUDENT"
  });

  return apiSuccess({
    student: {
      id: student.id,
      email: student.email,
      name: student.name
    }
  });
}
