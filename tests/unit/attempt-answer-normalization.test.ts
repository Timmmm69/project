import { describe, expect, it } from "vitest";
import { normalizeAttemptAnswer } from "@/lib/attempts/answer-normalization";
import { toggleMultipleAnswer } from "@/app/(public)/attempts/[attemptId]/attempt-runner";

describe("attempt answer normalization", () => {
  it("keeps generic multiple choice answers stable for scoring", () => {
    expect(normalizeAttemptAnswer("multiple_choice", " c, A, c ")).toBe("A,C");
  });

  it("serializes multi_select_five answers in stable A-E order", () => {
    expect(toggleMultipleAnswer("", "E")).toBe("E");
    expect(toggleMultipleAnswer("E", "A")).toBe("A,E");
    expect(toggleMultipleAnswer("A,E", "E")).toBe("A");
  });

  it("keeps short_answer_token raw while the scoring layer normalizes later", () => {
    expect(normalizeAttemptAnswer("short_answer_token", "  ЁЖ  ")).toBe("  ЁЖ  ");
  });
});
