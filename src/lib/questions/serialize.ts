import type { Question } from "@prisma/client";
import { fromPrismaDifficulty, fromPrismaQuestionType } from "@/lib/questions/enums";

export function serializeQuestion(question: Question) {
  return {
    id: question.id,
    testId: question.testId,
    questionText: question.questionText,
    questionType: fromPrismaQuestionType(question.questionType),
    optionA: question.optionA,
    optionB: question.optionB,
    optionC: question.optionC,
    optionD: question.optionD,
    optionE: question.optionE,
    correctAnswer: question.correctAnswer,
    topic: question.topic,
    subtopic: question.subtopic,
    difficulty: fromPrismaDifficulty(question.difficulty),
    points: question.points,
    scoringRule: question.scoringRule === "EXACT_TEXT" ? "exact_text" : "full_match",
    explanation: question.explanation,
    source: question.source,
    officialPart: question.officialPart,
    officialNumber: question.officialNumber,
    responseSubtype: question.responseSubtype,
    partialPolicy: question.partialPolicy,
    acceptedAnswers: question.acceptedAnswers,
    normalizationPolicy: question.normalizationPolicy,
    expertReviewerName: question.expertReviewerName,
    expertReviewedAt: question.expertReviewedAt,
    orderIndex: question.orderIndex,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    deletedAt: question.deletedAt
  };
}
