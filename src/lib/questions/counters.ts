import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export async function recalculateTestQuestionCounters(
  prisma: PrismaTransaction,
  testId: string
) {
  const aggregate = await prisma.question.aggregate({
    where: {
      testId,
      deletedAt: null
    },
    _count: {
      _all: true
    },
    _sum: {
      points: true
    }
  });

  return prisma.test.update({
    where: { id: testId },
    data: {
      questionsCount: aggregate._count._all,
      maxRawScore: aggregate._sum.points ?? 0
    }
  });
}

export async function getNextQuestionOrderIndex(
  prisma: PrismaTransaction,
  testId: string
) {
  const aggregate = await prisma.question.aggregate({
    where: {
      testId,
      deletedAt: null
    },
    _max: {
      orderIndex: true
    }
  });

  return (aggregate._max.orderIndex ?? 0) + 1;
}

export type QuestionCreateData = Prisma.QuestionUncheckedCreateInput;
