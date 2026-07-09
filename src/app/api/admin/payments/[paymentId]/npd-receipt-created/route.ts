import { apiFailure, apiSuccess } from "@/lib/api-response";
import { adminNpdReceiptCreatedSchema } from "@/lib/payments/payment-schemas";
import { serializePayment } from "@/lib/payments/serialize";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

type RouteContext = {
  params: Promise<{
    paymentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Admin login is required" }, 401);
  }

  const { paymentId } = await context.params;
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return apiFailure({ code: "NOT_FOUND", message: "Payment not found" }, 404);
  }

  const parsed = adminNpdReceiptCreatedSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid NPD receipt data",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const payment = await prisma.payment.update({
    where: { id: parsedId.data },
    data: {
      npdReceiptRequired: true,
      npdReceiptCreated: true,
      npdReceiptCreatedAt: new Date(),
      npdReceiptNote: parsed.data.note ?? null
    },
    include: {
      user: { select: { email: true } },
      test: { select: { title: true, slug: true } },
      access: { select: { id: true } }
    }
  });

  await logEvent({
    eventType: "npd_receipt_marked_created",
    actorUserId: admin.id,
    entityType: "payment",
    entityId: payment.id,
    payload: {
      note: parsed.data.note ?? null
    }
  });

  return apiSuccess({ payment: serializePayment(payment) });
}
