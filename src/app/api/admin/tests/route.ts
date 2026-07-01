import { Prisma } from "@prisma/client";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { toPrismaTestMode, toPrismaTestStatus } from "@/lib/tests/enums";
import { serializeTest } from "@/lib/tests/serialize";
import { adminCreateTestSchema, adminTestListQuerySchema } from "@/lib/tests/test-schemas";
import { appendSlugSuffix, slugifyTitle } from "@/lib/tests/slug";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";
import { logEvent } from "@/server/events/log-event";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const url = new URL(request.url);
  const parsed = adminTestListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Некорректные параметры списка",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const { page, limit, search, status, mode } = parsed.data;
  const where: Prisma.TestWhereInput = {
    deletedAt: null,
    ...(status ? { status: toPrismaTestStatus(status) } : {}),
    ...(mode ? { mode: toPrismaTestMode(mode) } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };

  const [items, total] = await prisma.$transaction([
    prisma.test.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.test.count({ where })
  ]);

  return apiSuccess({
    items: items.map(serializeTest),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  const parsed = adminCreateTestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Некорректные данные теста",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const baseSlug = slugifyTitle(parsed.data.title);
  const existing = await prisma.test.findUnique({ where: { slug: baseSlug }, select: { id: true } });
  const slug = existing ? appendSlugSuffix(baseSlug) : baseSlug;

  const test = await prisma.test.create({
    data: {
      title: parsed.data.title,
      slug,
      subject: "RUSSIAN",
      mode: toPrismaTestMode(parsed.data.mode),
      shortDescription: parsed.data.shortDescription,
      fullDescription: parsed.data.fullDescription,
      price: parsed.data.price,
      currency: parsed.data.currency,
      durationMinutes: parsed.data.durationMinutes,
      attemptsLimit: parsed.data.attemptsLimit,
      accessDays: parsed.data.accessDays,
      createdByAdminId: admin.id
    }
  });

  await logEvent({
    eventType: "test_created",
    actorUserId: admin.id,
    entityType: "test",
    entityId: test.id,
    payload: { title: test.title, slug: test.slug }
  });

  return apiSuccess(serializeTest(test), { status: 201 });
}
