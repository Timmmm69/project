import type { Prisma } from "@prisma/client";

export type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: {
    user: { select: { email: true } };
    test: { select: { title: true; slug: true } };
    access: { select: { id: true } };
  };
}>;

export function serializePayment(payment: PaymentWithRelations) {
  return {
    id: payment.id,
    userId: payment.userId,
    email: payment.user.email,
    testId: payment.testId,
    testTitle: payment.test.title,
    testSlug: payment.test.slug,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status.toLowerCase(),
    provider: payment.provider.toLowerCase(),
    providerPaymentId: payment.providerPaymentId,
    accessId: payment.access?.id ?? null,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
    failedAt: payment.failedAt
  };
}
