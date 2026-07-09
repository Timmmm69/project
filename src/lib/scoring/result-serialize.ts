import type { Answer, Attempt, Prisma, Test, User } from "@prisma/client";
import { parseTestSnapshot } from "@/lib/attempts/snapshot";
import type { Recommendation, TopicResult } from "@/lib/scoring/scoring-engine";

type AttemptResultPayload = Attempt & {
  user?: Pick<User, "email">;
  test?: Pick<Test, "title" | "slug" | "mode" | "showCorrectAnswers">;
  answers: Answer[];
};

type ResultAudience = "student" | "admin";

function jsonArray<T>(value: Prisma.JsonValue | null): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value);
}

function displayAnswer(answer: string | null) {
  return answer && answer.trim().length > 0 ? answer : "Ответ не дан";
}

function scaledScoreNote(snapshot: ReturnType<typeof parseTestSnapshot>, attempt: AttemptResultPayload) {
  if (snapshot.mode !== "ce_ct") {
    return null;
  }

  if (attempt.scaledScore !== null) {
    return "Тренировочный расчёт по таблице соответствия первичных и тестовых баллов РИКЗ. Не является официальным результатом ЦЭ/ЦТ.";
  }

  if ((attempt.maxRawScore ?? snapshot.maxRawScore) !== 80) {
    return "Тестовый балл не рассчитывается для неполного теста. Для расчёта по шкале РИКЗ нужен полный тест с максимумом 80 первичных баллов.";
  }

  return "Тестовый балл не рассчитан: для этой попытки нет подходящей шкалы РИКЗ.";
}

export function serializeResult(
  attempt: AttemptResultPayload,
  options: { audience?: ResultAudience } = {}
) {
  const audience = options.audience ?? "student";
  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  const showCorrectAnswers = audience === "admin" || (attempt.test?.showCorrectAnswers ?? true);
  const showTopicReference = audience === "admin" || showCorrectAnswers;
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
        correct_answer: showCorrectAnswers ? question.correctAnswer : null,
        topic: showTopicReference ? question.topic : null,
        subtopic: showTopicReference ? question.subtopic : null,
        points_earned: answer?.pointsEarned ?? 0,
        max_points: answer?.maxPoints ?? question.points,
        explanation: showCorrectAnswers ? question.explanation : null
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
    percent: audience === "admin" ? decimalToNumber(attempt.percent) : null,
    level: audience === "admin" ? attempt.level : null,
    scaled_score: attempt.scaledScore,
    max_scaled_score: attempt.maxScaledScore,
    scaled_score_note: scaledScoreNote(snapshot, attempt),
    topic_results: audience === "admin" ? jsonArray<TopicResult>(attempt.topicResults) : [],
    recommendations: audience === "admin" ? jsonArray<Recommendation>(attempt.recommendations) : [],
    mistakes
  };
}
