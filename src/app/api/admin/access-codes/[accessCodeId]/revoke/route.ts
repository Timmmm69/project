import { apiFailure, apiSuccess } from "@/lib/api-response";
import { adminRevokeAccessCodeSchema } from "@/lib/access/access-schemas";
import { serializeAccessCode } from "@/lib/access/access-code-serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    accessCodeId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const { accessCodeId } = await context.params;
  const parsedId = uuidSchema.safeParse(accessCodeId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Access code not found" }, 404);
  }

  const parsed = adminRevokeAccessCodeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid revoke data",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const existing = await prisma.accessCode.findUnique({
    where: { id: parsedId.data },
    select: { id: true, status: true, revokedAt: true }
  });

  if (!existing) {
    return apiFailure({ code: "NOT_FOUND", message: "Access code not found" }, 404);
  }
  if (existing.status === "USED") {
    return apiFailure({ code: "ACCESS_CODE_USED", message: "Used access code cannot be revoked" }, 409);
  }

  const accessCode = await prisma.accessCode.update({
    where: { id: existing.id },
    data:
      existing.status === "REVOKED"
        ? {}
        : {
            status: "REVOKED",
            revokedAt: new Date(),
            revokedByAdminId: admin.id,
            revokedReason: parsed.data.reason ?? null
          },
    include: {
      test: { select: { title: true, slug: true } },
      activatedByUser: { select: { email: true } },
      access: { select: { id: true } }
    }
  });

  if (existing.status !== "REVOKED") {
    await logEvent({
      eventType: "access_code_revoked",
      actorUserId: admin.id,
      entityType: "access_code",
      entityId: accessCode.id,
      payload: { reason: parsed.data.reason ?? null }
    });
  }

  return apiSuccess({ accessCode: serializeAccessCode(accessCode) });
}
