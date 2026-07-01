import { apiFailure, apiSuccess } from "@/lib/api-response";
import { hashAccessCode } from "@/lib/access/access-codes";
import { publicActivateAccessCodeSchema } from "@/lib/access/access-schemas";
import { findOrCreateStudent } from "@/lib/users/students";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

function addDays(days: number) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

export async function POST(request: Request) {
  const parsed = publicActivateAccessCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid access code data",
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

  const codeHash = hashAccessCode(parsed.data.code);
  const now = new Date();

  try {
    const access = await prisma.$transaction(async (tx) => {
      const code = await tx.accessCode.findFirst({
        where: {
          codeHash,
          testId: parsed.data.testId
        },
        include: { test: true }
      });

      if (!code) {
        throw new Error("ACCESS_CODE_INVALID");
      }
      if (code.status !== "ACTIVE" || code.activatedAt || code.revokedAt) {
        throw new Error("ACCESS_CODE_USED");
      }
      if (code.codeExpiresAt <= now) {
        await tx.accessCode.update({
          where: { id: code.id },
          data: { status: "EXPIRED" }
        });
        throw new Error("ACCESS_CODE_EXPIRED");
      }
      if (code.test.status !== "PUBLISHED" || code.test.deletedAt) {
        throw new Error("TEST_NOT_AVAILABLE");
      }

      const claimed = await tx.accessCode.updateMany({
        where: {
          id: code.id,
          status: "ACTIVE",
          activatedAt: null,
          codeExpiresAt: { gt: now }
        },
        data: {
          status: "USED",
          activatedByUserId: student.id,
          activatedAt: now
        }
      });

      if (claimed.count !== 1) {
        throw new Error("ACCESS_CODE_USED");
      }

      return tx.access.create({
        data: {
          userId: student.id,
          testId: code.testId,
          accessCodeId: code.id,
          source: "ACCESS_CODE",
          attemptsTotal: code.attemptsTotal,
          attemptsAvailable: code.attemptsTotal,
          expiresAt: addDays(code.accessDays)
        }
      });
    });

    await logEvent({
      eventType: "access_code_activated",
      actorUserId: student.id,
      entityType: "access",
      entityId: access.id,
      payload: {
        testId: parsed.data.testId
      }
    });

    return apiSuccess({
      access: {
        id: access.id,
        attemptsTotal: access.attemptsTotal,
        attemptsAvailable: access.attemptsAvailable,
        expiresAt: access.expiresAt
      }
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ACCESS_CODE_INVALID";
    const messages: Record<string, string> = {
      ACCESS_CODE_INVALID: "Access code is invalid",
      ACCESS_CODE_USED: "Access code has already been used",
      ACCESS_CODE_EXPIRED: "Access code expired",
      TEST_NOT_AVAILABLE: "Test is not available"
    };
    const status = code === "TEST_NOT_AVAILABLE" ? 404 : 409;
    return apiFailure({ code, message: messages[code] ?? "Access code cannot be activated" }, status);
  }
}
