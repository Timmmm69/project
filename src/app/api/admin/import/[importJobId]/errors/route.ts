import { apiFailure, apiSuccess } from "@/lib/api-response";
import { serializeImportJob } from "@/lib/imports/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { requireAdmin } from "@/server/auth/session";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login required" }, 401);
  }

  const { importJobId } = await context.params;
  const parsedId = uuidSchema.safeParse(importJobId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Import job not found" }, 404);
  }

  const job = await prisma.importJob.findFirst({
    where: { id: parsedId.data, adminId: admin.id }
  });
  if (!job) {
    return apiFailure({ code: "NOT_FOUND", message: "Import job not found" }, 404);
  }

  return apiSuccess(serializeImportJob(job));
}
