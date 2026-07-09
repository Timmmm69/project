import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildTestSnapshot, serializeQuestionForStudent } from "@/lib/attempts/snapshot";
import { serializeAttemptForStudent } from "@/lib/attempts/serialize";

describe("attempt snapshot", () => {
  it("keeps correct answer in snapshot but hides it from active attempt response", () => {
    const snapshot = buildTestSnapshot({
      id: "test-id",
      title: "Demo test",
      mode: "TRAINING",
      durationMinutes: 60,
      maxRawScore: 1,
      questions: [
        {
          id: "question-id",
          questionText: "Choose A",
          questionType: "SINGLE_CHOICE",
          optionA: "Alpha",
          optionB: "Beta",
          optionC: null,
          optionD: null,
          correctAnswer: "A",
          topic: "Topic",
          subtopic: null,
          points: 1,
          explanation: "Because A",
          orderIndex: 1
        }
      ]
    });

    expect(snapshot.questions[0]?.correctAnswer).toBe("A");

    const publicQuestion = serializeQuestionForStudent(snapshot.questions[0]!);
    expect(publicQuestion).toEqual({
      snapshotQuestionId: "q_1",
      orderIndex: 1,
      questionText: "Choose A",
      questionType: "single_choice",
      officialPart: null,
      officialNumber: null,
      options: {
        A: "Alpha",
        B: "Beta"
      },
      topic: "Topic",
      subtopic: null
    });
    expect(publicQuestion).not.toHaveProperty("correctAnswer");
    expect(publicQuestion).not.toHaveProperty("explanation");
  });

  it("does not expose generic answers or scoring scale in active attempt serialization", () => {
    const now = new Date("2026-07-09T12:00:00.000Z");
    const snapshot = buildTestSnapshot({
      id: "test-id",
      title: "Generic test",
      mode: "TRAINING",
      durationMinutes: 60,
      maxRawScore: 1,
      questions: [
        {
          id: "question-id",
          questionText: "Choose one",
          questionType: "SINGLE_CHOICE",
          optionA: "Visible option A",
          optionB: "Visible option B",
          optionC: null,
          optionD: null,
          correctAnswer: "SECRET_GENERIC_CORRECT",
          topic: "Topic",
          subtopic: null,
          points: 1,
          explanation: "SECRET_GENERIC_EXPLANATION",
          orderIndex: 1
        }
      ]
    });

    const serialized = serializeAttemptForStudent(
      {
        id: "attempt-id",
        userId: "student-id",
        testId: "test-id",
        accessId: "access-id",
        status: "STARTED",
        startedAt: now,
        finishedAt: null,
        durationSeconds: null,
        rawScore: null,
        maxRawScore: null,
        percent: null,
        scaledScore: null,
        maxScaledScore: null,
        level: null,
        testSnapshot: snapshot as unknown as Prisma.JsonValue,
        scoringSchemeSnapshot: {
          scoringSchemeId: "scheme-id",
          scale: [{ rawScore: 1, scaledScore: 100 }]
        } as unknown as Prisma.JsonValue,
        topicResults: null,
        recommendations: null,
        createdAt: now,
        updatedAt: now,
        answers: []
      },
      now
    );

    const payload = JSON.stringify(serialized);
    expect(payload).not.toContain("correctAnswer");
    expect(payload).not.toContain("acceptedAnswers");
    expect(payload).not.toContain("explanation");
    expect(payload).not.toContain("SECRET_GENERIC_CORRECT");
    expect(payload).not.toContain("SECRET_GENERIC_EXPLANATION");
    expect(payload).not.toContain("scoringScheme");
    expect(payload).not.toContain("scale");
    expect(payload).not.toContain("scaledScore");
  });

  it("does not expose RIKZ Russian 2026 answers in active attempt serialization", () => {
    const now = new Date("2026-07-09T12:00:00.000Z");
    const snapshot = buildTestSnapshot({
      id: "test-id",
      title: "Authentic test",
      mode: "CE_CT",
      examMode: "RIKZ_RUSSIAN_2026",
      subjectCode: "russian",
      officialYear: 2026,
      durationMinutes: 120,
      maxRawScore: 4,
      questions: [
        {
          id: "question-a-id",
          questionText: "Part A question",
          questionType: "MULTI_SELECT_FIVE",
          optionA: "Visible A",
          optionB: "Visible B",
          optionC: "Visible C",
          optionD: "Visible D",
          optionE: "Visible E",
          correctAnswer: "A,C",
          topic: "Topic A",
          subtopic: null,
          points: 2,
          explanation: "SECRET_PART_A_EXPLANATION",
          officialPart: "A",
          officialNumber: 1,
          orderIndex: 1
        },
        {
          id: "question-b-id",
          questionText: "Part B question",
          questionType: "SHORT_ANSWER_TOKEN",
          optionA: null,
          optionB: null,
          optionC: null,
          optionD: null,
          correctAnswer: "SECRET_PART_B_CORRECT",
          acceptedAnswers: ["SECRET_PART_B_ACCEPTED"],
          topic: "Topic B",
          subtopic: null,
          points: 2,
          explanation: "SECRET_PART_B_EXPLANATION",
          officialPart: "B",
          officialNumber: 1,
          responseSubtype: "WORD",
          orderIndex: 2
        }
      ]
    });

    const serialized = serializeAttemptForStudent(
      {
        id: "attempt-id",
        userId: "student-id",
        testId: "test-id",
        accessId: "access-id",
        status: "STARTED",
        startedAt: now,
        finishedAt: null,
        durationSeconds: null,
        rawScore: null,
        maxRawScore: null,
        percent: null,
        scaledScore: null,
        maxScaledScore: null,
        level: null,
        testSnapshot: snapshot as unknown as Prisma.JsonValue,
        scoringSchemeSnapshot: {
          scoringSchemeId: "scheme-id",
          scale: [{ rawScore: 4, scaledScore: 10 }]
        } as unknown as Prisma.JsonValue,
        topicResults: null,
        recommendations: null,
        createdAt: now,
        updatedAt: now,
        answers: []
      },
      now
    );

    const payload = JSON.stringify(serialized);
    expect(payload).not.toContain("correctAnswer");
    expect(payload).not.toContain("acceptedAnswers");
    expect(payload).not.toContain("explanation");
    expect(payload).not.toContain("SECRET_PART_A_EXPLANATION");
    expect(payload).not.toContain("SECRET_PART_B_CORRECT");
    expect(payload).not.toContain("SECRET_PART_B_ACCEPTED");
    expect(payload).not.toContain("SECRET_PART_B_EXPLANATION");
    expect(payload).not.toContain("scale");
    expect(payload).not.toContain("scaledScore");
    expect(serialized.questions[0]).toMatchObject({
      questionType: "multi_select_five",
      officialPart: "A",
      officialNumber: 1,
      options: {
        E: "Visible E"
      }
    });
    expect(serialized.questions[1]).toMatchObject({
      questionType: "short_answer_token",
      officialPart: "B",
      officialNumber: 1,
      options: {}
    });
  });
});
