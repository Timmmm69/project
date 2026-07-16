import type { AuthenticStudentResultPayload as ServerAuthenticStudentResultPayload } from "@/lib/scoring/result-serialize";

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

export type GenericResultPayload = {
  attempt_id: string;
  test_title: string;
  status: "completed" | "expired" | "cancelled";
  mode: "training" | "ce_ct";
  exam_mode: "generic";
  raw_score: number;
  max_raw_score: number;
  scaled_score?: number | null;
  max_scaled_score?: number | null;
  scaled_score_note?: string | null;
  answer_details: ResultAnswerDetail[];
  mistakes: ResultAnswerDetail[];
};

export type AuthenticStudentResultPayload = ServerAuthenticStudentResultPayload;

export type ResultPayload = AuthenticStudentResultPayload | GenericResultPayload;

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

export function isAuthenticRikzRussianResult(
  result: ResultPayload
): result is AuthenticStudentResultPayload {
  return result.exam_mode === "rikz_russian_2026";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const authenticResultKeys = new Set([
  "status",
  "mode",
  "exam_mode",
  "raw_score",
  "max_raw_score",
  "part_a_score",
  "part_a_max_score",
  "part_b_score",
  "part_b_max_score"
]);

function hasValidAuthenticAggregates(result: Record<string, unknown>) {
  const values = [
    result.raw_score,
    result.max_raw_score,
    result.part_a_score,
    result.part_a_max_score,
    result.part_b_score,
    result.part_b_max_score
  ];
  if (!values.every(isFiniteNonNegativeNumber)) return false;
  const rawScore = result.raw_score as number;
  const maxRawScore = result.max_raw_score as number;
  const partAScore = result.part_a_score as number;
  const partAMaxScore = result.part_a_max_score as number;
  const partBScore = result.part_b_score as number;
  const partBMaxScore = result.part_b_max_score as number;
  return rawScore <= maxRawScore
    && partAScore <= partAMaxScore
    && partBScore <= partBMaxScore
    && partAScore + partBScore === rawScore
    && partAMaxScore + partBMaxScore === maxRawScore
    && maxRawScore === 80;
}

export function parseAuthenticStudentResultPayload(value: unknown): AuthenticStudentResultPayload | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== authenticResultKeys.size || keys.some((key) => !authenticResultKeys.has(key))) {
    return null;
  }
  if (
    (value.status !== "completed" && value.status !== "expired")
    || value.mode !== "ce_ct"
    || value.exam_mode !== "rikz_russian_2026"
    || !hasValidAuthenticAggregates(value)
  ) {
    return null;
  }
  return value as AuthenticStudentResultPayload;
}

export function parseResultPayload(value: unknown): ResultPayload | null {
  if (!isRecord(value)) return null;
  if (value.exam_mode === "rikz_russian_2026") {
    return parseAuthenticStudentResultPayload(value);
  }
  return value as GenericResultPayload;
}

export function buildAuthenticResultSummary(
  result: AuthenticStudentResultPayload
): AuthenticResultSummary | null {
  if (result.status !== "completed" && result.status !== "expired") return null;
  if (!hasValidAuthenticAggregates(result as unknown as Record<string, unknown>)) return null;

  return {
    status: result.status,
    primaryScore: result.raw_score,
    primaryMax: result.max_raw_score,
    partA: { score: result.part_a_score, maxScore: result.part_a_max_score },
    partB: { score: result.part_b_score, maxScore: result.part_b_max_score }
  };
}

export function getScaledScoreDisplay(
  result: Pick<GenericResultPayload, "exam_mode"> & {
    scaled_score?: unknown;
    max_scaled_score?: unknown;
  }
) {
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
