import { apiFailure, apiSuccess } from "@/lib/api-response";
import { adminRevokeAccessSchema } from "@/lib/access/access-schemas";
import { serializeAccess } from "@/lib/access/access-service";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    accessId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const { accessId } = await context.params;
  const parsedId = uuidSchema.safeParse(accessId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Access not found" }, 404);
  }

  const parsed = adminRevokeAccessSchema.safeParse(await request.json().catch(() => ({})));
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

  const existing = await prisma.access.findUnique({
    where: { id: parsedId.data },
    select: { id: true, revokedAt: true }
  });

  if (!existing) {
    return apiFailure({ code: "NOT_FOUND", message: "Access not found" }, 404);
  }

  const access = await prisma.access.update({
    where: { id: existing.id },
    data: existing.revokedAt
      ? {}
      : {
          revokedAt: new Date(),
          revokedByAdminId: admin.id,
          revokedReason: parsed.data.reason ?? null
        },
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } }
    }
  });

  if (!existing.revokedAt) {
    await logEvent({
      eventType: "access_revoked",
      actorUserId: admin.id,
      entityType: "access",
      entityId: access.id,
      payload: { reason: parsed.data.reason ?? null }
    });
  }

  return apiSuccess({ access: serializeAccess(access) });
}
