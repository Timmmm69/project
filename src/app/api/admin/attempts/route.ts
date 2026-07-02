import { Prisma } from "@prisma/client";
import { z } from "zod";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

const querySchema = z.object({
  testId: z.uuid().optional(),
  email: z.email().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid attempt list parameters",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const where: Prisma.AttemptWhereInput = {
    ...(parsed.data.testId ? { testId: parsed.data.testId } : {}),
    ...(parsed.data.email ? { user: { email: parsed.data.email } } : {})
  };

  const items = await prisma.attempt.findMany({
    where,
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } }
    },
    orderBy: { startedAt: "desc" },
    take: parsed.data.limit
  });

  return apiSuccess({
    items: items.map((attempt) => ({
      id: attempt.id,
      email: attempt.user.email,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      testSlug: attempt.test.slug,
      status: attempt.status.toLowerCase(),
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      rawScore: attempt.rawScore,
      maxRawScore: attempt.maxRawScore,
      percent: attempt.percent === null ? null : Number(attempt.percent),
      level: attempt.level,
      scaledScore: attempt.scaledScore
    }))
  });
}
