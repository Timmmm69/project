import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { ScoringSchemeSnapshot, TestSnapshot } from "@/lib/attempts/snapshot";
import { scoreAttemptSnapshot, type ScoringResult } from "@/lib/scoring/scoring-engine";
import { serializeResult } from "@/lib/scoring/result-serialize";

const now = new Date("2026-07-09T12:00:00.000Z");

const rikz2026Scale: ScoringSchemeSnapshot = {
  scoringSchemeId: "scheme-1",
  name: "RIKZ Russian 2026",
  subject: "russian",
  examType: "ce_ct",
  year: 2026,
  maxRawScore: 80,
  maxScaledScore: 100,
  scale: [
    { rawScore: 0, scaledScore: 0 },
    { rawScore: 40, scaledScore: 52 },
    { rawScore: 80, scaledScore: 100 }
  ]
};

const fullRikzSnapshot: TestSnapshot = {
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
    {
      snapshotQuestionId: "a_1",
      originalQuestionId: "question-a1",
      orderIndex: 1,
      questionText: "Part A",
      questionType: "multi_select_five",
      options: { A: "A", B: "B", C: "C", D: "D", E: "E" },
      correctAnswer: "A,C",
      topic: "Topic A",
      subtopic: null,
      points: 2,
      scoringRule: "full_match",
      explanation: "Part A explanation",
      officialPart: "A",
      officialNumber: 1
    },
    {
      snapshotQuestionId: "b_1",
      originalQuestionId: "question-b1",
      orderIndex: 19,
      questionText: "Part B",
      questionType: "short_answer_token",
      options: {},
      correctAnswer: "token",
      topic: "Topic B",
      subtopic: null,
      points: 78,
      scoringRule: "exact_text",
      explanation: "Part B explanation",
      officialPart: "B",
      officialNumber: 1,
      responseSubtype: "word",
      acceptedAnswers: ["token"]
    }
  ]
};

function serializeScoredAttempt(input: {
  snapshot: TestSnapshot;
  scoringSchemeSnapshot: ScoringSchemeSnapshot | null;
  scoring: ScoringResult;
}) {
  const answers = input.scoring.answers.map((answer, index) => ({
    id: `answer-${index + 1}`,
    attemptId: "attempt-1",
    questionId: answer.question.originalQuestionId,
    snapshotQuestionId: answer.snapshotQuestionId,
    questionSnapshot: answer.question as unknown as Prisma.JsonValue,
    selectedAnswer: answer.selectedAnswer,
    isCorrect: answer.isCorrect,
    pointsEarned: answer.pointsEarned,
    maxPoints: answer.maxPoints,
    answeredAt: now,
    createdAt: now,
    updatedAt: now
  }));

  return serializeResult({
    id: "attempt-1",
    userId: "student-1",
    testId: input.snapshot.testId,
    accessId: "access-1",
    status: "COMPLETED",
    startedAt: new Date("2026-07-09T10:00:00.000Z"),
    finishedAt: now,
    durationSeconds: 7200,
    rawScore: input.scoring.rawScore,
    maxRawScore: input.scoring.maxRawScore,
    percent: new Prisma.Decimal(input.scoring.percent),
    scaledScore: input.scoring.scaledScore,
    maxScaledScore: input.scoring.maxScaledScore,
    level: input.scoring.level,
    testSnapshot: input.snapshot as unknown as Prisma.JsonValue,
    scoringSchemeSnapshot: input.scoringSchemeSnapshot as unknown as Prisma.JsonValue,
    topicResults: input.scoring.topicResults as unknown as Prisma.JsonValue,
    recommendations: input.scoring.recommendations as unknown as Prisma.JsonValue,
    createdAt: now,
    updatedAt: now,
    test: {
      title: input.snapshot.title,
      slug: "rikz-test",
      mode: "CE_CT",
      showCorrectAnswers: true
    },
    answers
  });
}

describe("result serialization", () => {
  it("serializes full RIKZ Russian 2026 primary and scaled score from snapshot lookup", () => {
    const scoring = scoreAttemptSnapshot(
      fullRikzSnapshot,
      [
        { snapshotQuestionId: "a_1", selectedAnswer: "C,A" },
        { snapshotQuestionId: "b_1", selectedAnswer: " TOKEN " }
      ],
      rikz2026Scale
    );

    const result = serializeScoredAttempt({
      snapshot: fullRikzSnapshot,
      scoringSchemeSnapshot: rikz2026Scale,
      scoring
    });

    expect(result.exam_mode).toBe("rikz_russian_2026");
    expect(result.raw_score).toBe(80);
    expect(result.max_raw_score).toBe(80);
    expect(result.scaled_score).toBe(100);
    expect(result.max_scaled_score).toBe(100);
    expect(result.answer_details).toMatchObject([
      {
        snapshot_question_id: "a_1",
        question_type: "multi_select_five",
        official_part: "A",
        official_number: 1,
        selected_answer: "A,C",
        normalized_answer: null,
        points_earned: 2,
        max_points: 2
      },
      {
        snapshot_question_id: "b_1",
        question_type: "short_answer_token",
        official_part: "B",
        official_number: 1,
        response_subtype: "word",
        selected_answer: "token",
        normalized_answer: "token",
        points_earned: 78,
        max_points: 78
      }
    ]);
  });

  it("does not serialize scaled score for partial RIKZ Russian 2026 demo result", () => {
    const partialSnapshot: TestSnapshot = {
      ...fullRikzSnapshot,
      maxRawScore: 2,
      questions: [{ ...fullRikzSnapshot.questions[0]!, points: 2 }]
    };
    const scoring = scoreAttemptSnapshot(
      partialSnapshot,
      [{ snapshotQuestionId: "a_1", selectedAnswer: "A,C" }],
      rikz2026Scale
    );

    const result = serializeScoredAttempt({
      snapshot: partialSnapshot,
      scoringSchemeSnapshot: rikz2026Scale,
      scoring
    });

    expect(result.raw_score).toBe(2);
    expect(result.max_raw_score).toBe(2);
    expect(result.scaled_score).toBeNull();
    expect(result.max_scaled_score).toBeNull();
  });
});
