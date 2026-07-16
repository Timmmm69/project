import { describe, expect, it } from "vitest";
import {
  buildAuthenticResultSummary,
  buildPartBreakdown,
  formatResultQuestionLabel,
  getScaledScoreDisplay,
  isAuthenticRikzRussianResult,
  type ResultAnswerDetail,
  type ResultPayload
} from "@/app/(public)/results/[attemptId]/result-view-model";

const partADetail: ResultAnswerDetail = {
  snapshot_question_id: "a_1",
  order_index: 1,
  question_text: "Placeholder Part A",
  question_type: "multi_select_five",
  official_part: "A",
  official_number: 1,
  response_subtype: null,
  selected_answer: "A,C",
  normalized_answer: null,
  correct_answer: null,
  topic: "Topic A",
  subtopic: null,
  points_earned: 36,
  max_points: 36,
  explanation: null
};

const partBDetail: ResultAnswerDetail = {
  snapshot_question_id: "b_1",
  order_index: 19,
  question_text: "Placeholder Part B",
  question_type: "short_answer_token",
  official_part: "B",
  official_number: 1,
  response_subtype: "word",
  selected_answer: "еж",
  normalized_answer: "еж",
  correct_answer: null,
  topic: "Topic B",
  subtopic: null,
  points_earned: 44,
  max_points: 44,
  explanation: null
};

function resultPayload(overrides: Partial<ResultPayload>): ResultPayload {
  return {
    attempt_id: "attempt-1",
    test_title: "Training test",
    status: "completed",
    mode: "ce_ct",
    exam_mode: "rikz_russian_2026",
    raw_score: 80,
    max_raw_score: 80,
    scaled_score: 77,
    max_scaled_score: 100,
    scaled_score_note: null,
    answer_details: [partADetail, partBDetail],
    mistakes: [partBDetail],
    ...overrides
  };
}

describe("result view model", () => {
  it("builds a completed authentic aggregate summary", () => {
    expect(buildAuthenticResultSummary(resultPayload({}))).toEqual({
      status: "completed",
      primaryScore: 80,
      primaryMax: 80,
      partA: { score: 36, maxScore: 36 },
      partB: { score: 44, maxScore: 44 }
    });
  });

  it("builds an expired authentic aggregate summary", () => {
    expect(buildAuthenticResultSummary(resultPayload({ status: "expired" }))).toEqual({
      status: "expired",
      primaryScore: 80,
      primaryMax: 80,
      partA: { score: 36, maxScore: 36 },
      partB: { score: 44, maxScore: 44 }
    });
  });

  it("keeps generic results on the generic display path", () => {
    const result = resultPayload({
      mode: "training",
      exam_mode: "generic",
      answer_details: [],
      mistakes: [partBDetail]
    });

    expect(isAuthenticRikzRussianResult(result)).toBe(false);
    expect(buildAuthenticResultSummary(result)).toBeNull();
  });

  it("returns not ready when Part A is missing", () => {
    expect(buildAuthenticResultSummary(resultPayload({
      answer_details: [partBDetail],
      raw_score: 44,
      max_raw_score: 44
    }))).toBeNull();
  });

  it("returns not ready when Part B is missing", () => {
    expect(buildAuthenticResultSummary(resultPayload({
      answer_details: [partADetail],
      raw_score: 36,
      max_raw_score: 36
    }))).toBeNull();
  });

  it("returns not ready for a cancelled authentic payload", () => {
    expect(buildAuthenticResultSummary(resultPayload({ status: "cancelled" }))).toBeNull();
  });

  it.each([
    { raw_score: Number.NaN },
    { max_raw_score: Number.POSITIVE_INFINITY },
    {
      answer_details: [
        { ...partADetail, points_earned: Number.NaN },
        partBDetail
      ]
    },
    {
      answer_details: [
        partADetail,
        { ...partBDetail, max_points: Number.POSITIVE_INFINITY }
      ]
    }
  ])("returns not ready for non-finite aggregate data: %j", (overrides) => {
    expect(buildAuthenticResultSummary(resultPayload(overrides))).toBeNull();
  });

  it.each([
    { raw_score: -1 },
    { max_raw_score: -1 },
    {
      answer_details: [
        { ...partADetail, points_earned: -1 },
        partBDetail
      ]
    },
    {
      answer_details: [
        partADetail,
        { ...partBDetail, max_points: -1 }
      ]
    }
  ])("returns not ready for negative aggregate data: %j", (overrides) => {
    expect(buildAuthenticResultSummary(resultPayload(overrides))).toBeNull();
  });

  it("does not mutate the authentic Result payload", () => {
    const result = resultPayload({});
    const before = structuredClone(result);

    buildAuthenticResultSummary(result);

    expect(result).toEqual(before);
  });

  it("does not create a scaled card for an authentic primary-only payload", () => {
    const display = getScaledScoreDisplay(
      resultPayload({ scaled_score: undefined, max_scaled_score: undefined, scaled_score_note: undefined })
    );

    expect(display).toBeNull();
  });

  it("ignores unexpected scaled fields for an authentic primary-only payload", () => {
    const display = getScaledScoreDisplay(
      resultPayload({ scaled_score: 77, max_scaled_score: 100 })
    );

    expect(display).toBeNull();
  });

  it("preserves the generic scaled-score display", () => {
    const display = getScaledScoreDisplay(
      resultPayload({
        exam_mode: "generic",
        scaled_score: 77,
        max_scaled_score: 100
      })
    );

    expect(display).toEqual({ score: 77, maxScore: 100 });
  });

  it.each([
    { scaled_score: 77, max_scaled_score: null, expected: { score: 77, maxScore: 100 } },
    { scaled_score: 77, max_scaled_score: undefined, expected: { score: 77, maxScore: 100 } },
    { scaled_score: 0, max_scaled_score: null, expected: { score: 0, maxScore: 100 } }
  ])("uses the generic 100-point fallback when max score is absent: %j", (fields) => {
    expect(
      getScaledScoreDisplay({
        exam_mode: "generic",
        scaled_score: fields.scaled_score,
        max_scaled_score: fields.max_scaled_score
      })
    ).toEqual(fields.expected);
  });

  it.each([
    {},
    { scaled_score: null },
    { scaled_score: "77", max_scaled_score: 100 },
    { scaled_score: Number.NaN, max_scaled_score: 100 },
    { scaled_score: 77, max_scaled_score: "100" },
    { scaled_score: 77, max_scaled_score: Number.NaN },
    { scaled_score: 77, max_scaled_score: Number.POSITIVE_INFINITY },
    { scaled_score: -1, max_scaled_score: 100 },
    { scaled_score: 77, max_scaled_score: 0 },
    { scaled_score: 101, max_scaled_score: 100 }
  ])("returns null for missing or malformed scaled fields: %j", (fields) => {
    expect(getScaledScoreDisplay({ exam_mode: "generic", ...fields })).toBeNull();
  });

  it("builds Part A and Part B breakdown from completed answer details", () => {
    expect(buildPartBreakdown([partADetail, partBDetail])).toEqual([
      { part: "A", count: 1, score: 36, maxScore: 36 },
      { part: "B", count: 1, score: 44, maxScore: 44 }
    ]);
  });

  it("labels authentic questions by part and official number", () => {
    expect(formatResultQuestionLabel(partADetail)).toBe("Part A1");
  });
});
