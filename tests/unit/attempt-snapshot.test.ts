import { describe, expect, it } from "vitest";
import { buildTestSnapshot, serializeQuestionForStudent } from "@/lib/attempts/snapshot";

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
});
