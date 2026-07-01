import { Prisma } from "@prisma/client";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { generateAccessCode, hashAccessCode } from "@/lib/access/access-codes";
import { adminAccessCodeListQuerySchema, adminCreateAccessCodeSchema } from "@/lib/access/access-schemas";
import { serializeAccessCode } from "@/lib/access/access-code-serialize";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

const statusMap = {
  active: "ACTIVE",
  used: "USED",
  expired: "EXPIRED",
  revoked: "REVOKED"
} as const;

function addDays(days: number) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

async function generateUniqueCode() {
  for (let index = 0; index < 5; index += 1) {
    const code = generateAccessCode();
    const codeHash = hashAccessCode(code);
    const existing = await prisma.accessCode.findUnique({
      where: { codeHash },
      select: { id: true }
    });
    if (!existing) {
      return { code, codeHash };
    }
  }
  throw new Error("ACCESS_CODE_GENERATION_FAILED");
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const url = new URL(request.url);
  const parsed = adminAccessCodeListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid access code list parameters",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const where: Prisma.AccessCodeWhereInput = {
    ...(parsed.data.testId ? { testId: parsed.data.testId } : {}),
    ...(parsed.data.status ? { status: statusMap[parsed.data.status] } : {})
  };

  const items = await prisma.accessCode.findMany({
    where,
    include: {
      test: { select: { title: true, slug: true } },
      activatedByUser: { select: { email: true } },
      access: { select: { id: true } }
    },
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit
  });

  return apiSuccess({ items: items.map(serializeAccessCode) });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const parsed = adminCreateAccessCodeSchema.safeParse(await request.json().catch(() => null));
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

  const test = await prisma.test.findFirst({
    where: {
      id: parsed.data.testId,
      status: "PUBLISHED",
      deletedAt: null
    },
    select: { id: true }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Published test not found" }, 404);
  }

  const { code, codeHash } = await generateUniqueCode();
  const accessCode = await prisma.accessCode.create({
    data: {
      codeHash,
      testId: parsed.data.testId,
      createdByAdminId: admin.id,
      attemptsTotal: parsed.data.attemptsTotal,
      accessDays: parsed.data.accessDays,
      codeExpiresAt: addDays(parsed.data.codeExpiresDays),
      comment: parsed.data.comment
    },
    include: {
      test: { select: { title: true, slug: true } },
      activatedByUser: { select: { email: true } },
      access: { select: { id: true } }
    }
  });

  await logEvent({
    eventType: "access_code_created",
    actorUserId: admin.id,
    entityType: "access_code",
    entityId: accessCode.id,
    payload: {
      testId: parsed.data.testId,
      attemptsTotal: parsed.data.attemptsTotal,
      accessDays: parsed.data.accessDays
    }
  });

  return apiSuccess(
    {
      accessCode: serializeAccessCode(accessCode),
      code
    },
    { status: 201 }
  );
}
