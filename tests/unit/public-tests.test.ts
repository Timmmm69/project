import { describe, expect, it } from "vitest";
import { serializePublicTest } from "@/lib/public-tests/serialize";

describe("public test serialization", () => {
  it("exposes only public test fields", () => {
    const serialized = serializePublicTest({
      id: "test-id",
      title: "Русский язык",
      slug: "russian",
      subject: "RUSSIAN",
      mode: "CE_CT",
      shortDescription: "Кратко",
      fullDescription: "Полное описание",
      price: 1500,
      currency: "BYN",
      durationMinutes: 60,
      attemptsLimit: 1,
      accessDays: 7,
      status: "PUBLISHED",
      questionsCount: 10,
      maxRawScore: 10,
      scoringSchemeId: null,
      showScaledScore: false,
      showPercent: true,
      showCorrectAnswers: true,
      showTopicResult: true,
      showRecommendations: true,
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdByAdminId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      deletedAt: null
    });

    expect(serialized.mode).toBe("ce_ct");
    expect(serialized.price).toBe(1500);
    expect(serialized).not.toHaveProperty("status");
    expect(serialized).not.toHaveProperty("deletedAt");
    expect(serialized).not.toHaveProperty("createdByAdminId");
  });
});
