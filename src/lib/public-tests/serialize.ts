import type { Test } from "@prisma/client";
import { fromPrismaTestMode } from "@/lib/tests/enums";

export type PublicTest = ReturnType<typeof serializePublicTest>;

export function serializePublicTest(test: Test) {
  return {
    id: test.id,
    title: test.title,
    slug: test.slug,
    mode: fromPrismaTestMode(test.mode),
    shortDescription: test.shortDescription,
    fullDescription: test.fullDescription,
    price: test.price,
    currency: test.currency,
    durationMinutes: test.durationMinutes,
    attemptsLimit: test.attemptsLimit,
    accessDays: test.accessDays,
    questionsCount: test.questionsCount,
    maxRawScore: test.maxRawScore,
    showScaledScore: test.showScaledScore,
    showPercent: test.showPercent,
    showCorrectAnswers: test.showCorrectAnswers,
    showTopicResult: test.showTopicResult,
    showRecommendations: test.showRecommendations,
    publishedAt: test.publishedAt
  };
}
