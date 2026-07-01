import { Prisma } from "@prisma/client";
import { normalizeCorrectAnswer } from "@/lib/questions/normalization";
import { buildTestSnapshot, parseTestSnapshot } from "@/lib/attempts/snapshot";
import { prisma } from "@/server/db/client";
import { logEvent } from "@/server/events/log-event";

function normalizeStudentAnswer(questionType: "single_choice" | "multiple_choice" | "short_text", answer: string | null) {
  if (answer === null) {
    return null;
  }
  return normalizeCorrectAnswer(questionType, answer);
}

export async function getAttemptForStudent(input: {
  attemptId: string;
  studentId: string;
}) {
  return prisma.attempt.findFirst({
    where: {
      id: input.attemptId,
      userId: input.studentId
    },
    include: {
      answers: {
        select: {
          snapshotQuestionId: true,
          selectedAnswer: true,
          answeredAt: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
}

export async function startOrRestoreAttempt(input: {
  studentId: string;
  email: string;
  testId: string;
}) {
  const now = new Date();

  const started = await getStartedAttempt(input.studentId, input.testId);
  if (started) {
    return {
      attempt: started,
      restored: true
    };
  }

  try {
    const attempt = await prisma.$transaction(async (tx) => {
      const existingStarted = await tx.attempt.findFirst({
        where: {
          userId: input.studentId,
          testId: input.testId,
          status: "STARTED",
          access: { revokedAt: null }
        },
        include: {
          answers: {
            select: {
              snapshotQuestionId: true,
              selectedAnswer: true,
              answeredAt: true
            },
            orderBy: { createdAt: "asc" }
          }
        }
      });

      if (existingStarted) {
        return existingStarted;
      }

      const access = await tx.access.findFirst({
        where: {
          userId: input.studentId,
          testId: input.testId,
          revokedAt: null,
          expiresAt: { gt: now },
          attemptsAvailable: { gt: 0 }
        },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }]
      });

      if (!access) {
        throw new Error("NO_ACTIVE_ACCESS");
      }

      const test = await tx.test.findFirst({
        where: {
          id: input.testId,
          deletedAt: null
        },
        include: {
          questions: {
            where: { deletedAt: null },
            orderBy: { orderIndex: "asc" }
          }
        }
      });

      if (!test || test.questions.length === 0) {
        throw new Error("TEST_NOT_AVAILABLE");
      }

      const updatedAccess = await tx.access.updateMany({
        where: {
          id: access.id,
          attemptsAvailable: { gt: 0 },
          revokedAt: null,
          expiresAt: { gt: now }
        },
        data: {
          attemptsAvailable: { decrement: 1 }
        }
      });

      if (updatedAccess.count !== 1) {
        throw new Error("NO_ACTIVE_ACCESS");
      }

      const snapshot = buildTestSnapshot(test);
      return tx.attempt.create({
        data: {
          userId: input.studentId,
          testId: input.testId,
          accessId: access.id,
          status: "STARTED",
          startedAt: now,
          testSnapshot: snapshot as unknown as Prisma.InputJsonValue
        },
        include: {
          answers: {
            select: {
              snapshotQuestionId: true,
              selectedAnswer: true,
              answeredAt: true
            },
            orderBy: { createdAt: "asc" }
          }
        }
      });
    });

    await logEvent({
      eventType: "attempt_started",
      actorUserId: input.studentId,
      entityType: "attempt",
      entityId: attempt.id,
      payload: {
        testId: input.testId,
        email: input.email
      }
    });

    return {
      attempt,
      restored: false
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const attempt = await getStartedAttempt(input.studentId, input.testId);
      if (attempt) {
        return {
          attempt,
          restored: true
        };
      }
    }
    throw error;
  }
}

async function getStartedAttempt(studentId: string, testId: string) {
  return prisma.attempt.findFirst({
    where: {
      userId: studentId,
      testId,
      status: "STARTED",
      access: { revokedAt: null }
    },
    include: {
      answers: {
        select: {
          snapshotQuestionId: true,
          selectedAnswer: true,
          answeredAt: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
}

export async function saveAttemptAnswer(input: {
  attemptId: string;
  studentId: string;
  snapshotQuestionId: string;
  selectedAnswer: string | null;
}) {
  const attempt = await prisma.attempt.findFirst({
    where: {
      id: input.attemptId,
      userId: input.studentId
    }
  });

  if (!attempt) {
    throw new Error("ATTEMPT_NOT_FOUND");
  }
  if (attempt.status !== "STARTED") {
    throw new Error("ATTEMPT_FINISHED");
  }

  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  const question = snapshot.questions.find((item) => item.snapshotQuestionId === input.snapshotQuestionId);
  if (!question) {
    throw new Error("QUESTION_NOT_FOUND");
  }

  const selectedAnswer = normalizeStudentAnswer(question.questionType, input.selectedAnswer);
  const answer = await prisma.answer.upsert({
    where: {
      attemptId_snapshotQuestionId: {
        attemptId: attempt.id,
        snapshotQuestionId: question.snapshotQuestionId
      }
    },
    create: {
      attemptId: attempt.id,
      questionId: question.originalQuestionId,
      snapshotQuestionId: question.snapshotQuestionId,
      questionSnapshot: question as unknown as Prisma.InputJsonValue,
      selectedAnswer,
      maxPoints: question.points,
      answeredAt: selectedAnswer ? new Date() : null
    },
    update: {
      selectedAnswer,
      answeredAt: selectedAnswer ? new Date() : null
    }
  });

  return answer;
}

export async function completeAttempt(input: {
  attemptId: string;
  studentId: string;
  expire: boolean;
}) {
  const now = new Date();
  const attempt = await prisma.attempt.findFirst({
    where: {
      id: input.attemptId,
      userId: input.studentId
    }
  });

  if (!attempt) {
    throw new Error("ATTEMPT_NOT_FOUND");
  }
  if (attempt.status !== "STARTED") {
    return attempt;
  }

  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  const endsAt = new Date(attempt.startedAt.getTime() + snapshot.durationMinutes * 60 * 1000);
  if (input.expire && now < endsAt) {
    throw new Error("ATTEMPT_TIME_NOT_EXPIRED");
  }

  const finishedAt = now;
  const updated = await prisma.attempt.update({
    where: { id: attempt.id },
    data: {
      status: input.expire ? "EXPIRED" : "COMPLETED",
      finishedAt,
      durationSeconds: Math.max(0, Math.floor((finishedAt.getTime() - attempt.startedAt.getTime()) / 1000))
    }
  });

  await logEvent({
    eventType: input.expire ? "attempt_expired" : "attempt_completed",
    actorUserId: input.studentId,
    entityType: "attempt",
    entityId: attempt.id,
    payload: { testId: attempt.testId }
  });

  return updated;
}
