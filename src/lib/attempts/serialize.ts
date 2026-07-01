import type { Answer, Attempt, Prisma } from "@prisma/client";
import { parseTestSnapshot, serializeQuestionForStudent } from "@/lib/attempts/snapshot";

type AttemptForStudent = Attempt & {
  answers: Pick<Answer, "snapshotQuestionId" | "selectedAnswer" | "answeredAt">[];
};

export function attemptEndsAt(attempt: Pick<Attempt, "startedAt" | "testSnapshot">) {
  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  return new Date(attempt.startedAt.getTime() + snapshot.durationMinutes * 60 * 1000);
}

export function serializeAttemptForStudent(attempt: AttemptForStudent, serverNow = new Date()) {
  const snapshot = parseTestSnapshot(attempt.testSnapshot as Prisma.JsonValue);
  return {
    attemptId: attempt.id,
    testId: attempt.testId,
    status: attempt.status.toLowerCase(),
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMinutes: snapshot.durationMinutes,
    endsAt: attemptEndsAt(attempt),
    serverNow,
    answers: attempt.answers.map((answer) => ({
      snapshotQuestionId: answer.snapshotQuestionId,
      selectedAnswer: answer.selectedAnswer,
      answeredAt: answer.answeredAt
    })),
    questions: snapshot.questions.map(serializeQuestionForStudent)
  };
}

export function serializeAttemptSummary(attempt: Pick<Attempt, "id" | "status" | "startedAt" | "finishedAt">) {
  return {
    attemptId: attempt.id,
    status: attempt.status.toLowerCase(),
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt
  };
}
