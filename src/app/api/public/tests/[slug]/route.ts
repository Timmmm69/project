import { apiFailure, apiSuccess } from "@/lib/api-response";
import { serializePublicTest } from "@/lib/public-tests/serialize";
import { prisma } from "@/server/db/client";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const test = await prisma.test.findFirst({
    where: {
      slug,
      status: "PUBLISHED",
      deletedAt: null
    }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Test not found" }, 404);
  }

  return apiSuccess(serializePublicTest(test));
}
