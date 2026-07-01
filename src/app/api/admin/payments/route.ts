import { Prisma } from "@prisma/client";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { adminPaymentListQuerySchema } from "@/lib/payments/payment-schemas";
import { serializePayment } from "@/lib/payments/serialize";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

const statusMap = {
  pending: "PENDING",
  success: "SUCCESS",
  failed: "FAILED",
  cancelled: "CANCELLED",
  refunded: "REFUNDED"
} as const;

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const url = new URL(request.url);
  const parsed = adminPaymentListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid payment list parameters",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const where: Prisma.PaymentWhereInput = {
    ...(parsed.data.testId ? { testId: parsed.data.testId } : {}),
    ...(parsed.data.status ? { status: statusMap[parsed.data.status] } : {}),
    ...(parsed.data.email ? { user: { email: parsed.data.email } } : {})
  };

  const items = await prisma.payment.findMany({
    where,
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } },
      access: { select: { id: true } }
    },
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit
  });

  return apiSuccess({ items: items.map(serializePayment) });
}
