import { describe, expect, it } from "vitest";
import {
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
  points_earned: 2,
  max_points: 2,
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
  points_earned: 0,
  max_points: 2,
  explanation: null
};

function resultPayload(overrides: Partial<ResultPayload>): ResultPayload {
  return {
    attempt_id: "attempt-1",
    test_title: "Training test",
    status: "completed",
    mode: "ce_ct",
    exam_mode: "rikz_russian_2026",
    raw_score: 64,
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
  it("keeps generic results on the generic display path", () => {
    const result = resultPayload({
      mode: "training",
      exam_mode: "generic",
      answer_details: [],
      mistakes: [partBDetail]
    });

    expect(isAuthenticRikzRussianResult(result)).toBe(false);
  });

  it("exposes backend-provided scaled score for full RIKZ Russian 2026 result", () => {
    const display = getScaledScoreDisplay(resultPayload({ scaled_score: 77, max_scaled_score: 100 }));

    expect(display).toEqual({ score: 77, maxScore: 100 });
  });

  it("does not invent scaled score for partial or demo RIKZ Russian 2026 result", () => {
    const display = getScaledScoreDisplay(
      resultPayload({
        raw_score: 80,
        max_raw_score: 80,
        scaled_score: null,
        max_scaled_score: null
      })
    );

    expect(display).toBeNull();
  });

  it("builds Part A and Part B breakdown from completed answer details", () => {
    expect(buildPartBreakdown([partADetail, partBDetail])).toEqual([
      { part: "A", count: 1, score: 2, maxScore: 2 },
      { part: "B", count: 1, score: 0, maxScore: 2 }
    ]);
  });

  it("labels authentic questions by part and official number", () => {
    expect(formatResultQuestionLabel(partADetail)).toBe("Part A1");
  });
});
