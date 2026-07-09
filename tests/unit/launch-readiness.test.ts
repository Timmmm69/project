import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { TestSnapshot } from "@/lib/attempts/snapshot";
import { resolveAttemptCompletion } from "@/lib/attempts/attempt-service";
import { serializeResult } from "@/lib/scoring/result-serialize";

const now = new Date("2026-07-06T12:00:00.000Z");

const resultSnapshot: TestSnapshot = {
  testId: "test-1",
  title: "Demo",
  subject: "russian",
  mode: "training",
  durationMinutes: 30,
  maxRawScore: 1,
  questions: [
    {
      snapshotQuestionId: "q_1",
      originalQuestionId: "question-1",
      orderIndex: 1,
      questionText: "Choose A",
      questionType: "single_choice",
      options: { A: "Alpha", B: "Beta" },
      correctAnswer: "A",
      topic: "Орфография",
      subtopic: "Гласные",
      points: 1,
      scoringRule: "full_match",
      explanation: "Правильный вариант A"
    }
  ]
};

describe("launch readiness safeguards", () => {
  it("marks a late manual completion as expired on the server", () => {
    const startedAt = new Date("2026-07-06T11:00:00.000Z");
    const completion = resolveAttemptCompletion({
      now,
      startedAt,
      durationMinutes: 30,
      expire: false
    });

    expect(completion.status).toBe("EXPIRED");
    expect(completion.finishedAt).toEqual(new Date("2026-07-06T11:30:00.000Z"));
  });

  it("rejects a client expire request before the server timer ends", () => {
    expect(() =>
      resolveAttemptCompletion({
        now,
        startedAt: new Date("2026-07-06T11:45:00.000Z"),
        durationMinutes: 30,
        expire: true
      })
    ).toThrow("ATTEMPT_TIME_NOT_EXPIRED");
  });

  it("hides configured student result details while keeping admin visibility", () => {
    const attempt = {
      id: "attempt-1",
      userId: "student-1",
      testId: "test-1",
      accessId: "access-1",
      status: "COMPLETED",
      startedAt: new Date("2026-07-06T11:00:00.000Z"),
      finishedAt: new Date("2026-07-06T11:10:00.000Z"),
      durationSeconds: 600,
      rawScore: 0,
      maxRawScore: 1,
      percent: new Prisma.Decimal(0),
      scaledScore: null,
      maxScaledScore: null,
      level: "слабый",
      testSnapshot: resultSnapshot as unknown as Prisma.JsonValue,
      scoringSchemeSnapshot: null,
      topicResults: [
        {
          topic: "Орфография",
          score: 0,
          max_score: 1,
          percent: 0,
          status: "weak",
          wrong_subtopics: ["Гласные"]
        }
      ] as unknown as Prisma.JsonValue,
      recommendations: [
        {
          topic: "Орфография",
          subtopics: ["Гласные"],
          message: "Повторите гласные."
        }
      ] as unknown as Prisma.JsonValue,
      createdAt: now,
      updatedAt: now,
      test: {
        title: "Demo",
        slug: "demo",
        mode: "TRAINING",
        showPercent: false,
        showCorrectAnswers: false,
        showTopicResult: false,
        showRecommendations: false
      },
      answers: [
        {
          id: "answer-1",
          attemptId: "attempt-1",
          questionId: "question-1",
          snapshotQuestionId: "q_1",
          questionSnapshot: resultSnapshot.questions[0] as unknown as Prisma.JsonValue,
          selectedAnswer: "B",
          isCorrect: false,
          pointsEarned: 0,
          maxPoints: 1,
          answeredAt: now,
          createdAt: now,
          updatedAt: now
        }
      ]
    } as Parameters<typeof serializeResult>[0];

    const studentResult = serializeResult(attempt);
    expect(studentResult.percent).toBeNull();
    expect(studentResult.topic_results).toEqual([]);
    expect(studentResult.recommendations).toEqual([]);
    expect(studentResult.mistakes[0]?.correct_answer).toBeNull();
    expect(studentResult.mistakes[0]?.topic).toBeNull();
    expect(studentResult.mistakes[0]?.explanation).toBeNull();

    const adminResult = serializeResult(attempt, { audience: "admin" });
    expect(adminResult.percent).toBe(0);
    expect(adminResult.topic_results).toHaveLength(1);
    expect(adminResult.recommendations).toHaveLength(1);
    expect(adminResult.mistakes[0]?.correct_answer).toBe("A");
    expect(adminResult.mistakes[0]?.topic).toBe("Орфография");
    expect(adminResult.mistakes[0]?.explanation).toBe("Правильный вариант A");
  });
});
