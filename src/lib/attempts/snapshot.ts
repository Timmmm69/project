import type { Prisma, QuestionType, TestMode } from "@prisma/client";
import { fromPrismaQuestionType, scoringRuleForQuestionType } from "@/lib/questions/enums";
import { fromPrismaTestMode } from "@/lib/tests/enums";

type QuestionForSnapshot = {
  id: string;
  questionText: string;
  questionType: QuestionType;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string;
  topic: string;
  subtopic: string | null;
  points: number;
  explanation: string | null;
  orderIndex: number;
};

type TestForSnapshot = {
  id: string;
  title: string;
  mode: TestMode;
  durationMinutes: number;
  maxRawScore: number;
  questions: QuestionForSnapshot[];
};

export type SnapshotQuestion = {
  snapshotQuestionId: string;
  originalQuestionId: string;
  orderIndex: number;
  questionText: string;
  questionType: "single_choice" | "multiple_choice" | "short_text";
  options: {
    A?: string;
    B?: string;
    C?: string;
    D?: string;
  };
  correctAnswer: string;
  topic: string;
  subtopic: string | null;
  points: number;
  scoringRule: "full_match" | "exact_text";
  explanation: string | null;
};

export type TestSnapshot = {
  testId: string;
  title: string;
  subject: "russian";
  mode: "training" | "ce_ct";
  durationMinutes: number;
  maxRawScore: number;
  questions: SnapshotQuestion[];
};

function optionsFromQuestion(question: QuestionForSnapshot) {
  return {
    ...(question.optionA ? { A: question.optionA } : {}),
    ...(question.optionB ? { B: question.optionB } : {}),
    ...(question.optionC ? { C: question.optionC } : {}),
    ...(question.optionD ? { D: question.optionD } : {})
  };
}

export function buildTestSnapshot(test: TestForSnapshot): TestSnapshot {
  return {
    testId: test.id,
    title: test.title,
    subject: "russian",
    mode: fromPrismaTestMode(test.mode),
    durationMinutes: test.durationMinutes,
    maxRawScore: test.maxRawScore,
    questions: test.questions.map((question, index) => {
      const questionType = fromPrismaQuestionType(question.questionType);
      return {
        snapshotQuestionId: `q_${index + 1}`,
        originalQuestionId: question.id,
        orderIndex: question.orderIndex,
        questionText: question.questionText,
        questionType,
        options: optionsFromQuestion(question),
        correctAnswer: question.correctAnswer,
        topic: question.topic,
        subtopic: question.subtopic,
        points: question.points,
        scoringRule: scoringRuleForQuestionType(questionType) === "EXACT_TEXT" ? "exact_text" : "full_match",
        explanation: question.explanation
      };
    })
  };
}

export function parseTestSnapshot(value: Prisma.JsonValue): TestSnapshot {
  return value as TestSnapshot;
}

export function serializeQuestionForStudent(question: SnapshotQuestion) {
  return {
    snapshotQuestionId: question.snapshotQuestionId,
    orderIndex: question.orderIndex,
    questionText: question.questionText,
    questionType: question.questionType,
    options: question.options,
    topic: question.topic,
    subtopic: question.subtopic
  };
}
