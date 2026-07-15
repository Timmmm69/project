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
  audience?: "student" | "admin";
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

  const attempt = {
    id: "attempt-1",
    userId: "student-1",
    testId: input.snapshot.testId,
    accessId: "access-1",
    status: "COMPLETED" as const,
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
      mode: "CE_CT" as const,
      showCorrectAnswers: true
    },
    answers
  };

  return serializeResult(attempt, { audience: input.audience });
}

describe("result serialization", () => {
  it("keeps generic completed answer review when it is enabled", () => {
    const genericSnapshot: TestSnapshot = {
      ...fullRikzSnapshot,
      examMode: "generic",
      mode: "training"
    };
    const genericScoring = scoreAttemptSnapshot(
      genericSnapshot,
      [{ snapshotQuestionId: "a_1", selectedAnswer: "A,C" }],
      null
    );

    const result = serializeScoredAttempt({
      snapshot: genericSnapshot,
      scoringSchemeSnapshot: null,
      scoring: genericScoring
    });

    expect(result.answer_details[0]).toMatchObject({
      correct_answer: "A,C",
      explanation: "Part A explanation"
    });
  });

  it("never exposes authentic answer keys in a completed result", () => {
    const scoring = scoreAttemptSnapshot(
      fullRikzSnapshot,
      [
        { snapshotQuestionId: "a_1", selectedAnswer: "A,C" },
        { snapshotQuestionId: "b_1", selectedAnswer: "token" }
      ],
      rikz2026Scale
    );

    const result = serializeScoredAttempt({
      snapshot: fullRikzSnapshot,
      scoringSchemeSnapshot: rikz2026Scale,
      scoring
    });

    expect(result.answer_details).toMatchObject([
      {
        selected_answer: "A,C",
        points_earned: 2,
        official_part: "A",
        official_number: 1
      },
      {
        selected_answer: "token",
        points_earned: 78,
        official_part: "B",
        official_number: 1
      }
    ]);
    expect(result.raw_score).toBe(80);
    expect(result.max_raw_score).toBe(80);
    expect("scaled_score" in result).toBe(false);
    expect("max_scaled_score" in result).toBe(false);
    expect("scaled_score_note" in result).toBe(false);

    for (const detail of result.answer_details) {
      expect(detail.correct_answer).toBeNull();
      expect(detail.accepted_answers).toBeNull();
      expect(detail.explanation).toBeNull();
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Part A explanation");
    expect(serialized).not.toContain("token\"]");
    expect(serialized).not.toContain('"scaled_score"');
    expect(serialized).not.toContain('"max_scaled_score"');
    expect(serialized).not.toContain('"scaled_score_note"');
  });

  it("serializes a full RIKZ Russian 2026 student result as primary-only", () => {
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
    expect("scaled_score" in result).toBe(false);
    expect("max_scaled_score" in result).toBe(false);
    expect("scaled_score_note" in result).toBe(false);
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

  it("preserves stored scaled score for an authentic admin result", () => {
    const scoring = scoreAttemptSnapshot(
      fullRikzSnapshot,
      [
        { snapshotQuestionId: "a_1", selectedAnswer: "A,C" },
        { snapshotQuestionId: "b_1", selectedAnswer: "token" }
      ],
      rikz2026Scale
    );

    const result = serializeScoredAttempt({
      snapshot: fullRikzSnapshot,
      scoringSchemeSnapshot: rikz2026Scale,
      scoring,
      audience: "admin"
    });

    expect(result.scaled_score).toBe(100);
    expect(result.max_scaled_score).toBe(100);
    expect(result.scaled_score_note).toContain("таблице соответствия");
  });

  it("preserves the existing generic student scaled-score contract", () => {
    const genericSnapshot: TestSnapshot = {
      ...fullRikzSnapshot,
      examMode: "generic"
    };
    const scoring = scoreAttemptSnapshot(
      genericSnapshot,
      [
        { snapshotQuestionId: "a_1", selectedAnswer: "A,C" },
        { snapshotQuestionId: "b_1", selectedAnswer: "token" }
      ],
      rikz2026Scale
    );

    const result = serializeScoredAttempt({
      snapshot: genericSnapshot,
      scoringSchemeSnapshot: rikz2026Scale,
      scoring
    });

    expect(result.scaled_score).toBe(100);
    expect(result.max_scaled_score).toBe(100);
    expect("scaled_score_note" in result).toBe(true);
  });

  it("omits scaled fields for a partial RIKZ Russian 2026 demo result", () => {
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
    expect("scaled_score" in result).toBe(false);
    expect("max_scaled_score" in result).toBe(false);
    expect("scaled_score_note" in result).toBe(false);
  });
});
