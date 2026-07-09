import { describe, expect, it } from "vitest";
import { runPublishCheck, type PublishCheckInput } from "@/lib/tests/publish-check";

type PublishQuestion = NonNullable<PublishCheckInput["questions"]>[number];

const genericQuestion: PublishQuestion = {
  questionText: "Укажите правильный вариант",
  questionType: "SINGLE_CHOICE",
  correctAnswer: "A",
  topic: "Орфография",
  subtopic: "О/А",
  points: 1,
  optionA: "вариант А",
  optionB: "вариант Б",
  explanation: "Пояснение",
  deletedAt: null
};

function scoringScheme() {
  return {
    isActive: true,
    maxRawScore: 80,
    scales: [
      { rawScore: 0, scaledScore: 0 },
      { rawScore: 80, scaledScore: 100 }
    ]
  };
}

function authenticQuestion(part: "A" | "B", officialNumber: number): PublishQuestion {
  if (part === "A") {
    return {
      questionText: `Задание A${officialNumber}`,
      questionType: "MULTI_SELECT_FIVE",
      correctAnswer: "A,B",
      topic: "Орфография",
      subtopic: "Правописание",
      points: 2,
      optionA: "A",
      optionB: "B",
      optionC: "C",
      optionD: "D",
      optionE: "E",
      officialPart: "A",
      officialNumber,
      explanation: "Пояснение",
      deletedAt: null
    };
  }

  return {
    questionText: `Задание B${officialNumber}`,
    questionType: "SHORT_ANSWER_TOKEN",
    correctAnswer: `ответ${officialNumber}`,
    topic: "Грамматика",
    subtopic: "Краткий ответ",
    points: 2,
    officialPart: "B",
    officialNumber,
    responseSubtype: "WORD",
    acceptedAnswers: [`ответ${officialNumber}`],
    explanation: "Пояснение",
    deletedAt: null
  };
}

function authenticQuestions(): PublishQuestion[] {
  return [
    ...Array.from({ length: 18 }, (_, index) => authenticQuestion("A", index + 1)),
    ...Array.from({ length: 22 }, (_, index) => authenticQuestion("B", index + 1))
  ];
}

function authenticTest(overrides: Partial<PublishCheckInput> = {}): PublishCheckInput {
  const questions = overrides.questions ?? authenticQuestions();
  return {
    title: "Тренировочный тест в формате ЦЭ/ЦТ",
    price: 1500,
    durationMinutes: 120,
    accessDays: 7,
    questionsCount: questions.length,
    maxRawScore: 80,
    mode: "CE_CT",
    examMode: "RIKZ_RUSSIAN_2026",
    showScaledScore: true,
    scoringSchemeId: "00000000-0000-0000-0000-000000000001",
    scoringScheme: scoringScheme(),
    questions,
    ...overrides
  };
}

function errorCodes(input: PublishCheckInput) {
  return runPublishCheck(input).errors.map((error) => error.code);
}

describe("runPublishCheck", () => {
  it("allows a valid generic training test with old question types", () => {
    const result = runPublishCheck({
      title: "Русский язык",
      price: 1500,
      durationMinutes: 60,
      accessDays: 7,
      questionsCount: 1,
      maxRawScore: 1,
      mode: "TRAINING",
      examMode: "GENERIC",
      showScaledScore: false,
      questions: [genericQuestion]
    });

    expect(result.canPublish).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("blocks a generic test without questions", () => {
    const result = runPublishCheck({
      title: "Русский язык",
      price: 1500,
      durationMinutes: 60,
      accessDays: 7,
      questionsCount: 0,
      maxRawScore: 0,
      mode: "TRAINING",
      examMode: "GENERIC",
      showScaledScore: false,
      questions: []
    });

    expect(result.canPublish).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("NO_QUESTIONS");
  });

  it("blocks scaled score without a scoring scheme", () => {
    const result = runPublishCheck({
      title: "Русский язык",
      price: 1500,
      durationMinutes: 60,
      accessDays: 7,
      questionsCount: 1,
      maxRawScore: 1,
      mode: "CE_CT",
      examMode: "GENERIC",
      showScaledScore: true,
      scoringSchemeId: null,
      questions: [genericQuestion]
    });

    expect(result.canPublish).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("SCORING_SCHEME_REQUIRED");
  });

  it("rejects authentic test with less than 40 questions", () => {
    const codes = errorCodes(authenticTest({ questions: authenticQuestions().slice(0, 39), questionsCount: 39 }));

    expect(codes).toContain("RIKZ_RUSSIAN_QUESTION_COUNT_INVALID");
  });

  it("rejects authentic test with wrong A/B counts", () => {
    const questions = [
      ...Array.from({ length: 17 }, (_, index) => authenticQuestion("A", index + 1)),
      ...Array.from({ length: 23 }, (_, index) => authenticQuestion("B", index + 1))
    ];
    const codes = errorCodes(authenticTest({ questions }));

    expect(codes).toContain("RIKZ_RUSSIAN_PART_A_COUNT_INVALID");
    expect(codes).toContain("RIKZ_RUSSIAN_PART_B_COUNT_INVALID");
  });

  it("rejects single_choice in authentic mode", () => {
    const questions = authenticQuestions();
    questions[0] = { ...questions[0], questionType: "SINGLE_CHOICE" };

    expect(errorCodes(authenticTest({ questions }))).toContain("RIKZ_RUSSIAN_SINGLE_CHOICE_FORBIDDEN");
  });

  it("rejects generic multiple_choice in authentic mode", () => {
    const questions = authenticQuestions();
    questions[0] = { ...questions[0], questionType: "MULTIPLE_CHOICE" };

    expect(errorCodes(authenticTest({ questions }))).toContain("RIKZ_RUSSIAN_GENERIC_MULTIPLE_CHOICE_FORBIDDEN");
  });

  it("rejects generic short_text in authentic mode", () => {
    const questions = authenticQuestions();
    questions[18] = { ...questions[18], questionType: "SHORT_TEXT" };

    expect(errorCodes(authenticTest({ questions }))).toContain("RIKZ_RUSSIAN_GENERIC_SHORT_TEXT_FORBIDDEN");
  });

  it("rejects Part A without optionE", () => {
    const questions = authenticQuestions();
    questions[0] = { ...questions[0], optionE: undefined };

    expect(errorCodes(authenticTest({ questions }))).toContain("RIKZ_RUSSIAN_PART_A_OPTIONS_INVALID");
  });

  it("rejects duplicate official numbers inside a part", () => {
    const questions = authenticQuestions();
    questions[1] = { ...questions[1], officialNumber: 1 };

    expect(errorCodes(authenticTest({ questions }))).toContain("RIKZ_RUSSIAN_OFFICIAL_NUMBER_DUPLICATE");
  });

  it("rejects total points not equal to 80", () => {
    const questions = authenticQuestions();
    questions[0] = { ...questions[0], points: 1 };

    expect(errorCodes(authenticTest({ questions }))).toContain("RIKZ_RUSSIAN_TOTAL_POINTS_INVALID");
  });

  it("rejects authentic paper without scoring scheme even when scaled score display is disabled", () => {
    const codes = errorCodes(
      authenticTest({
        showScaledScore: false,
        scoringSchemeId: null,
        scoringScheme: null
      })
    );

    expect(codes).toContain("RIKZ_RUSSIAN_SCORING_SCHEME_REQUIRED");
  });

  it("accepts structurally valid 40-question authentic paper", () => {
    const result = runPublishCheck(authenticTest());

    expect(result.canPublish).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
