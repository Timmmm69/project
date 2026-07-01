import type { Test } from "@prisma/client";
import { fromPrismaTestMode, fromPrismaTestStatus } from "@/lib/tests/enums";

export function serializeTest(test: Test) {
  return {
    id: test.id,
    title: test.title,
    slug: test.slug,
    subject: "russian",
    mode: fromPrismaTestMode(test.mode),
    shortDescription: test.shortDescription,
    fullDescription: test.fullDescription,
    price: test.price,
    currency: test.currency,
    durationMinutes: test.durationMinutes,
    attemptsLimit: test.attemptsLimit,
    accessDays: test.accessDays,
    status: fromPrismaTestStatus(test.status),
    questionsCount: test.questionsCount,
    maxRawScore: test.maxRawScore,
    scoringSchemeId: test.scoringSchemeId,
    showScaledScore: test.showScaledScore,
    showPercent: test.showPercent,
    showCorrectAnswers: test.showCorrectAnswers,
    showTopicResult: test.showTopicResult,
    showRecommendations: test.showRecommendations,
    publishedAt: test.publishedAt,
    createdAt: test.createdAt,
    updatedAt: test.updatedAt,
    deletedAt: test.deletedAt
  };
}
