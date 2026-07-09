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
    providerInvoiceId: payment.providerInvoiceId,
    providerAccountNumber: payment.providerAccountNumber,
    paymentUrl: payment.paymentUrl,
    qrCodeUrl: payment.qrCodeUrl,
    qrCodePayload: payment.qrCodePayload,
    paymentInstructions: payment.paymentInstructions,
    providerStatus: payment.providerStatus,
    accessId: payment.access?.id ?? null,
    accessCreated: Boolean(payment.access?.id),
    npdReceiptRequired: payment.npdReceiptRequired,
    npdReceiptCreated: payment.npdReceiptCreated,
    npdReceiptCreatedAt: payment.npdReceiptCreatedAt,
    npdReceiptNote: payment.npdReceiptNote,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
    failedAt: payment.failedAt,
    cancelledAt: payment.cancelledAt,
    expiredAt: payment.expiredAt
  };
}
