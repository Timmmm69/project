import { Prisma } from "@prisma/client";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { adminAccessListQuerySchema } from "@/lib/access/access-schemas";
import { serializeAccess } from "@/lib/access/access-service";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const url = new URL(request.url);
  const parsed = adminAccessListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid access list parameters",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const where: Prisma.AccessWhereInput = {
    ...(parsed.data.testId ? { testId: parsed.data.testId } : {}),
    ...(parsed.data.email ? { user: { email: parsed.data.email } } : {})
  };

  const items = await prisma.access.findMany({
    where,
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } }
    },
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit
  });

  return apiSuccess({ items: items.map(serializeAccess) });
}
