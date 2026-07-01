import { apiFailure, apiSuccess } from "@/lib/api-response";
import { serializePayment } from "@/lib/payments/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { prisma } from "@/server/db/client";

type RouteContext = {
  params: Promise<{
    paymentId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { paymentId } = await context.params;
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Payment not found" }, 404);
  }

  const payment = await prisma.payment.findUnique({
    where: { id: parsedId.data },
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } },
      access: { select: { id: true } }
    }
  });

  if (!payment) {
    return apiFailure({ code: "NOT_FOUND", message: "Payment not found" }, 404);
  }

  return apiSuccess({ payment: serializePayment(payment) });
}
