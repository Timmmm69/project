import { apiSuccess } from "@/lib/api-response";
import { serializePublicTest } from "@/lib/public-tests/serialize";
import { prisma } from "@/server/db/client";

export async function GET() {
  const tests = await prisma.test.findMany({
    where: {
      status: "PUBLISHED",
      deletedAt: null
    },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }]
  });

  return apiSuccess({
    items: tests.map(serializePublicTest)
  });
}
