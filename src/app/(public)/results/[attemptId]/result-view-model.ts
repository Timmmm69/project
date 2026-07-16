export type ResultQuestionType =
  | "single_choice"
  | "multiple_choice"
  | "short_text"
  | "multi_select_five"
  | "short_answer_token";

export type ResultAnswerDetail = {
  snapshot_question_id: string;
  order_index: number;
  question_text: string;
  question_type: ResultQuestionType;
  official_part: "A" | "B" | null;
  official_number: number | null;
  response_subtype: "word" | "digits" | "alnum" | null;
  selected_answer: string;
  normalized_answer: string | null;
  correct_answer: string | null;
  topic: string | null;
  subtopic: string | null;
  points_earned: number;
  max_points: number;
  explanation: string | null;
};

export type ResultPayload = {
  attempt_id: string;
  test_title: string;
  status: "completed" | "expired" | "cancelled";
  mode: "training" | "ce_ct";
  exam_mode: "generic" | "rikz_russian_2026";
  raw_score: number;
  max_raw_score: number;
  scaled_score?: number | null;
  max_scaled_score?: number | null;
  scaled_score_note?: string | null;
  answer_details: ResultAnswerDetail[];
  mistakes: ResultAnswerDetail[];
};

export type PartBreakdown = {
  part: "A" | "B";
  count: number;
  score: number;
  maxScore: number;
};

export type AuthenticResultSummary = Readonly<{
  status: "completed" | "expired";
  primaryScore: number;
  primaryMax: number;
  partA: Readonly<{ score: number; maxScore: number }>;
  partB: Readonly<{ score: number; maxScore: number }>;
}>;

export function isAuthenticRikzRussianResult(result: Pick<ResultPayload, "exam_mode">) {
  return result.exam_mode === "rikz_russian_2026";
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function buildAuthenticResultSummary(result: ResultPayload): AuthenticResultSummary | null {
  if (!isAuthenticRikzRussianResult(result)) return null;
  if (result.status !== "completed" && result.status !== "expired") return null;
  if (
    !isFiniteNonNegativeNumber(result.raw_score)
    || !isFiniteNonNegativeNumber(result.max_raw_score)
    || result.max_raw_score <= 0
    || result.raw_score > result.max_raw_score
  ) {
    return null;
  }
  if (!Array.isArray(result.answer_details)) return null;

  const parts = {
    A: { count: 0, score: 0, maxScore: 0 },
    B: { count: 0, score: 0, maxScore: 0 }
  };

  for (const detail of result.answer_details) {
    if (detail.official_part !== "A" && detail.official_part !== "B") continue;
    if (
      !isFiniteNonNegativeNumber(detail.points_earned)
      || !isFiniteNonNegativeNumber(detail.max_points)
      || detail.max_points <= 0
      || detail.points_earned > detail.max_points
    ) {
      return null;
    }

    const part = parts[detail.official_part];
    part.count += 1;
    part.score += detail.points_earned;
    part.maxScore += detail.max_points;
  }

  if (parts.A.count === 0 || parts.B.count === 0) return null;
  if (
    parts.A.score + parts.B.score !== result.raw_score
    || parts.A.maxScore + parts.B.maxScore !== result.max_raw_score
  ) {
    return null;
  }

  return {
    status: result.status,
    primaryScore: result.raw_score,
    primaryMax: result.max_raw_score,
    partA: { score: parts.A.score, maxScore: parts.A.maxScore },
    partB: { score: parts.B.score, maxScore: parts.B.maxScore }
  };
}

export function getScaledScoreDisplay(
  result: Pick<ResultPayload, "exam_mode"> & {
    scaled_score?: unknown;
    max_scaled_score?: unknown;
  }
) {
  if (result.exam_mode === "rikz_russian_2026") {
    return null;
  }

  if (
    typeof result.scaled_score !== "number" ||
    !Number.isFinite(result.scaled_score) ||
    result.scaled_score < 0
  ) {
    return null;
  }

  if (result.max_scaled_score === undefined || result.max_scaled_score === null) {
    return {
      score: result.scaled_score,
      maxScore: 100
    };
  }

  if (
    typeof result.max_scaled_score !== "number" ||
    !Number.isFinite(result.max_scaled_score) ||
    result.max_scaled_score <= 0 ||
    result.scaled_score > result.max_scaled_score
  ) {
    return null;
  }

  return {
    score: result.scaled_score,
    maxScore: result.max_scaled_score
  };
}

export function buildPartBreakdown(answerDetails: ResultAnswerDetail[]): PartBreakdown[] {
  const parts: Record<"A" | "B", PartBreakdown> = {
    A: { part: "A", count: 0, score: 0, maxScore: 0 },
    B: { part: "B", count: 0, score: 0, maxScore: 0 }
  };

  for (const detail of answerDetails) {
    if (detail.official_part !== "A" && detail.official_part !== "B") {
      continue;
    }

    const part = parts[detail.official_part];
    part.count += 1;
    part.score += detail.points_earned;
    part.maxScore += detail.max_points;
  }

  return Object.values(parts).filter((part) => part.count > 0);
}

export function formatResultQuestionLabel(detail: ResultAnswerDetail) {
  if (detail.official_part && detail.official_number !== null) {
    return `Part ${detail.official_part}${detail.official_number}`;
  }

  return `Question ${detail.order_index}`;
}

export function formatResultQuestionType(detail: ResultAnswerDetail) {
  if (detail.question_type === "multi_select_five") {
    return "Multi-select A-E";
  }

  if (detail.question_type === "short_answer_token") {
    return detail.response_subtype ? `Token answer (${detail.response_subtype})` : "Token answer";
  }

  return detail.question_type.replaceAll("_", " ");
}
