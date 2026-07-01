import { apiFailure, apiSuccess } from "@/lib/api-response";
import { isMockPaymentsEnabled } from "@/lib/payments/mock-payments-enabled";
import { publicCreatePaymentSchema } from "@/lib/payments/payment-schemas";
import { serializePayment } from "@/lib/payments/serialize";
import { findOrCreateStudent } from "@/lib/users/students";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

export async function POST(request: Request) {
  if (!isMockPaymentsEnabled()) {
    return apiFailure({ code: "PAYMENT_PROVIDER_DISABLED", message: "Mock payments are disabled" }, 403);
  }

  const parsed = publicCreatePaymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid payment data",
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
      title: true,
      slug: true,
      price: true,
      currency: true
    }
  });

  if (!test) {
    return apiFailure({ code: "NOT_FOUND", message: "Test not found" }, 404);
  }

  let student;
  try {
    student = await findOrCreateStudent({ email: parsed.data.email });
  } catch {
    return apiFailure({ code: "EMAIL_NOT_AVAILABLE", message: "Email cannot be used for student access" }, 409);
  }

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        userId: student.id,
        testId: test.id,
        amount: test.price,
        currency: test.currency,
        provider: "MOCK",
        status: "PENDING"
      }
    });

    return tx.payment.update({
      where: { id: created.id },
      data: {
        providerPaymentId: `mock_${created.id}`
      },
      include: {
        user: { select: { email: true } },
        test: { select: { title: true, slug: true } },
        access: { select: { id: true } }
      }
    });
  });

  await logEvent({
    eventType: "payment_created",
    actorUserId: student.id,
    entityType: "payment",
    entityId: payment.id,
    payload: {
      testId: test.id,
      provider: "mock",
      amount: test.price,
      currency: test.currency
    }
  });

  return apiSuccess(
    {
      payment: serializePayment(payment),
      mock: {
        paymentId: payment.id,
        webhookPath: "/api/payments/webhook/mock"
      }
    },
    { status: 201 }
  );
}
