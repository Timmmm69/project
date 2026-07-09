import type { ExamMode, OfficialPart, Prisma, QuestionType, ResponseSubtype, Subject, TestMode } from "@prisma/client";
import { fromPrismaQuestionType, scoringRuleForQuestionType } from "@/lib/questions/enums";
import { fromPrismaExamMode, fromPrismaTestMode } from "@/lib/tests/enums";

type QuestionForSnapshot = {
  id: string;
  questionText: string;
  questionType: QuestionType;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  optionE?: string | null;
  correctAnswer: string;
  topic: string;
  subtopic: string | null;
  points: number;
  explanation: string | null;
  officialPart?: OfficialPart | null;
  officialNumber?: number | null;
  responseSubtype?: ResponseSubtype | null;
  partialPolicy?: string | null;
  acceptedAnswers?: Prisma.JsonValue | null;
  normalizationPolicy?: Prisma.JsonValue | null;
  expertReviewerName?: string | null;
  expertReviewedAt?: Date | null;
  orderIndex: number;
};

type TestForSnapshot = {
  id: string;
  title: string;
  mode: TestMode;
  examMode?: ExamMode;
  subjectCode?: string | null;
  officialYear?: number | null;
  durationMinutes: number;
  maxRawScore: number;
  questions: QuestionForSnapshot[];
  scoringScheme?: ScoringSchemeForSnapshot | null;
};

type ScoringSchemeForSnapshot = {
  id: string;
  name: string;
  subject: Subject;
  examType: string;
  year: number | null;
  maxRawScore: number;
  maxScaledScore: number;
  scales: Array<{
    rawScore: number;
    scaledScore: number;
  }>;
};

export type SnapshotQuestion = {
  snapshotQuestionId: string;
  originalQuestionId: string;
  orderIndex: number;
  questionText: string;
  questionType: "single_choice" | "multiple_choice" | "short_text" | "multi_select_five" | "short_answer_token";
  options: {
    A?: string;
    B?: string;
    C?: string;
    D?: string;
    E?: string;
  };
  correctAnswer: string;
  topic: string;
  subtopic: string | null;
  points: number;
  scoringRule: "full_match" | "exact_text";
  explanation: string | null;
  officialPart?: "A" | "B" | null;
  officialNumber?: number | null;
  responseSubtype?: "word" | "digits" | "alnum" | null;
  partialPolicy?: string | null;
  acceptedAnswers?: Prisma.JsonValue | null;
  normalizationPolicy?: Prisma.JsonValue | null;
  expertReviewerName?: string | null;
  expertReviewedAt?: string | null;
};

export type TestSnapshot = {
  testId: string;
  title: string;
  subject: "russian";
  mode: "training" | "ce_ct";
  examMode?: "generic" | "rikz_russian_2026";
  subjectCode?: string | null;
  officialYear?: number | null;
  durationMinutes: number;
  maxRawScore: number;
  questions: SnapshotQuestion[];
};

export type ScoringSchemeSnapshot = {
  scoringSchemeId: string;
  name: string;
  subject: "russian";
  examType: string;
  year: number | null;
  maxRawScore: number;
  maxScaledScore: number;
  scale: Array<{
    rawScore: number;
    scaledScore: number;
  }>;
};

function optionsFromQuestion(question: QuestionForSnapshot) {
  return {
    ...(question.optionA ? { A: question.optionA } : {}),
    ...(question.optionB ? { B: question.optionB } : {}),
    ...(question.optionC ? { C: question.optionC } : {}),
    ...(question.optionD ? { D: question.optionD } : {}),
    ...(question.optionE ? { E: question.optionE } : {})
  };
}

export function buildTestSnapshot(test: TestForSnapshot): TestSnapshot {
  return {
    testId: test.id,
    title: test.title,
    subject: "russian",
    mode: fromPrismaTestMode(test.mode),
    examMode: test.examMode ? fromPrismaExamMode(test.examMode) : "generic",
    subjectCode: test.subjectCode ?? null,
    officialYear: test.officialYear ?? null,
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
        explanation: question.explanation,
        officialPart: question.officialPart ?? null,
        officialNumber: question.officialNumber ?? null,
        responseSubtype: question.responseSubtype
          ? ({ WORD: "word", DIGITS: "digits", ALNUM: "alnum" } as const)[question.responseSubtype]
          : null,
        partialPolicy: question.partialPolicy ?? null,
        acceptedAnswers: question.acceptedAnswers ?? null,
        normalizationPolicy: question.normalizationPolicy ?? null,
        expertReviewerName: question.expertReviewerName ?? null,
        expertReviewedAt: question.expertReviewedAt?.toISOString() ?? null
      };
    })
  };
}

export function buildScoringSchemeSnapshot(test: TestForSnapshot): ScoringSchemeSnapshot | null {
  if (!test.scoringScheme) {
    return null;
  }

  return {
    scoringSchemeId: test.scoringScheme.id,
    name: test.scoringScheme.name,
    subject: "russian",
    examType: test.scoringScheme.examType,
    year: test.scoringScheme.year,
    maxRawScore: test.scoringScheme.maxRawScore,
    maxScaledScore: test.scoringScheme.maxScaledScore,
    scale: test.scoringScheme.scales
      .map((scale) => ({
        rawScore: scale.rawScore,
        scaledScore: scale.scaledScore
      }))
      .sort((left, right) => left.rawScore - right.rawScore)
  };
}

export function parseTestSnapshot(value: Prisma.JsonValue): TestSnapshot {
  return value as TestSnapshot;
}

export function parseScoringSchemeSnapshot(value: Prisma.JsonValue | null): ScoringSchemeSnapshot | null {
  return value as ScoringSchemeSnapshot | null;
}

export function serializeQuestionForStudent(question: SnapshotQuestion) {
  return {
    snapshotQuestionId: question.snapshotQuestionId,
    orderIndex: question.orderIndex,
    questionText: question.questionText,
    questionType: question.questionType,
    officialPart: question.officialPart ?? null,
    officialNumber: question.officialNumber ?? null,
    options: question.options,
    topic: question.topic,
    subtopic: question.subtopic
  };
}
