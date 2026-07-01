import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

type Tx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

function addDays(days: number) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

export async function createAccessFromPayment(input: {
  paymentId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: input.paymentId },
      include: { test: true, user: true, access: true }
    });

    if (payment.status !== "SUCCESS") {
      throw new Error("PAYMENT_NOT_SUCCESS");
    }

    if (payment.access) {
      return payment.access;
    }

    return tx.access.create({
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
  });
}

export async function createManualAccess(
  tx: Tx,
  input: {
    adminId: string;
    userId: string;
    testId: string;
    attemptsTotal: number;
    accessDays: number;
    comment?: string | null;
  }
) {
  const access = await tx.access.create({
    data: {
      userId: input.userId,
      testId: input.testId,
      source: "MANUAL",
      attemptsTotal: input.attemptsTotal,
      attemptsAvailable: input.attemptsTotal,
      expiresAt: addDays(input.accessDays),
      createdByAdminId: input.adminId
    }
  });

  await tx.manualAccessLog.create({
    data: {
      adminId: input.adminId,
      userId: input.userId,
      testId: input.testId,
      accessId: access.id,
      attemptsTotal: input.attemptsTotal,
      accessDays: input.accessDays,
      comment: input.comment ?? null
    }
  });

  return access;
}

export type AccessWithRelations = Prisma.AccessGetPayload<{
  include: {
    user: { select: { email: true } };
    test: { select: { title: true; slug: true } };
  };
}>;

export function serializeAccess(access: AccessWithRelations) {
  return {
    id: access.id,
    userId: access.userId,
    email: access.user.email,
    testId: access.testId,
    testTitle: access.test.title,
    testSlug: access.test.slug,
    source: access.source.toLowerCase(),
    attemptsTotal: access.attemptsTotal,
    attemptsAvailable: access.attemptsAvailable,
    expiresAt: access.expiresAt,
    revokedAt: access.revokedAt,
    revokedReason: access.revokedReason,
    createdAt: access.createdAt
  };
}
