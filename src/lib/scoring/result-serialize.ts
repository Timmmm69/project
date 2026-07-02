import type { Answer, Attempt, Prisma, Test, User } from "@prisma/client";
import { parseTestSnapshot } from "@/lib/attempts/snapshot";
import type { Recommendation, TopicResult } from "@/lib/scoring/scoring-engine";

type AttemptResultPayload = Attempt & {
  user?: Pick<User, "email">;
  test?: Pick<Test, "title" | "slug" | "mode" | "showPercent" | "showCorrectAnswers" | "showTopicResult" | "showRecommendations">;
  answers: Answer[];
};

function jsonArray<T>(value: Prisma.JsonValue | null): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value);
}

function displayAnswer(answer: string | null) {
  return answer && answer.trim().length > 0 ? answer : "Ответ не дан";
}

export function serializeResult(attempt: AttemptResultPayload) {
  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  const answerByQuestion = new Map(
    attempt.answers
      .filter((answer) => answer.snapshotQuestionId)
      .map((answer) => [answer.snapshotQuestionId as string, answer])
  );

  const mistakes = snapshot.questions.flatMap((question) => {
    const answer = answerByQuestion.get(question.snapshotQuestionId);
    if (answer?.isCorrect) {
      return [];
    }

    return [
      {
        snapshot_question_id: question.snapshotQuestionId,
        order_index: question.orderIndex,
        question_text: question.questionText,
        question_type: question.questionType,
        selected_answer: displayAnswer(answer?.selectedAnswer ?? null),
        correct_answer: question.correctAnswer,
        topic: question.topic,
        subtopic: question.subtopic,
        points_earned: answer?.pointsEarned ?? 0,
        max_points: answer?.maxPoints ?? question.points,
        explanation: question.explanation
      }
    ];
  });

  return {
    attempt_id: attempt.id,
    student_email: attempt.user?.email,
    test_id: attempt.testId,
    test_title: attempt.test?.title ?? snapshot.title,
    test_slug: attempt.test?.slug,
    status: attempt.status.toLowerCase(),
    mode: snapshot.mode,
    started_at: attempt.startedAt,
    finished_at: attempt.finishedAt,
    duration_seconds: attempt.durationSeconds,
    raw_score: attempt.rawScore,
    max_raw_score: attempt.maxRawScore,
    percent: decimalToNumber(attempt.percent),
    level: attempt.level,
    scaled_score: attempt.scaledScore,
    max_scaled_score: attempt.maxScaledScore,
    scaled_score_note:
      attempt.scaledScore === null
        ? null
        : "Тренировочный расчёт по таблице соответствия первичных и тестовых баллов.",
    topic_results: jsonArray<TopicResult>(attempt.topicResults),
    recommendations: jsonArray<Recommendation>(attempt.recommendations),
    mistakes
  };
}
