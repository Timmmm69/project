import { prisma } from "@/server/db/client";

function addDays(days: number) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

export async function applyMockPaymentWebhook(input: {
  paymentId: string;
  status: "success" | "failed";
}) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: input.paymentId },
      include: {
        test: true,
        user: true,
        access: true
      }
    });

    if (payment.provider !== "MOCK") {
      throw new Error("PAYMENT_PROVIDER_NOT_MOCK");
    }

    if (payment.status === "SUCCESS") {
      return {
        payment,
        access: payment.access,
        createdAccess: false,
        statusChanged: false
      };
    }

    if (input.status === "failed") {
      const failedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failedAt: payment.failedAt ?? now,
          providerPayload: {
            mockStatus: "failed",
            receivedAt: now.toISOString()
          }
        },
        include: {
          test: { select: { title: true, slug: true } },
          user: { select: { email: true } },
          access: { select: { id: true } }
        }
      });

      return {
        payment: failedPayment,
        access: null,
        createdAccess: false,
        statusChanged: true
      };
    }

    const successPayment = await tx.payment.update({
      where: { id: payment.id },
        data: {
          status: "SUCCESS",
          paidAt: payment.paidAt ?? now,
          providerPayload: {
            mockStatus: "success",
            receivedAt: now.toISOString()
          }
        },
        include: {
        test: { select: { title: true, slug: true, attemptsLimit: true, accessDays: true } },
        user: { select: { id: true, email: true } },
        access: { select: { id: true } }
      }
    });

    if (successPayment.access) {
      return {
        payment: successPayment,
        access: successPayment.access,
        createdAccess: false,
        statusChanged: true
      };
    }

    const access = await tx.access.create({
      data: {
        userId: payment.userId,
        testId: payment.testId,
        paymentId: payment.id,
        source: "PAYMENT",
        attemptsTotal: payment.test.attemptsLimit,
        attemptsAvailable: payment.test.attemptsLimit,
        expiresAt: addDays(payment.test.accessDays)
      }
    });

    return {
      payment: successPayment,
      access,
      createdAccess: true,
      statusChanged: true
    };
  });
}
