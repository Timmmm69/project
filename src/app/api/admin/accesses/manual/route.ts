import { apiFailure, apiSuccess } from "@/lib/api-response";
import { adminCreateManualAccessSchema } from "@/lib/access/access-schemas";
import { createManualAccess, serializeAccess } from "@/lib/access/access-service";
import { findOrCreateStudent } from "@/lib/users/students";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { sendAccessEmail } from "@/server/emails/send-access-email";
import { logEvent } from "@/server/events/log-event";

function testLink(request: Request, slug: string) {
  const url = new URL(request.url);
  return `${url.origin}/tests/${slug}`;
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const parsed = adminCreateManualAccessSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid manual access data",
        details: parsed.error.flatten()
      },
      422
    );
  }

  let student;
  try {
    student = await findOrCreateStudent({ email: parsed.data.email });
  } catch {
    return apiFailure({ code: "EMAIL_NOT_AVAILABLE", message: "Email cannot be used for student access" }, 409);
  }

  const test = await prisma.test.findFirst({
    where: {
      id: parsed.data.testId,
      status: "PUBLISHED",
      deletedAt: null
    },
    select: {
      id: true,
      title: true,
      slug: true
    }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Published test not found" }, 404);
  }

  const access = await prisma.$transaction((tx) =>
    createManualAccess(tx, {
      adminId: admin.id,
      userId: student.id,
      testId: test.id,
      attemptsTotal: parsed.data.attemptsTotal,
      accessDays: parsed.data.accessDays,
      comment: parsed.data.comment
    })
  );

  const accessWithRelations = await prisma.access.findUniqueOrThrow({
    where: { id: access.id },
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } }
    }
  });

  await logEvent({
    eventType: "manual_access_created",
    actorUserId: admin.id,
    entityType: "access",
    entityId: access.id,
    payload: {
      testId: test.id,
      userId: student.id
    }
  });

  try {
    await sendAccessEmail({
      userId: student.id,
      email: student.email,
      type: "manual_access",
      testTitle: test.title,
      testLink: testLink(request, test.slug),
      attemptsTotal: access.attemptsTotal,
      expiresAt: access.expiresAt
    });
  } catch (error) {
    await logEvent({
      eventType: "email_send_failed",
      actorUserId: admin.id,
      entityType: "access",
      entityId: access.id,
      payload: { reason: error instanceof Error ? error.message : String(error) }
    });
  }

  return apiSuccess({ access: serializeAccess(accessWithRelations) }, { status: 201 });
}
