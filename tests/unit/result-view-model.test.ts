import { describe, expect, it } from "vitest";
import {
  buildAuthenticResultSummary,
  buildPartBreakdown,
  formatAuthenticResultCompletedAt,
  formatResultQuestionLabel,
  getScaledScoreDisplay,
  isAuthenticRikzRussianResult,
  parseAuthenticStudentResultPayload,
  parseResultPayload,
  type AuthenticStudentResultPayload,
  type GenericResultPayload,
  type ResultAnswerDetail
} from "@/app/(public)/results/[attemptId]/result-view-model";

const authenticPayload: AuthenticStudentResultPayload = {
  status: "completed",
  mode: "ce_ct",
  exam_mode: "rikz_russian_2026",
  raw_score: 80,
  max_raw_score: 80,
  part_a_score: 36,
  part_a_max_score: 36,
  part_b_score: 44,
  part_b_max_score: 44,
  completed_at: "2026-07-16T17:05:00.000Z"
};

const partADetail: ResultAnswerDetail = {
  snapshot_question_id: "a_1",
  order_index: 1,
  question_text: "Generic Part A",
  question_type: "multi_select_five",
  official_part: "A",
  official_number: 1,
  response_subtype: null,
  selected_answer: "A,C",
  normalized_answer: null,
  correct_answer: "A,C",
  topic: "Topic A",
  subtopic: null,
  points_earned: 2,
  max_points: 2,
  explanation: "Generic explanation"
};

const partBDetail: ResultAnswerDetail = {
  ...partADetail,
  snapshot_question_id: "b_1",
  order_index: 19,
  question_text: "Generic Part B",
  question_type: "short_answer_token",
  official_part: "B",
  selected_answer: "token",
  normalized_answer: "token",
  correct_answer: "token",
  response_subtype: "word"
};

function genericPayload(overrides: Partial<GenericResultPayload> = {}): GenericResultPayload {
  return {
    attempt_id: "attempt-1",
    test_title: "Generic training test",
    status: "completed",
    mode: "training",
    exam_mode: "generic",
    raw_score: 4,
    max_raw_score: 4,
    scaled_score: 77,
    max_scaled_score: 100,
    scaled_score_note: null,
    answer_details: [partADetail, partBDetail],
    mistakes: [partBDetail],
    ...overrides
  };
}

describe("authentic Result runtime contract", () => {
  it("accepts only the exact aggregate-only payload", () => {
    expect(parseAuthenticStudentResultPayload(authenticPayload)).toEqual(authenticPayload);
    expect(parseResultPayload(authenticPayload)).toEqual(authenticPayload);
    expect(isAuthenticRikzRussianResult(authenticPayload)).toBe(true);
  });

  it.each([
    ["unknown field", { ...authenticPayload, unexpected: true }],
    ["answer details", { ...authenticPayload, answer_details: [] }],
    ["mistakes", { ...authenticPayload, mistakes: [] }],
    ["question field", { ...authenticPayload, question_text: "private" }],
    ["scaled score", { ...authenticPayload, scaled_score: 100 }],
    ["attempt id", { ...authenticPayload, attempt_id: "private" }],
    ["finished_at", { ...authenticPayload, finished_at: authenticPayload.completed_at }],
    ["started_at", { ...authenticPayload, started_at: "2026-07-16T15:05:00.000Z" }],
    ["missing completed_at", Object.fromEntries(Object.entries(authenticPayload).filter(([key]) => key !== "completed_at"))],
    ["missing field", Object.fromEntries(Object.entries(authenticPayload).filter(([key]) => key !== "part_b_score"))]
  ])("rejects authentic payload with %s", (_label, payload) => {
    expect(parseAuthenticStudentResultPayload(payload)).toBeNull();
    expect(parseResultPayload(payload)).toBeNull();
  });

  it.each([
    ["null", null],
    ["number", 1_752_685_500_000],
    ["local date", "16 июля 2026, 20:05"],
    ["without timezone", "2026-07-16T17:05:00.000"],
    ["with offset", "2026-07-16T20:05:00.000+03:00"],
    ["without milliseconds", "2026-07-16T17:05:00Z"],
    ["invalid calendar date", "2026-02-30T17:05:00.000Z"]
  ])("rejects non-canonical completed_at: %s", (_label, completedAt) => {
    expect(parseAuthenticStudentResultPayload({
      ...authenticPayload,
      completed_at: completedAt
    })).toBeNull();
  });

  it("accepts canonical UTC ISO with milliseconds and Z", () => {
    expect(parseAuthenticStudentResultPayload(authenticPayload)?.completed_at)
      .toBe("2026-07-16T17:05:00.000Z");
  });

  it.each([
    ["invalid status", { ...authenticPayload, status: "cancelled" }],
    ["invalid mode", { ...authenticPayload, mode: "training" }],
    ["negative total", { ...authenticPayload, raw_score: -1 }],
    ["non-finite total", { ...authenticPayload, raw_score: Number.NaN }],
    ["score above max", { ...authenticPayload, raw_score: 81 }],
    ["Part A above max", { ...authenticPayload, part_a_score: 37, part_b_score: 43 }],
    ["part score mismatch", { ...authenticPayload, part_a_score: 35 }],
    ["part max mismatch", { ...authenticPayload, part_a_max_score: 35 }],
    ["wrong max total", { ...authenticPayload, max_raw_score: 79, part_b_max_score: 43 }]
  ])("rejects malformed authentic aggregate: %s", (_label, payload) => {
    expect(parseAuthenticStudentResultPayload(payload)).toBeNull();
  });

  it("builds completed and expired summaries without question-level data", () => {
    expect(buildAuthenticResultSummary(authenticPayload)).toEqual({
      status: "completed",
      completedAt: "16 июля 2026, 20:05 (Минск)",
      primaryScore: 80,
      primaryMax: 80,
      partA: { score: 36, maxScore: 36 },
      partB: { score: 44, maxScore: 44 }
    });
    expect(buildAuthenticResultSummary({ ...authenticPayload, status: "expired" })).toEqual({
      status: "expired",
      completedAt: "16 июля 2026, 20:05 (Минск)",
      primaryScore: 80,
      primaryMax: 80,
      partA: { score: 36, maxScore: 36 },
      partB: { score: 44, maxScore: 44 }
    });
  });

  it("formats summer and winter timestamps deterministically in Europe/Minsk", () => {
    expect(formatAuthenticResultCompletedAt("2026-07-16T17:05:00.000Z"))
      .toBe("16 июля 2026, 20:05 (Минск)");
    expect(formatAuthenticResultCompletedAt("2026-01-05T01:02:00.000Z"))
      .toBe("5 января 2026, 04:02 (Минск)");
  });

  it("does not depend on the host timezone", () => {
    const previousTimezone = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const losAngeles = formatAuthenticResultCompletedAt(authenticPayload.completed_at);
      process.env.TZ = "Asia/Tokyo";
      const tokyo = formatAuthenticResultCompletedAt(authenticPayload.completed_at);
      expect(losAngeles).toBe("16 июля 2026, 20:05 (Минск)");
      expect(tokyo).toBe(losAngeles);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("does not create a formatter or success summary from an invalid timestamp", () => {
    expect(formatAuthenticResultCompletedAt("2026-07-16T20:05:00.000+03:00")).toBeNull();
    const malformed = {
      ...authenticPayload,
      completed_at: "2026-07-16T20:05:00.000+03:00"
    } as AuthenticStudentResultPayload;
    expect(buildAuthenticResultSummary(malformed)).toBeNull();
  });

  it("returns not ready for a malformed summary object and never mutates it", () => {
    const malformed = { ...authenticPayload, part_b_score: 43 } as AuthenticStudentResultPayload;
    const before = structuredClone(malformed);

    expect(buildAuthenticResultSummary(malformed)).toBeNull();
    expect(malformed).toEqual(before);
  });
});

describe("generic Result compatibility", () => {
  it("keeps generic detailed payload parsing and display", () => {
    const payload = genericPayload();
    expect(parseResultPayload(payload)).toBe(payload);
    expect(isAuthenticRikzRussianResult(payload)).toBe(false);
    expect(getScaledScoreDisplay(payload)).toEqual({ score: 77, maxScore: 100 });
  });

  it.each([
    { scaled_score: 77, max_scaled_score: null, expected: { score: 77, maxScore: 100 } },
    { scaled_score: 77, max_scaled_score: undefined, expected: { score: 77, maxScore: 100 } },
    { scaled_score: 0, max_scaled_score: null, expected: { score: 0, maxScore: 100 } }
  ])("uses the existing generic 100-point fallback: %j", (fields) => {
    expect(getScaledScoreDisplay({
      exam_mode: "generic",
      scaled_score: fields.scaled_score,
      max_scaled_score: fields.max_scaled_score
    })).toEqual(fields.expected);
  });

  it.each([
    {},
    { scaled_score: null },
    { scaled_score: "77", max_scaled_score: 100 },
    { scaled_score: Number.NaN, max_scaled_score: 100 },
    { scaled_score: -1, max_scaled_score: 100 },
    { scaled_score: 101, max_scaled_score: 100 }
  ])("returns null for malformed generic scaled fields: %j", (fields) => {
    expect(getScaledScoreDisplay({ exam_mode: "generic", ...fields })).toBeNull();
  });

  it("preserves generic part helpers and labels", () => {
    expect(buildPartBreakdown([partADetail, partBDetail])).toEqual([
      { part: "A", count: 1, score: 2, maxScore: 2 },
      { part: "B", count: 1, score: 2, maxScore: 2 }
    ]);
    expect(formatResultQuestionLabel(partADetail)).toBe("Part A1");
  });
});
