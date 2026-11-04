import { z } from "zod";

export const scoringStrategies = ["exact_match", "set_partial", "matching_partial"] as const;
export type ScoringStrategy = (typeof scoringStrategies)[number];
const distinct = (value: string) => new Set(value).size === value.length;
const policySchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), kind: z.literal("set"), alphabet: z.string().regex(/^(?:[A-E]+|[1-9]+)$/).refine(distinct) }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("matching"), positions: z.string().regex(/^АБВГД?$/), values: z.string().regex(/^[1-9]+$/).refine(distinct) }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("exact"), subtype: z.enum(["word", "digits", "alnum"]) }).strict()
]);
export type AnswerPolicy = z.infer<typeof policySchema>;
export type AnswerFormat =
  | { status: "empty"; normalized: null }
  | { status: "invalid"; normalized: null }
  | { status: "valid"; normalized: string };

// NFC and case are the only general transformations. Never strip arbitrary
// characters, fold е/ё, transliterate, or deduplicate an answer.
export function parsePolicyAnswer(answer: string | null, policy: AnswerPolicy): AnswerFormat {
  const value = (answer ?? "").trim().normalize("NFC");
  if (!value) return { status: "empty", normalized: null };
  const invalid: AnswerFormat = { status: "invalid", normalized: null };
  if (policy.kind === "set") {
    const upper = value.toUpperCase();
    // Compact tokens or individual tokens separated by whitespace / one comma.
    if (!/^[A-E1-9](?:(?:\s*,\s*|\s+)?[A-E1-9])*$/.test(upper)) return invalid;
    const elements = upper.replace(/[\s,]/g, "").split("");
    if (!elements.every((item) => policy.alphabet.includes(item)) || new Set(elements).size !== elements.length) return invalid;
    return { status: "valid", normalized: elements.sort().join("") };
  }
  if (policy.kind === "matching") {
    const upper = value.toUpperCase();
    // RIKZ requires complete, ordered pairs. Repeated numeric values are allowed;
    // repeated/missing labels, reordered pairs, Latin lookalikes are not.
    if (upper.length !== policy.positions.length * 2) return invalid;
    for (let index = 0; index < policy.positions.length; index += 1) {
      if (upper[index * 2] !== policy.positions[index] || !policy.values.includes(upper[index * 2 + 1])) return invalid;
    }
    return { status: "valid", normalized: upper };
  }
  const normalized = value.toLocaleLowerCase("ru");
  const pattern = policy.subtype === "digits" ? /^[0-9]+$/ : policy.subtype === "word"
    ? /^[\p{Script=Cyrillic}\p{M}]+$/u : /^[\p{Script=Cyrillic}\p{M}0-9]+$/u;
  return pattern.test(normalized) ? { status: "valid", normalized } : invalid;
}

export type PolicyQuestion = {
  questionType?: string | null;
  officialPart?: string | null;
  officialNumber?: number | null;
  responseSubtype?: string | null;
  points?: number | null;
  correctAnswer?: string | null;
  acceptedAnswers?: unknown;
  partialPolicy?: string | null;
  normalizationPolicy?: unknown;
};

// These defaults describe the existing five-option authored variant and legacy
// imports. Other option domains must be supplied explicitly as metadata.
export function defaultAnswerPolicy(question: PolicyQuestion): { partialPolicy: ScoringStrategy; normalizationPolicy: AnswerPolicy } {
  const subtype = question.responseSubtype?.toLowerCase();
  if (question.officialPart === "A") {
    return { partialPolicy: "set_partial", normalizationPolicy: { version: 1, kind: "set", alphabet: "ABCDE" } };
  }
  if (subtype === "digits" && [1, 7, 13, 14, 16, 18].includes(question.officialNumber ?? 0)) {
    return { partialPolicy: "set_partial", normalizationPolicy: { version: 1, kind: "set", alphabet: "12345" } };
  }
  if (subtype === "alnum" && [19, 20, 21, 22].includes(question.officialNumber ?? 0)) {
    return { partialPolicy: "matching_partial", normalizationPolicy: { version: 1, kind: "matching", positions: "АБВГ", values: "12345" } };
  }
  return { partialPolicy: "exact_match", normalizationPolicy: { version: 1, kind: "exact", subtype: subtype === "digits" || subtype === "alnum" ? subtype : "word" } };
}

export function answerKeys(question: PolicyQuestion): string[] {
  if (question.acceptedAnswers == null) return question.correctAnswer ? [question.correctAnswer] : [];
  if (!Array.isArray(question.acceptedAnswers) || question.acceptedAnswers.length === 0 || question.acceptedAnswers.some((key) => typeof key !== "string")) return [];
  return question.acceptedAnswers;
}

export function resolveAnswerPolicy(question: PolicyQuestion) {
  const defaults = defaultAnswerPolicy(question);
  // Legacy identifiers are upgraded only while creating a NEW snapshot/import.
  const partialPolicy = question.partialPolicy == null || ["none", "one_error_half_credit"].includes(question.partialPolicy)
    ? defaults.partialPolicy : question.partialPolicy;
  const normalizationPolicy = question.normalizationPolicy == null || question.normalizationPolicy === "conservative"
    ? defaults.normalizationPolicy : question.normalizationPolicy;
  return { partialPolicy, normalizationPolicy };
}

export function validateAnswerConfiguration(question: PolicyQuestion): string[] {
  const errors: string[] = [];
  const parsed = policySchema.safeParse(question.normalizationPolicy);
  if (!parsed.success) return ["Invalid normalizationPolicy"];
  const policy = parsed.data;
  const strategy = question.partialPolicy;
  const expectedKind = strategy === "set_partial" ? "set" : strategy === "matching_partial" ? "matching" : strategy === "exact_match" ? "exact" : null;
  if (expectedKind !== policy.kind) errors.push("Strategy and normalization policy do not agree");
  if (question.points !== 2) errors.push("Authentic questions must have exactly 2 points");
  const subtype = question.responseSubtype?.toLowerCase();
  if (question.officialPart === "A" && (policy.kind !== "set" || [...policy.alphabet].sort().join("") !== "ABCDE")) {
    errors.push("Part A requires the full A-E choice domain");
  }
  if (question.officialPart === "B") {
    if (policy.kind === "set" && (subtype !== "digits" || !/^[1-9]+$/.test(policy.alphabet))) errors.push("Part B sets require a numeric domain and digits responseSubtype");
    if (policy.kind === "matching" && subtype !== "alnum") errors.push("Matching requires alnum responseSubtype");
    if (policy.kind === "exact" && policy.subtype !== subtype) errors.push("Exact policy subtype must match responseSubtype");
    if ([1, 7, 13, 16, 18].includes(question.officialNumber ?? 0) && subtype !== "digits") errors.push("This task requires a digit set");
    if ([19, 20, 21, 22].includes(question.officialNumber ?? 0) && subtype !== "alnum") errors.push("This task requires matching pairs");
    if (strategy !== defaultAnswerPolicy(question).partialPolicy) errors.push("Strategy does not match this task model");
  }
  const keys = answerKeys(question);
  if (keys.length === 0 || keys.some((key) => parsePolicyAnswer(key, policy).status !== "valid")) errors.push("Every answer key must have a valid unambiguous format");
  if (question.correctAnswer && parsePolicyAnswer(question.correctAnswer, policy).status !== "valid") errors.push("Invalid correctAnswer");
  if (question.correctAnswer && keys.length > 0) {
    const correct = parsePolicyAnswer(question.correctAnswer, policy).normalized;
    if (!keys.some((key) => parsePolicyAnswer(key, policy).normalized === correct)) errors.push("correctAnswer must be an accepted key");
  }
  return errors;
}

export function readAnswerPolicy(value: unknown): AnswerPolicy {
  return policySchema.parse(value);
}

export function exactMatch(selected: string, correct: string) {
  return selected === correct ? 2 : 0;
}

export function setPartial(selected: string, correct: string) {
  let errors = 0;
  for (const token of correct) if (!selected.includes(token)) errors += 1;
  for (const token of selected) if (!correct.includes(token)) errors += 1;
  return errors === 0 ? 2 : errors === 1 ? 1 : 0;
}

export function matchingPartial(selected: string, correct: string) {
  let errors = 0;
  for (let index = 1; index < correct.length; index += 2) {
    if (correct[index] !== selected[index]) errors += 1;
  }
  return errors === 0 ? 2 : errors === 1 ? 1 : 0;
}

const strategies: Record<ScoringStrategy, (selected: string, correct: string) => number> = {
  exact_match: exactMatch,
  set_partial: setPartial,
  matching_partial: matchingPartial
};

export function scorePolicyAnswer(question: PolicyQuestion, answer: string | null) {
  const policy = readAnswerPolicy(question.normalizationPolicy);
  const strategy = scoringStrategies.find((item) => item === question.partialPolicy);
  if (!strategy) throw new Error("INVALID_SCORING_STRATEGY");
  const parsed = parsePolicyAnswer(answer, policy);
  if (parsed.status !== "valid") return { isCorrect: false, pointsEarned: 0, format: parsed.status };
  let pointsEarned = 0;
  for (const key of answerKeys(question)) {
    const correct = parsePolicyAnswer(key, policy);
    if (correct.status !== "valid") throw new Error("INVALID_SCORING_CONFIGURATION");
    pointsEarned = Math.max(pointsEarned, strategies[strategy](parsed.normalized, correct.normalized));
  }
  return { isCorrect: pointsEarned === 2, pointsEarned, format: "valid" as const };
}
