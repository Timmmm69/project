import { apiFailure, apiSuccess } from "@/lib/api-response";
import { checkStudentAccess, serializeAccessCheckResult } from "@/lib/access/access-check";
import { accessCheckSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";
import { parseVerifiedCommercialSessionMode } from "@/server/auth/verified-student-session/config";

export async function POST(request: Request) {
  const parsed = accessCheckSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid access check data",
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
    select: {
      id: true,
      examMode: true,
      commercialProducts: { select: { id: true }, take: 1 }
    }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Test not found" }, 404);
  }

  const authentic = test.examMode === "RIKZ_RUSSIAN_2026" || test.commercialProducts.length > 0;
  if (authentic &&
    parseVerifiedCommercialSessionMode(process.env.VERIFIED_COMMERCIAL_SESSION_MODE) === "enforce") {
    return apiSuccess({
      hasAccess: false,
      status: "no_access",
      userId: null,
      access: null,
      attempt: null
    });
  }

  const result = await checkStudentAccess(parsed.data);
  return apiSuccess(serializeAccessCheckResult(result));
}
