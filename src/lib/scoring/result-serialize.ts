import type { Answer, Attempt, Prisma, Test, User } from "@prisma/client";
import { parseTestSnapshot, type SnapshotQuestion } from "@/lib/attempts/snapshot";
import type { Recommendation, TopicResult } from "@/lib/scoring/scoring-engine";

type AttemptResultPayload = Attempt & {
  user?: Pick<User, "email">;
  test?: Pick<Test, "title" | "slug" | "mode" | "showCorrectAnswers">;
  answers: Answer[];
};

type ResultAudience = "student" | "admin";

export type AuthenticStudentResultPayload = Readonly<{
  status: "completed" | "expired";
  mode: "ce_ct";
  exam_mode: "rikz_russian_2026";
  raw_score: number;
  max_raw_score: number;
  part_a_score: number;
  part_a_max_score: number;
  part_b_score: number;
  part_b_max_score: number;
}>;

export class ResultProjectionNotReadyError extends Error {
  constructor() {
    super("RESULT_PROJECTION_NOT_READY");
    this.name = "ResultProjectionNotReadyError";
  }
}

function shouldIncludeScaledResultFields(input: {
  audience: ResultAudience;
  snapshotExamMode: ReturnType<typeof parseTestSnapshot>["examMode"];
}) {
  return input.audience === "admin" || input.snapshotExamMode !== "rikz_russian_2026";
}

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

function projectionNotReady(): never {
  throw new ResultProjectionNotReadyError();
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function serializeAuthenticStudentResult(
  attempt: AttemptResultPayload,
  snapshot: ReturnType<typeof parseTestSnapshot>
): AuthenticStudentResultPayload {
  if (attempt.status !== "COMPLETED" && attempt.status !== "EXPIRED") projectionNotReady();
  if (snapshot.mode !== "ce_ct" || snapshot.examMode !== "rikz_russian_2026") projectionNotReady();
  if (snapshot.maxRawScore !== 80) projectionNotReady();
  if (!Array.isArray(snapshot.questions) || snapshot.questions.length !== 40) projectionNotReady();
  if (
    !finiteNonNegative(attempt.rawScore)
    || !finiteNonNegative(attempt.maxRawScore)
    || attempt.rawScore > attempt.maxRawScore
  ) {
    projectionNotReady();
  }

  const questionsById = new Map<string, SnapshotQuestion>();
  let partACount = 0;
  let partBCount = 0;
  for (const question of snapshot.questions) {
    if (
      !question
      || typeof question.snapshotQuestionId !== "string"
      || question.snapshotQuestionId.length === 0
      || questionsById.has(question.snapshotQuestionId)
      || !finiteNonNegative(question.points)
    ) {
      projectionNotReady();
    }
    if (question.officialPart === "A") partACount += 1;
    else if (question.officialPart === "B") partBCount += 1;
    else projectionNotReady();
    questionsById.set(question.snapshotQuestionId, question);
  }
  if (partACount !== 18 || partBCount !== 22) projectionNotReady();

  const answerByQuestion = new Map<string, Answer>();
  for (const answer of attempt.answers) {
    const snapshotQuestionId = answer.snapshotQuestionId;
    if (
      typeof snapshotQuestionId !== "string"
      || !questionsById.has(snapshotQuestionId)
      || answerByQuestion.has(snapshotQuestionId)
    ) {
      projectionNotReady();
    }
    answerByQuestion.set(snapshotQuestionId, answer);
  }

  let partAScore = 0;
  let partAMaxScore = 0;
  let partBScore = 0;
  let partBMaxScore = 0;
  for (const question of snapshot.questions) {
    const answer = answerByQuestion.get(question.snapshotQuestionId);
    const pointsEarned = answer === undefined ? 0 : answer.pointsEarned;
    if (
      !finiteNonNegative(pointsEarned)
      || pointsEarned > question.points
      || (answer !== undefined && answer.maxPoints !== question.points)
    ) {
      projectionNotReady();
    }
    if (question.officialPart === "A") {
      partAScore += pointsEarned;
      partAMaxScore += question.points;
    } else {
      partBScore += pointsEarned;
      partBMaxScore += question.points;
    }
  }

  const snapshotMaxScore = partAMaxScore + partBMaxScore;
  if (
    partAScore + partBScore !== attempt.rawScore
    || snapshotMaxScore !== attempt.maxRawScore
    || attempt.maxRawScore !== 80
    || snapshotMaxScore !== 80
  ) {
    projectionNotReady();
  }

  return Object.freeze({
    status: attempt.status === "COMPLETED" ? "completed" : "expired",
    mode: "ce_ct",
    exam_mode: "rikz_russian_2026",
    raw_score: attempt.rawScore,
    max_raw_score: attempt.maxRawScore,
    part_a_score: partAScore,
    part_a_max_score: partAMaxScore,
    part_b_score: partBScore,
    part_b_max_score: partBMaxScore
  });
}

function serializeDetailedResult(
  attempt: AttemptResultPayload,
  audience: ResultAudience
) {
  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  // Authentic students return through the aggregate-only branch before this
  // detailed serializer; admins retain the existing review contract here.
  const isAuthenticRikzRussian = snapshot.examMode === "rikz_russian_2026";
  const includeScaledResultFields = shouldIncludeScaledResultFields({
    audience,
    snapshotExamMode: snapshot.examMode
  });
  const showCorrectAnswers =
    audience === "admin"
    || (!isAuthenticRikzRussian && (attempt.test?.showCorrectAnswers ?? true));
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
    ...(includeScaledResultFields
      ? {
          scaled_score: attempt.scaledScore,
          max_scaled_score: attempt.maxScaledScore,
          scaled_score_note: scaledScoreNote(snapshot, attempt)
        }
      : {}),
    topic_results: audience === "admin" ? jsonArray<TopicResult>(attempt.topicResults) : [],
    recommendations: audience === "admin" ? jsonArray<Recommendation>(attempt.recommendations) : [],
    answer_details: answerDetails,
    mistakes
  };
}

export type DetailedResultPayload = ReturnType<typeof serializeDetailedResult>;
export type SerializedResultPayload = AuthenticStudentResultPayload | DetailedResultPayload;

export function serializeResult(
  attempt: AttemptResultPayload,
  options: { audience: "admin" }
): DetailedResultPayload;
export function serializeResult(
  attempt: AttemptResultPayload,
  options?: { audience?: ResultAudience }
): SerializedResultPayload;
export function serializeResult(
  attempt: AttemptResultPayload,
  options: { audience?: ResultAudience } = {}
): SerializedResultPayload {
  const audience = options.audience ?? "student";
  const snapshot = parseTestSnapshot(attempt.testSnapshot);
  if (audience === "student" && snapshot.examMode === "rikz_russian_2026") {
    return serializeAuthenticStudentResult(attempt, snapshot);
  }

  return serializeDetailedResult(attempt, audience);
}
