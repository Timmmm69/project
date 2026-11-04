import { describe, expect, it } from "vitest";
import {
  defaultAnswerPolicy,
  parsePolicyAnswer,
  readAnswerPolicy,
  resolveAnswerPolicy,
  scorePolicyAnswer,
  validateAnswerConfiguration,
  type AnswerPolicy,
  type PolicyQuestion
} from "@/lib/scoring/answer-policy";

const digitSet: AnswerPolicy = { version: 1, kind: "set", alphabet: "12345" };
const letterSet: AnswerPolicy = { version: 1, kind: "set", alphabet: "ABCDE" };
const matching: AnswerPolicy = { version: 1, kind: "matching", positions: "АБВГ", values: "12345" };
const word: AnswerPolicy = { version: 1, kind: "exact", subtype: "word" };
const digits: AnswerPolicy = { version: 1, kind: "exact", subtype: "digits" };

function setQuestion(keys = ["135"], normalizationPolicy: AnswerPolicy = digitSet): PolicyQuestion {
  return { points: 2, partialPolicy: "set_partial", normalizationPolicy, correctAnswer: keys[0], acceptedAnswers: keys };
}
function matchingQuestion(keys = ["А2Б3В1Г4"]): PolicyQuestion {
  return { points: 2, partialPolicy: "matching_partial", normalizationPolicy: matching, correctAnswer: keys[0], acceptedAnswers: keys };
}
function exactQuestion(keys = ["ёж"], normalizationPolicy: AnswerPolicy = word): PolicyQuestion {
  return { points: 2, partialPolicy: "exact_match", normalizationPolicy, correctAnswer: keys[0], acceptedAnswers: keys };
}
function permutations(value: string): string[] {
  if (value.length < 2) return [value];
  return [...value].flatMap((character, index) => permutations(value.slice(0, index) + value.slice(index + 1)).map((suffix) => character + suffix));
}
const subsets = Array.from({ length: 32 }, (_, mask) => ({ mask, value: [..."12345"].filter((_, bit) => (mask & (1 << bit)) !== 0).join("") }));

// Expected scores come from fixed answer masks and bit counts, independent of
// the scorer's normalization or comparison implementation.
const setCases = [
  { key: "1", mask: 0b00001 },
  { key: "13", mask: 0b00101 },
  { key: "135", mask: 0b10101 },
  { key: "12345", mask: 0b11111 }
].flatMap(({ key, mask }) => subsets.map((selected) => {
  const errors = (mask ^ selected.mask).toString(2).replaceAll("0", "").length;
  const expected = selected.mask === 0 ? 0 : errors === 0 ? 2 : errors === 1 ? 1 : 0;
  return { key, answer: selected.value, expected };
}));

const matchingCases = Array.from({ length: 625 }, (_, encoded) => {
  const chosen = Array.from({ length: 4 }, (_, position) => Math.floor(encoded / (5 ** position)) % 5 + 1);
  const correct = [2, 3, 1, 4];
  const errors = chosen.filter((value, index) => value !== correct[index]).length;
  return {
    answer: `А${chosen[0]}Б${chosen[1]}В${chosen[2]}Г${chosen[3]}`,
    expected: errors === 0 ? 2 : errors === 1 ? 1 : 0,
    errors
  };
});

describe("set_partial exhaustive scoring", () => {
  it.each(setCases)("key $key, answer '$answer' -> $expected", ({ key, answer, expected }) => {
    const score = scorePolicyAnswer(setQuestion([key]), answer);
    expect(score.pointsEarned).toBe(expected);
    expect(score.isCorrect).toBe(expected === 2);
  });

  it.each(permutations("135"))("accepts permutation %s", (answer) => {
    expect(scorePolicyAnswer(setQuestion(), answer).pointsEarned).toBe(2);
  });

  it.each(permutations("ABCDE"))("accepts Latin option order %s", (answer) => {
    expect(scorePolicyAnswer(setQuestion(["A,B,C,D,E"], letterSet), answer).pointsEarned).toBe(2);
  });

  it.each([
    ["135", 2], ["531", 2], ["315", 2], ["13", 1], ["15", 1], ["35", 1],
    ["1235", 1], ["134", 0], ["12", 0], ["12345", 0]
  ] as const)("matches requirement example %s -> %i", (answer, expected) => {
    expect(scorePolicyAnswer(setQuestion(), answer).pointsEarned).toBe(expected);
  });

  it.each([" 5, 3, 1 ", "5 3 1", "5\t3\n1", "5\u00a03\u202f1", "5,3 1"])("supports documented separators %j", (answer) => {
    expect(scorePolicyAnswer(setQuestion(), answer)).toEqual({ isCorrect: true, pointsEarned: 2, format: "valid" });
  });

  it.each(["1135", "1351", "1,3,3,5", "1356", "0135", "1;3;5", "1/3/5", "1..3..5", "1,,3,5", ",135", "135,", "135!", "1\u200b35", "１３５", "١٣٥", "①③⑤", "A35", "135\u0000"])("rejects invalid set %j without cleaning it into a key", (answer) => {
    expect(parsePolicyAnswer(answer, digitSet).status).toBe("invalid");
    expect(scorePolicyAnswer(setQuestion(), answer)).toEqual({ isCorrect: false, pointsEarned: 0, format: "invalid" });
  });

  it.each(["A,A,C", "AAC", "A,F,C", "А,C", "A,С", "A;C", "A,,C", "A C!", "ＡＣ", "A,Β,C"])("rejects duplicate, mixed-script or malformed Latin choices %j", (answer) => {
    expect(scorePolicyAnswer(setQuestion(["AC"], letterSet), answer).pointsEarned).toBe(0);
    expect(parsePolicyAnswer(answer, letterSet).status).toBe("invalid");
  });

  it.each([null, "", " ", "\t\n", "\u00a0"])("empty input %j is zero even for a single-element key", (answer) => {
    expect(scorePolicyAnswer(setQuestion(["1"]), answer)).toEqual({ isCorrect: false, pointsEarned: 0, format: "empty" });
  });

  it("uses the best alternative key once, without accumulating partial credit", () => {
    const question = setQuestion(["135", "24"]);
    expect(scorePolicyAnswer(question, "42").pointsEarned).toBe(2);
    expect(scorePolicyAnswer(question, "2").pointsEarned).toBe(1);
    expect(scorePolicyAnswer(setQuestion(["13", "15"]), "1").pointsEarned).toBe(1);
    expect(scorePolicyAnswer(setQuestion(["135", "531", "315"]), "13").pointsEarned).toBe(1);
  });

  it("respects the explicit domain rather than inferring allowed values from the key", () => {
    const narrow: AnswerPolicy = { version: 1, kind: "set", alphabet: "1234" };
    expect(scorePolicyAnswer(setQuestion(["13"], narrow), "135").pointsEarned).toBe(0);
    expect(scorePolicyAnswer(setQuestion(["13"], digitSet), "135").pointsEarned).toBe(1);
  });

  it("preserves determinism, bounded scores, order independence and canonicalization for every subset", () => {
    const question = setQuestion();
    for (const { value } of subsets) {
      const result = scorePolicyAnswer(question, value);
      expect([0, 1, 2]).toContain(result.pointsEarned);
      expect(scorePolicyAnswer(question, value)).toEqual(result);
      for (const permuted of permutations(value)) expect(scorePolicyAnswer(question, permuted)).toEqual(result);
      const parsed = parsePolicyAnswer(value, digitSet);
      if (parsed.status === "valid") expect(parsePolicyAnswer(parsed.normalized, digitSet)).toEqual(parsed);
    }
  });
});

describe("matching_partial exhaustive scoring", () => {
  it.each(matchingCases)("$answer ($errors wrong positions) -> $expected", ({ answer, expected }) => {
    const score = scorePolicyAnswer(matchingQuestion(), answer);
    expect(score.pointsEarned).toBe(expected);
    expect(score.isCorrect).toBe(expected === 2);
    expect(score.format).toBe("valid");
  });

  it("actually enumerates 5^4 combinations with every mismatch count represented", () => {
    expect(new Set(matchingCases.map((item) => item.answer)).size).toBe(625);
    expect(Array.from({ length: 5 }, (_, count) => matchingCases.filter((item) => item.errors === count).length)).toEqual([1, 16, 96, 256, 256]);
  });

  it.each(["А2Б3В1", "А2Б3В1Г", "А2Б3Г4", "А2А3В1Г4", "А2Б3В1В4", "Б3А2В1Г4", "Г4В1Б3А2", "А2Б3В1Г4Д5", "А2Б3В1Г0", "А2Б3В1Г6", "A2Б3В1Г4", "А2Б3B1Г4", "А2 Б3 В1 Г4", "А2,Б3,В1,Г4", "А2Б3В1Г4!", "А２Б３В１Г４", "А2Б3В1Г4\u200b", "А2Б3В1Г4\u0000"])("rejects nonofficial or ambiguous matching structure %j", (answer) => {
    expect(scorePolicyAnswer(matchingQuestion(), answer)).toEqual({ isCorrect: false, pointsEarned: 0, format: "invalid" });
  });

  it("accepts NFC/case and edge whitespace without changing correspondence positions", () => {
    expect(scorePolicyAnswer(matchingQuestion(), "  а2б3в1г4\n").pointsEarned).toBe(2);
  });

  it("permits repeated numeric values, which are distinct from duplicate labels", () => {
    expect(scorePolicyAnswer(matchingQuestion(), "А2Б3В1Г1").pointsEarned).toBe(1);
    expect(scorePolicyAnswer(matchingQuestion(["А1Б1В1Г1"]), "А1Б1В1Г1").pointsEarned).toBe(2);
  });

  it("compares each designated position rather than numeric sets", () => {
    expect(scorePolicyAnswer(matchingQuestion(), "А3Б2В1Г4").pointsEarned).toBe(0);
    expect(scorePolicyAnswer(matchingQuestion(), "А2Б3В1Г5").pointsEarned).toBe(1);
  });

  it("takes maximum credit among alternative matching keys, never their sum", () => {
    const question = matchingQuestion(["А2Б3В1Г4", "А1Б3В1Г5"]);
    expect(scorePolicyAnswer(question, "А1Б3В1Г5").pointsEarned).toBe(2);
    expect(scorePolicyAnswer(question, "А2Б3В1Г5").pointsEarned).toBe(1);
  });

  it("keeps scoring deterministic and canonical parsing idempotent over all combinations", () => {
    const question = matchingQuestion();
    for (const { answer } of matchingCases) {
      const result = scorePolicyAnswer(question, answer);
      expect(scorePolicyAnswer(question, answer)).toEqual(result);
      const parsed = parsePolicyAnswer(answer, matching);
      expect(parsed.status).toBe("valid");
      if (parsed.status === "valid") expect(parsePolicyAnswer(parsed.normalized, matching)).toEqual(parsed);
    }
  });
});

describe("exact_match conservative normalization", () => {
  it.each(["ёж", "ЁЖ", "  Ёж\n", "е\u0308ж"])("normalizes only NFC, case and edge whitespace: %j", (answer) => {
    expect(scorePolicyAnswer(exactQuestion(), answer).pointsEarned).toBe(2);
  });
  it.each(["еж", "ежи", "ё", "ёжик"])("awards zero for a valid but different word %j", (answer) => {
    expect(scorePolicyAnswer(exactQuestion(), answer)).toEqual({ isCorrect: false, pointsEarned: 0, format: "valid" });
  });
  it.each(["ё ж", "ёж!", "eж", "ёж;еж", "ёж\u200b", "ёж\u0000", "ёж/еж", "ёж\nеж"])("does not remove malformed characters %j", (answer) => {
    expect(scorePolicyAnswer(exactQuestion(), answer)).toEqual({ isCorrect: false, pointsEarned: 0, format: "invalid" });
  });
  it("accepts е/ё only when both are explicit keys", () => {
    expect(scorePolicyAnswer(exactQuestion(["прилёта", "прилета"]), "ПРИЛЕТА").pointsEarned).toBe(2);
    expect(scorePolicyAnswer(exactQuestion(["прилёта"]), "прилета").pointsEarned).toBe(0);
  });
  it("does not apply set normalization to exact digit sequences", () => {
    expect(scorePolicyAnswer(exactQuestion(["135"], digits), "135").pointsEarned).toBe(2);
    for (const answer of ["531", "13", "1235", "1 3 5", "1,3,5"]) expect(scorePolicyAnswer(exactQuestion(["135"], digits), answer).pointsEarned).toBe(0);
  });
});

describe("configuration boundaries and legacy upgrades", () => {
  it.each([setQuestion(), matchingQuestion(), exactQuestion()])("accepts a coherent strategy and valid keys", (question) => {
    expect(validateAnswerConfiguration(question)).toEqual([]);
  });
  it.each([
    { ...setQuestion(), points: 1 },
    { ...setQuestion(), points: 3 },
    { ...setQuestion(), partialPolicy: "matching_partial" },
    { ...setQuestion(), partialPolicy: "unknown" },
    { ...setQuestion(), normalizationPolicy: { version: 2, kind: "set", alphabet: "12345" } },
    { ...setQuestion(), normalizationPolicy: { version: 1, kind: "set", alphabet: "112345" } },
    { ...setQuestion(), normalizationPolicy: { version: 1, kind: "set", alphabet: "12345", stripUnknown: true } },
    { ...setQuestion(), normalizationPolicy: { version: 1, kind: "set", alphabet: "0" } },
    { ...setQuestion(), normalizationPolicy: null },
    { ...setQuestion(), acceptedAnswers: [] },
    { ...setQuestion(), acceptedAnswers: ["135", 135] },
    { ...setQuestion(), acceptedAnswers: { answer: "135" } },
    { ...setQuestion(), acceptedAnswers: ["135", "1135"] },
    { ...setQuestion(), acceptedAnswers: ["135", "1356"] },
    { ...setQuestion(), correctAnswer: "24", acceptedAnswers: ["135"] },
    { ...matchingQuestion(), acceptedAnswers: ["А2Б3В1"] },
    { ...matchingQuestion(), acceptedAnswers: ["Б3А2В1Г4"] },
    { ...matchingQuestion(), normalizationPolicy: { version: 1, kind: "matching", positions: "АБВГ", values: "112345" } },
    { ...exactQuestion(), acceptedAnswers: ["ёж", "eж"] }
  ])("rejects invalid metadata before publication", (question) => {
    expect(validateAnswerConfiguration(question).length).toBeGreaterThan(0);
  });
  it("fails closed for an unknown normalization policy", () => {
    expect(() => readAnswerPolicy({ kind: "set", alphabet: "12345" })).toThrow();
  });
  it.each([1, 7, 13, 14, 16, 18])("maps digit B%i to a partial set strategy", (officialNumber) => {
    expect(defaultAnswerPolicy({ officialPart: "B", officialNumber, responseSubtype: "DIGITS" })).toEqual({ partialPolicy: "set_partial", normalizationPolicy: digitSet });
  });
  it.each([19, 20, 21, 22])("maps alnum B%i to positional matching", (officialNumber) => {
    expect(defaultAnswerPolicy({ officialPart: "B", officialNumber, responseSubtype: "alnum" })).toEqual({ partialPolicy: "matching_partial", normalizationPolicy: matching });
  });
  it("keeps authored word B14 exact despite the official 2026 B14 being a partial task", () => {
    expect(defaultAnswerPolicy({ officialPart: "B", officialNumber: 14, responseSubtype: "word" })).toEqual({ partialPolicy: "exact_match", normalizationPolicy: word });
  });
  it("only upgrades legacy policy identifiers on explicit new-snapshot resolution", () => {
    const legacy: PolicyQuestion = { officialPart: "B", officialNumber: 1, responseSubtype: "digits", partialPolicy: "none", normalizationPolicy: "conservative" };
    expect(resolveAnswerPolicy(legacy)).toEqual({ partialPolicy: "set_partial", normalizationPolicy: digitSet });
    expect(legacy.partialPolicy).toBe("none");
    expect(legacy.normalizationPolicy).toBe("conservative");
    expect(resolveAnswerPolicy({ officialPart: "A", partialPolicy: "one_error_half_credit" })).toEqual({ partialPolicy: "set_partial", normalizationPolicy: letterSet });
  });
  it("preserves explicit domains and rejects rather than silently repairing unknown metadata", () => {
    const explicit: AnswerPolicy = { version: 1, kind: "set", alphabet: "1234567" };
    expect(resolveAnswerPolicy({ officialPart: "B", officialNumber: 1, responseSubtype: "digits", partialPolicy: "set_partial", normalizationPolicy: explicit }).normalizationPolicy).toBe(explicit);
    const resolved = resolveAnswerPolicy({ partialPolicy: "typo", normalizationPolicy: { kind: "mystery" } });
    expect(resolved.partialPolicy).toBe("typo");
    expect(validateAnswerConfiguration({ ...setQuestion(), ...resolved }).length).toBeGreaterThan(0);
  });
});
