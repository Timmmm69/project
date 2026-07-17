import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { SnapshotQuestion, TestSnapshot } from "@/lib/attempts/snapshot";
import {
  ResultProjectionNotReadyError,
  serializeResult,
  type DetailedResultPayload,
  type SerializedResultPayload
} from "@/lib/scoring/result-serialize";

const now = new Date("2026-07-09T12:00:00.000Z");

function authenticQuestion(part: "A" | "B", index: number): SnapshotQuestion {
  const isPartA = part === "A";
  return {
    snapshotQuestionId: `${part.toLowerCase()}_${index}`,
    originalQuestionId: `question-${part.toLowerCase()}-${index}`,
    orderIndex: isPartA ? index : index + 18,
    questionText: `Private Part ${part} question ${index}`,
    questionType: isPartA ? "multi_select_five" : "short_answer_token",
    options: isPartA ? { A: "A", B: "B", C: "C", D: "D", E: "E" } : {},
    correctAnswer: isPartA ? "A,C" : `token${index}`,
    topic: `Private topic ${part}`,
    subtopic: null,
    points: 2,
    scoringRule: isPartA ? "full_match" : "exact_text",
    explanation: `Private Part ${part} explanation ${index}`,
    officialPart: part,
    officialNumber: index,
    responseSubtype: isPartA ? null : "alnum",
    acceptedAnswers: isPartA ? null : [`token${index}`]
  };
}

function authenticSnapshot(): TestSnapshot {
  return {
    testId: "rikz-test",
    title: "Training CE/CT Russian",
    subject: "russian",
    mode: "ce_ct",
    examMode: "rikz_russian_2026",
    subjectCode: "russian",
    officialYear: 2026,
    durationMinutes: 120,
    maxRawScore: 80,
    questions: [
      ...Array.from({ length: 18 }, (_, index) => authenticQuestion("A", index + 1)),
      ...Array.from({ length: 22 }, (_, index) => authenticQuestion("B", index + 1))
    ]
  };
}

function makeAttempt(input: {
  snapshot?: TestSnapshot;
  status?: "STARTED" | "COMPLETED" | "EXPIRED" | "CANCELLED";
  answerQuestionIds?: string[];
  rawScore?: number | null;
  maxRawScore?: number | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  const snapshot = input.snapshot ?? authenticSnapshot();
  const status = input.status ?? "COMPLETED";
  const answerQuestionIds = input.answerQuestionIds ?? snapshot.questions.map((question) => question.snapshotQuestionId);
  const questionsById = new Map(snapshot.questions.map((question) => [question.snapshotQuestionId, question]));
  const answers = answerQuestionIds.map((snapshotQuestionId, index) => {
    const question = questionsById.get(snapshotQuestionId) ?? authenticQuestion("A", 99);
    return {
      id: `answer-${index + 1}`,
      attemptId: "attempt-1",
      questionId: question.originalQuestionId,
      snapshotQuestionId,
      questionSnapshot: question as unknown as Prisma.JsonValue,
      selectedAnswer: question.correctAnswer,
      isCorrect: true,
      pointsEarned: question.points,
      maxPoints: question.points,
      answeredAt: now,
      createdAt: now,
      updatedAt: now
    };
  });
  const startedAt = input.startedAt === undefined
    ? new Date("2026-07-09T10:00:00.000Z")
    : input.startedAt;
  const finishedAt = input.finishedAt === undefined
    ? new Date(status === "EXPIRED" ? "2026-07-09T12:00:00.000Z" : "2026-07-09T11:00:00.000Z")
    : input.finishedAt;
  return {
    id: "attempt-1",
    userId: "student-1",
    testId: snapshot.testId,
    accessId: "access-1",
    status,
    startedAt,
    finishedAt,
    durationSeconds: 7200,
    rawScore: input.rawScore === undefined ? 80 : input.rawScore,
    maxRawScore: input.maxRawScore === undefined ? 80 : input.maxRawScore,
    percent: new Prisma.Decimal(100),
    scaledScore: 100,
    maxScaledScore: 100,
    level: "high",
    testSnapshot: snapshot as unknown as Prisma.JsonValue,
    scoringSchemeSnapshot: null,
    topicResults: [{ topic: "private" }] as unknown as Prisma.JsonValue,
    recommendations: [{ message: "private" }] as unknown as Prisma.JsonValue,
    createdAt: now,
    updatedAt: now,
    user: { email: "private-student@example.test" },
    test: {
      title: snapshot.title,
      slug: "rikz-test",
      mode: "CE_CT" as const,
      showCorrectAnswers: true
    },
    answers
  } as Parameters<typeof serializeResult>[0];
}

function detailed(result: SerializedResultPayload): DetailedResultPayload {
  if (!("answer_details" in result)) throw new Error("Expected detailed Result payload");
  return result;
}

function expectProjectionFailure(attempt: Parameters<typeof serializeResult>[0]) {
  expect(() => serializeResult(attempt)).toThrow(ResultProjectionNotReadyError);
}

describe("result serialization", () => {
  it("returns the exact aggregate-only allowlist for an authentic student", () => {
    const result = serializeResult(makeAttempt({}));

    expect(result).toEqual({
      status: "completed",
      mode: "ce_ct",
      exam_mode: "rikz_russian_2026",
      raw_score: 80,
      max_raw_score: 80,
      part_a_score: 36,
      part_a_max_score: 36,
      part_b_score: 44,
      part_b_max_score: 44,
      completed_at: "2026-07-09T11:00:00.000Z"
    });
    expect(Object.keys(result).sort()).toEqual([
      "completed_at",
      "exam_mode",
      "max_raw_score",
      "mode",
      "part_a_max_score",
      "part_a_score",
      "part_b_max_score",
      "part_b_score",
      "raw_score",
      "status"
    ]);
    expect(Object.keys(result)).toHaveLength(10);
    expect("finished_at" in result).toBe(false);
    expect("started_at" in result).toBe(false);
  });

  it("physically omits every private, question-level, scaled, identity and time field", () => {
    const result = serializeResult(makeAttempt({}));
    const serialized = JSON.stringify(result);
    for (const field of [
      "attempt_id", "student_email", "test_id", "test_title", "test_slug",
      "started_at", "finished_at", "duration_seconds", "percent", "level",
      "scaled_score", "max_scaled_score", "scaled_score_note", "topic_results",
      "recommendations", "answer_details", "mistakes", "snapshot_question_id",
      "order_index", "question_text", "question_type", "official_part",
      "official_number", "response_subtype", "selected_answer", "normalized_answer",
      "correct_answer", "accepted_answers", "is_correct", "points_earned",
      "max_points", "explanation"
    ]) {
      expect(field in result, field).toBe(false);
      expect(serialized).not.toContain(`"${field}"`);
    }
    expect(serialized).not.toContain("Private Part");
    expect(serialized).not.toContain("private-student@example.test");
  });

  it("uses stored Answer points to calculate Part A and Part B on the server", () => {
    const attempt = makeAttempt({ rawScore: 76 });
    attempt.answers[0]!.pointsEarned = 0;
    attempt.answers[18]!.pointsEarned = 0;

    expect(serializeResult(attempt)).toMatchObject({
      raw_score: 76,
      part_a_score: 34,
      part_a_max_score: 36,
      part_b_score: 42,
      part_b_max_score: 44
    });
  });

  it("treats a missing Answer as zero while preserving immutable snapshot max points", () => {
    const snapshot = authenticSnapshot();
    const answeredIds = snapshot.questions.slice(1).map((question) => question.snapshotQuestionId);
    const result = serializeResult(makeAttempt({ snapshot, answerQuestionIds: answeredIds, rawScore: 78 }));

    expect(result).toMatchObject({
      raw_score: 78,
      max_raw_score: 80,
      part_a_score: 34,
      part_a_max_score: 36,
      part_b_score: 44,
      part_b_max_score: 44
    });
  });

  it("preserves terminal expired status", () => {
    expect(serializeResult(makeAttempt({ status: "EXPIRED" }))).toMatchObject({
      status: "expired",
      completed_at: "2026-07-09T12:00:00.000Z"
    });
  });

  it("uses only the stored terminal finishedAt as the completed timestamp", () => {
    const finishedAt = new Date("2026-07-09T11:34:56.789Z");
    expect(serializeResult(makeAttempt({ finishedAt }))).toMatchObject({
      completed_at: finishedAt.toISOString()
    });
  });

  it.each([
    ["missing finishedAt", { finishedAt: null }],
    ["missing startedAt", { startedAt: null }],
    ["invalid finishedAt", { finishedAt: new Date(Number.NaN) }],
    ["invalid startedAt", { startedAt: new Date(Number.NaN) }],
    ["finished before started", { finishedAt: new Date("2026-07-09T09:59:59.999Z") }]
  ])("fails closed for corrupt terminal time: %s", (_label, overrides) => {
    expectProjectionFailure(makeAttempt(overrides));
  });

  it("fails closed when an expired timestamp differs from authoritative endsAt", () => {
    expectProjectionFailure(makeAttempt({
      status: "EXPIRED",
      finishedAt: new Date("2026-07-09T11:59:59.999Z")
    }));
  });

  it("fails closed when finishedAt cannot be serialized with toISOString", () => {
    const finishedAt = new Date("2026-07-09T11:00:00.000Z");
    finishedAt.toISOString = () => {
      throw new RangeError("corrupt date serialization");
    };
    expectProjectionFailure(makeAttempt({ finishedAt }));
  });

  it("fails closed when finishedAt serializes outside the four-digit canonical UTC format", () => {
    expectProjectionFailure(makeAttempt({
      startedAt: new Date("+010000-01-01T00:00:00.000Z"),
      finishedAt: new Date("+010000-01-01T01:00:00.000Z")
    }));
  });

  it.each([
    ["at endsAt", "2026-07-09T12:00:00.000Z"],
    ["after endsAt", "2026-07-09T12:00:00.001Z"]
  ])("fails closed when completed finishedAt is %s", (_label, value) => {
    expectProjectionFailure(makeAttempt({ finishedAt: new Date(value) }));
  });

  it.each([
    ["zero", 0, false],
    ["negative", -1, false],
    ["fractional", 1.5, false],
    ["NaN", Number.NaN, false],
    ["Infinity", Number.POSITIVE_INFINITY, false],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1, false],
    ["string", "120", false],
    ["null", null, false],
    ["missing", undefined, true]
  ])("fails closed for $label snapshot durationMinutes", (_label, durationMinutes, omit) => {
    const snapshot = authenticSnapshot();
    if (omit) delete (snapshot as { durationMinutes?: unknown }).durationMinutes;
    else (snapshot as { durationMinutes: unknown }).durationMinutes = durationMinutes;
    expectProjectionFailure(makeAttempt({ snapshot }));
  });

  it("fails closed for duplicate Answer mapping", () => {
    const attempt = makeAttempt({});
    attempt.answers.push({ ...attempt.answers[0]!, id: "duplicate-answer" });
    expectProjectionFailure(attempt);
  });

  it("fails closed for an Answer mapped to an unknown snapshot question", () => {
    const attempt = makeAttempt({});
    attempt.answers[0]!.snapshotQuestionId = "unknown-question";
    expectProjectionFailure(attempt);
  });

  it.each([
    { label: "points above snapshot max", mutate: (attempt: ReturnType<typeof makeAttempt>) => { attempt.answers[0]!.pointsEarned = 3; } },
    { label: "negative points", mutate: (attempt: ReturnType<typeof makeAttempt>) => { attempt.answers[0]!.pointsEarned = -1; } },
    { label: "mismatched saved max", mutate: (attempt: ReturnType<typeof makeAttempt>) => { attempt.answers[0]!.maxPoints = 3; } },
    { label: "null stored points", mutate: (attempt: ReturnType<typeof makeAttempt>) => { attempt.answers[0]!.pointsEarned = null; } }
  ])("fails closed for malformed Answer points: $label", ({ mutate }) => {
    const attempt = makeAttempt({});
    mutate(attempt);
    expectProjectionFailure(attempt);
  });

  it("fails closed when the immutable snapshot does not contain exactly 18 Part A and 22 Part B questions", () => {
    const snapshot = authenticSnapshot();
    snapshot.questions[0] = { ...snapshot.questions[0]!, officialPart: "B" };
    expectProjectionFailure(makeAttempt({ snapshot }));
  });

  it("fails closed when the immutable snapshot total or stored max is not 80", () => {
    const snapshot = authenticSnapshot();
    snapshot.questions[0] = { ...snapshot.questions[0]!, points: 1 };
    const attempt = makeAttempt({ snapshot, rawScore: 79, maxRawScore: 79 });
    expectProjectionFailure(attempt);
  });

  it.each([
    { label: "zero", points: 0, compensatingPoints: 4, omit: false },
    { label: "negative", points: -1, compensatingPoints: 5, omit: false },
    { label: "fractional", points: 1.5, compensatingPoints: 2.5, omit: false },
    { label: "NaN", points: Number.NaN, compensatingPoints: 2, omit: false },
    { label: "Infinity", points: Number.POSITIVE_INFINITY, compensatingPoints: 2, omit: false },
    { label: "string", points: "2", compensatingPoints: 2, omit: false },
    { label: "null", points: null, compensatingPoints: 2, omit: false },
    { label: "missing", points: undefined, compensatingPoints: 2, omit: true }
  ])("fails closed for $label immutable snapshot points", ({ points, compensatingPoints, omit }) => {
    const snapshot = authenticSnapshot();
    snapshot.questions[0] = { ...snapshot.questions[0]!, points: points as number };
    if (omit) delete (snapshot.questions[0] as { points?: unknown }).points;
    snapshot.questions[1] = { ...snapshot.questions[1]!, points: compensatingPoints };
    expectProjectionFailure(makeAttempt({ snapshot }));
  });

  it("fails closed when part sums do not equal the stored total", () => {
    expectProjectionFailure(makeAttempt({ rawScore: 79 }));
  });

  it("fails closed for a non-terminal authentic status", () => {
    expectProjectionFailure(makeAttempt({ status: "CANCELLED" }));
  });

  it("preserves the existing generic student detailed contract", () => {
    const snapshot = { ...authenticSnapshot(), examMode: "generic" as const, mode: "training" as const };
    const result = detailed(serializeResult(makeAttempt({ snapshot })));

    expect(result).toMatchObject({
      attempt_id: "attempt-1",
      student_email: "private-student@example.test",
      test_id: "rikz-test",
      test_title: "Training CE/CT Russian",
      test_slug: "rikz-test",
      status: "completed",
      mode: "training",
      exam_mode: "generic",
      raw_score: 80,
      max_raw_score: 80,
      scaled_score: 100,
      max_scaled_score: 100
    });
    expect(result.answer_details).toHaveLength(40);
    expect(result.mistakes).toEqual([]);
    expect(result.answer_details[0]).toMatchObject({
      question_text: "Private Part A question 1",
      selected_answer: "A,C",
      correct_answer: "A,C",
      points_earned: 2,
      max_points: 2
    });
    expect(result.started_at).toEqual(new Date("2026-07-09T10:00:00.000Z"));
    expect(result.finished_at).toEqual(new Date("2026-07-09T11:00:00.000Z"));
    expect("completed_at" in result).toBe(false);
  });

  it("keeps authentic admin details while suppressing every answer-key field", () => {
    const snapshot = authenticSnapshot();
    snapshot.questions[0] = {
      ...snapshot.questions[0]!,
      correctAnswer: "A,E",
      explanation: "ADMIN_A_EXPLANATION_SECRET"
    };
    snapshot.questions[18] = {
      ...snapshot.questions[18]!,
      correctAnswer: "correctsecret1",
      acceptedAnswers: ["acceptedsecret1"],
      explanation: "ADMIN_B_EXPLANATION_SECRET"
    };
    const attempt = makeAttempt({ snapshot });
    attempt.answers[0]!.selectedAnswer = "B,D";
    attempt.answers[18]!.selectedAnswer = "studenttoken1";
    const result = serializeResult(attempt, { audience: "admin" });

    expect(result.attempt_id).toBe("attempt-1");
    expect(result.student_email).toBe("private-student@example.test");
    expect(result.answer_details).toHaveLength(40);
    expect(result.answer_details[0]).toMatchObject({
      question_text: "Private Part A question 1",
      selected_answer: "B,D",
      correct_answer: null,
      accepted_answers: null,
      points_earned: 2,
      max_points: 2,
      explanation: null
    });
    expect(result.answer_details[18]).toMatchObject({
      question_text: "Private Part B question 1",
      selected_answer: "studenttoken1",
      correct_answer: null,
      accepted_answers: null,
      points_earned: 2,
      max_points: 2,
      explanation: null
    });
    expect(result.scaled_score).toBe(100);
    expect(result.max_scaled_score).toBe(100);
    expect(result.finished_at).toEqual(new Date("2026-07-09T11:00:00.000Z"));
    expect("completed_at" in result).toBe(false);
    const serialized = JSON.stringify(result);
    for (const secret of [
      "A,E",
      "correctsecret1",
      "acceptedsecret1",
      "ADMIN_A_EXPLANATION_SECRET",
      "ADMIN_B_EXPLANATION_SECRET"
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("preserves the detailed generic admin contract", () => {
    const snapshot = { ...authenticSnapshot(), examMode: "generic" as const };
    const result = serializeResult(makeAttempt({ snapshot }), { audience: "admin" });

    expect(result.answer_details).toHaveLength(40);
    expect(result.scaled_score).toBe(100);
    expect(result.topic_results).toHaveLength(1);
    expect(result.recommendations).toHaveLength(1);
    expect("completed_at" in result).toBe(false);
    expect(result.answer_details[0]).toMatchObject({
      correct_answer: "A,C",
      explanation: "Private Part A explanation 1"
    });
    expect(result.answer_details[18]?.accepted_answers).toEqual(["token1"]);
  });
});
