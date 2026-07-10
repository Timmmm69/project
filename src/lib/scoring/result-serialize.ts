import type { Answer, Attempt, Prisma, Test, User } from "@prisma/client";
import { parseTestSnapshot, type SnapshotQuestion } from "@/lib/attempts/snapshot";
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

function serializeCompletedQuestionResult(input: {
  question: SnapshotQuestion;
  answer: Answer | undefined;
  showCorrectAnswers: boolean;
  showTopicReference: boolean;
}) {
  const { question, answer, showCorrectAnswers, showTopicReference } = input;
  const selectedAnswer = answer?.selectedAnswer ?? null;

  return {
    snapshot_question_id: question.snapshotQuestionId,
    order_index: question.orderIndex,
    question_text: question.questionText,
    question_type: question.questionType,
    official_part: question.officialPart ?? null,
    official_number: question.officialNumber ?? null,
    response_subtype: question.responseSubtype ?? null,
    selected_answer: displayAnswer(selectedAnswer),
    normalized_answer: question.questionType === "short_answer_token" ? selectedAnswer : null,
    correct_answer: showCorrectAnswers ? question.correctAnswer : null,
    accepted_answers: showCorrectAnswers ? question.acceptedAnswers ?? null : null,
    topic: showTopicReference ? question.topic : null,
    subtopic: showTopicReference ? question.subtopic : null,
    is_correct: answer?.isCorrect ?? false,
    points_earned: answer?.pointsEarned ?? 0,
    max_points: answer?.maxPoints ?? question.points,
    explanation: showCorrectAnswers ? question.explanation : null
  };
}

export function serializeResult(
  attempt: AttemptResultPayload,
  options: { audience?: ResultAudience } = {}
) {
  const audience = options.audience ?? "student";
  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  // Authentic CE/CT results never expose answer keys. A review mode, if needed,
  // must be introduced separately with its own access policy.
  const isAuthenticRikzRussian = snapshot.examMode === "rikz_russian_2026";
  const showCorrectAnswers =
    !isAuthenticRikzRussian && (audience === "admin" || (attempt.test?.showCorrectAnswers ?? true));
  const showTopicReference = audience === "admin" || showCorrectAnswers;
  const answerByQuestion = new Map(
    attempt.answers
      .filter((answer) => answer.snapshotQuestionId)
      .map((answer) => [answer.snapshotQuestionId as string, answer])
  );

  const answerDetails = snapshot.questions.map((question) =>
    serializeCompletedQuestionResult({
      question,
      answer: answerByQuestion.get(question.snapshotQuestionId),
      showCorrectAnswers,
      showTopicReference
    })
  );
  const mistakes = answerDetails.filter((answer) => !answer.is_correct);

  return {
    attempt_id: attempt.id,
    student_email: attempt.user?.email,
    test_id: attempt.testId,
    test_title: attempt.test?.title ?? snapshot.title,
    test_slug: attempt.test?.slug,
    status: attempt.status.toLowerCase(),
    mode: snapshot.mode,
    exam_mode: snapshot.examMode ?? "generic",
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
    answer_details: answerDetails,
    mistakes
  };
}
