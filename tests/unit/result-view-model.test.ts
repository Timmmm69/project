import { describe, expect, it } from "vitest";
import {
  buildAuthenticResultSummary,
  buildPartBreakdown,
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
  part_b_max_score: 44
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
    ["missing field", Object.fromEntries(Object.entries(authenticPayload).filter(([key]) => key !== "part_b_score"))]
  ])("rejects authentic payload with %s", (_label, payload) => {
    expect(parseAuthenticStudentResultPayload(payload)).toBeNull();
    expect(parseResultPayload(payload)).toBeNull();
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
      primaryScore: 80,
      primaryMax: 80,
      partA: { score: 36, maxScore: 36 },
      partB: { score: 44, maxScore: 44 }
    });
    expect(buildAuthenticResultSummary({ ...authenticPayload, status: "expired" })).toEqual({
      status: "expired",
      primaryScore: 80,
      primaryMax: 80,
      partA: { score: 36, maxScore: 36 },
      partB: { score: 44, maxScore: 44 }
    });
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
