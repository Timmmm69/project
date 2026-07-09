import type { Prisma } from "@prisma/client";

export type PublishCheckIssue = {
  code: string;
  message: string;
};

export type PublishCheckInput = {
  title?: string | null;
  price?: number | null;
  durationMinutes?: number | null;
  accessDays?: number | null;
  questionsCount?: number | null;
  maxRawScore?: number | null;
  mode?: "TRAINING" | "CE_CT" | string;
  examMode?: "GENERIC" | "RIKZ_RUSSIAN_2026" | string;
  showScaledScore?: boolean | null;
  scoringSchemeId?: string | null;
  scoringScheme?: {
    isActive: boolean;
    maxRawScore: number;
    scales: Array<{
      rawScore: number;
      scaledScore: number;
    }>;
  } | null;
  questions?: Array<{
    questionText?: string | null;
    questionType?: string | null;
    correctAnswer?: string | null;
    topic?: string | null;
    points?: number | null;
    optionA?: string | null;
    optionB?: string | null;
    optionC?: string | null;
    optionD?: string | null;
    optionE?: string | null;
    officialPart?: "A" | "B" | string | null;
    officialNumber?: number | null;
    responseSubtype?: "WORD" | "DIGITS" | "ALNUM" | string | null;
    acceptedAnswers?: Prisma.JsonValue | null;
    explanation?: string | null;
    subtopic?: string | null;
    deletedAt?: Date | null;
  }>;
};

function isBlank(value?: string | null) {
  return !value || value.trim().length === 0;
}

function filledOptions(question: NonNullable<PublishCheckInput["questions"]>[number]) {
  return [question.optionA, question.optionB, question.optionC, question.optionD, question.optionE].filter(
    (option) => !isBlank(option)
  );
}

function filledLegacyOptions(question: NonNullable<PublishCheckInput["questions"]>[number]) {
  return [question.optionA, question.optionB, question.optionC, question.optionD].filter(
    (option) => !isBlank(option)
  );
}

function parseChoiceAnswer(answer: string) {
  return answer
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function hasAcceptedAnswers(value: Prisma.JsonValue | null | undefined) {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
}

function questionLabel(question: NonNullable<PublishCheckInput["questions"]>[number], fallbackNumber: number) {
  if (question.officialPart && question.officialNumber) {
    return `${question.officialPart}${question.officialNumber}`;
  }
  return `Ð·Ð°Ð´Ð°Ð½Ð¸Ðµ ${fallbackNumber}`;
}

function addRikzRussian2026PublishChecks(
  test: PublishCheckInput,
  questions: NonNullable<PublishCheckInput["questions"]>,
  errors: PublishCheckIssue[]
) {
  if (questions.length !== 40) {
    errors.push({
      code: "RIKZ_RUSSIAN_QUESTION_COUNT_INVALID",
      message: "Ð”Ð»Ñ Ñ€ÐµÐ¶Ð¸Ð¼Ð° Ð¦Ð­/Ð¦Ð¢ Ð¿Ð¾ Ñ€ÑƒÑÑÐºÐ¾Ð¼Ñƒ Ð½ÑƒÐ¶Ð½Ð¾ Ñ€Ð¾Ð²Ð½Ð¾ 40 Ð·Ð°Ð´Ð°Ð½Ð¸Ð¹."
    });
  }

  if (test.durationMinutes !== 120) {
    errors.push({
      code: "RIKZ_RUSSIAN_DURATION_INVALID",
      message: "Ð”Ð»Ñ Ñ€ÐµÐ¶Ð¸Ð¼Ð° Ð¦Ð­/Ð¦Ð¢ Ð¿Ð¾ Ñ€ÑƒÑÑÐºÐ¾Ð¼Ñƒ Ð²Ñ€ÐµÐ¼Ñ Ñ‚ÐµÑÑ‚Ð° Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð±Ñ‹Ñ‚ÑŒ 120 Ð¼Ð¸Ð½ÑƒÑ‚."
    });
  }

  const totalPoints = questions.reduce((sum, question) => sum + (question.points ?? 0), 0);
  if (totalPoints !== 80) {
    errors.push({
      code: "RIKZ_RUSSIAN_TOTAL_POINTS_INVALID",
      message: "Ð”Ð»Ñ Ñ€ÐµÐ¶Ð¸Ð¼Ð° Ð¦Ð­/Ð¦Ð¢ Ð¿Ð¾ Ñ€ÑƒÑÑÐºÐ¾Ð¼Ñƒ ÑÑƒÐ¼Ð¼Ð° Ð¿ÐµÑ€Ð²Ð¸Ñ‡Ð½Ñ‹Ñ… Ð±Ð°Ð»Ð»Ð¾Ð² Ð´Ð¾Ð»Ð¶Ð½Ð° Ð±Ñ‹Ñ‚ÑŒ 80."
    });
  }

  const partAQuestions = questions.filter((question) => question.officialPart === "A");
  const partBQuestions = questions.filter((question) => question.officialPart === "B");

  if (partAQuestions.length !== 18) {
    errors.push({
      code: "RIKZ_RUSSIAN_PART_A_COUNT_INVALID",
      message: "Ð’ Ñ‡Ð°ÑÑ‚Ð¸ A Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð±Ñ‹Ñ‚ÑŒ Ñ€Ð¾Ð²Ð½Ð¾ 18 Ð·Ð°Ð´Ð°Ð½Ð¸Ð¹."
    });
  }

  if (partBQuestions.length !== 22) {
    errors.push({
      code: "RIKZ_RUSSIAN_PART_B_COUNT_INVALID",
      message: "Ð’ Ñ‡Ð°ÑÑ‚Ð¸ B Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð±Ñ‹Ñ‚ÑŒ Ñ€Ð¾Ð²Ð½Ð¾ 22 Ð·Ð°Ð´Ð°Ð½Ð¸Ñ."
    });
  }

  const seenPartNumbers = {
    A: new Set<number>(),
    B: new Set<number>()
  };

  for (const [index, question] of questions.entries()) {
    const number = index + 1;
    const label = questionLabel(question, number);

    if (question.questionType === "SINGLE_CHOICE") {
      errors.push({
        code: "RIKZ_RUSSIAN_SINGLE_CHOICE_FORBIDDEN",
        message: "Ð’ Ñ€ÐµÐ¶Ð¸Ð¼Ðµ Ð¦Ð­/Ð¦Ð¢ Ð½ÐµÐ»ÑŒÐ·Ñ Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÑŒ single_choice."
      });
    }

    if (question.questionType === "MULTIPLE_CHOICE") {
      errors.push({
        code: "RIKZ_RUSSIAN_GENERIC_MULTIPLE_CHOICE_FORBIDDEN",
        message: "Ð’ Ñ€ÐµÐ¶Ð¸Ð¼Ðµ Ð¦Ð­/Ð¦Ð¢ Ð½ÐµÐ»ÑŒÐ·Ñ Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÑŒ generic multiple_choice. Ð˜ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐ¹ multi_select_five."
      });
    }

    if (question.questionType === "SHORT_TEXT") {
      errors.push({
        code: "RIKZ_RUSSIAN_GENERIC_SHORT_TEXT_FORBIDDEN",
        message: "Ð’ Ñ€ÐµÐ¶Ð¸Ð¼Ðµ Ð¦Ð­/Ð¦Ð¢ Ð½ÐµÐ»ÑŒÐ·Ñ Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÑŒ generic short_text. Ð˜ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐ¹ short_answer_token."
      });
    }

    if (!["MULTI_SELECT_FIVE", "SHORT_ANSWER_TOKEN"].includes(question.questionType ?? "")) {
      errors.push({
        code: "RIKZ_RUSSIAN_QUESTION_TYPE_INVALID",
        message: `Ð’ Ñ€ÐµÐ¶Ð¸Ð¼Ðµ Ð¦Ð­/Ð¦Ð¢ Ñƒ ${label} Ð´Ð¾Ð¿ÑƒÑÑ‚Ð¸Ð¼Ñ‹ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ multi_select_five Ð¸ short_answer_token.`
      });
    }

    if (question.officialPart !== "A" && question.officialPart !== "B") {
      errors.push({
        code: "RIKZ_RUSSIAN_OFFICIAL_PART_REQUIRED",
        message: `Ð”Ð»Ñ ${label} Ð½ÑƒÐ¶Ð½Ð¾ ÑƒÐºÐ°Ð·Ð°Ñ‚ÑŒ Ñ‡Ð°ÑÑ‚ÑŒ A Ð¸Ð»Ð¸ B.`
      });
      continue;
    }

    if (!question.officialNumber) {
      errors.push({
        code: "RIKZ_RUSSIAN_OFFICIAL_NUMBER_REQUIRED",
        message: `Ð”Ð»Ñ ${label} Ð½ÑƒÐ¶Ð½Ð¾ ÑƒÐºÐ°Ð·Ð°Ñ‚ÑŒ Ð½Ð¾Ð¼ÐµÑ€ Ð·Ð°Ð´Ð°Ð½Ð¸Ñ.`
      });
    } else {
      const maxNumber = question.officialPart === "A" ? 18 : 22;
      if (question.officialNumber < 1 || question.officialNumber > maxNumber) {
        errors.push({
          code: "RIKZ_RUSSIAN_OFFICIAL_NUMBER_RANGE_INVALID",
          message: `ÐÐ¾Ð¼ÐµÑ€ ${question.officialPart}${question.officialNumber} Ð´Ð¾Ð»Ð¶ÐµÐ½ Ð±Ñ‹Ñ‚ÑŒ Ð² Ð´Ð¸Ð°Ð¿Ð°Ð·Ð¾Ð½Ðµ 1-${maxNumber}.`
        });
      }

      const seenNumbers = seenPartNumbers[question.officialPart];
      if (seenNumbers.has(question.officialNumber)) {
        errors.push({
          code: "RIKZ_RUSSIAN_OFFICIAL_NUMBER_DUPLICATE",
          message: `ÐÐ°Ð¹Ð´ÐµÐ½ Ð´ÑƒÐ±Ð»Ð¸ÐºÐ°Ñ‚ Ð½Ð¾Ð¼ÐµÑ€Ð° ${question.officialPart}${question.officialNumber}.`
        });
      }
      seenNumbers.add(question.officialNumber);
    }

    if (question.officialPart === "A") {
      if (question.questionType !== "MULTI_SELECT_FIVE") {
        errors.push({
          code: "RIKZ_RUSSIAN_PART_A_TYPE_INVALID",
          message: `Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ ${label} Ð² Ñ‡Ð°ÑÑ‚Ð¸ A Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð±Ñ‹Ñ‚ÑŒ multi_select_five.`
        });
      }

      if (filledOptions(question).length !== 5) {
        errors.push({
          code: "RIKZ_RUSSIAN_PART_A_OPTIONS_INVALID",
          message: `Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ ${label} Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð¸Ð¼ÐµÑ‚ÑŒ 5 Ð²Ð°Ñ€Ð¸Ð°Ð½Ñ‚Ð¾Ð² Ð¾Ñ‚Ð²ÐµÑ‚Ð°.`
        });
      }

      const correctAnswers = parseChoiceAnswer(question.correctAnswer ?? "");
      const hasInvalidAnswer =
        correctAnswers.length === 0 ||
        correctAnswers.some((answer) => !["A", "B", "C", "D", "E"].includes(answer)) ||
        new Set(correctAnswers).size !== correctAnswers.length;

      if (hasInvalidAnswer) {
        errors.push({
          code: "RIKZ_RUSSIAN_PART_A_ANSWER_SET_REQUIRED",
          message: `Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ ${label} Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð¸Ð¼ÐµÑ‚ÑŒ ÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ñ‹Ð¹ Ð½Ð°Ð±Ð¾Ñ€ Ð¾Ñ‚Ð²ÐµÑ‚Ð¾Ð² A-E.`
        });
      }
    }

    if (question.officialPart === "B") {
      if (question.questionType !== "SHORT_ANSWER_TOKEN") {
        errors.push({
          code: "RIKZ_RUSSIAN_PART_B_TYPE_INVALID",
          message: `Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ ${label} Ð² Ñ‡Ð°ÑÑ‚Ð¸ B Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð±Ñ‹Ñ‚ÑŒ short_answer_token.`
        });
      }

      if (!["WORD", "DIGITS", "ALNUM"].includes(question.responseSubtype ?? "")) {
        errors.push({
          code: "RIKZ_RUSSIAN_PART_B_RESPONSE_SUBTYPE_REQUIRED",
          message: `Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ ${label} Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð¸Ð¼ÐµÑ‚ÑŒ Ñ‚Ð¸Ð¿ ÐºÑ€Ð°Ñ‚ÐºÐ¾Ð³Ð¾ Ð¾Ñ‚Ð²ÐµÑ‚Ð°: word, digits Ð¸Ð»Ð¸ alnum.`
        });
      }

      if (!hasAcceptedAnswers(question.acceptedAnswers)) {
        errors.push({
          code: "RIKZ_RUSSIAN_PART_B_ACCEPTED_ANSWERS_REQUIRED",
          message: `Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ ${label} Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð¸Ð¼ÐµÑ‚ÑŒ acceptedAnswers.`
        });
      }
    }
  }

  if (!test.scoringSchemeId) {
    errors.push({
      code: "RIKZ_RUSSIAN_SCORING_SCHEME_REQUIRED",
      message: "Для режима ЦЭ/ЦТ по русскому нужно выбрать шкалу перевода первичных баллов в тестовые."
    });
  }
}

export function runPublishCheck(test: PublishCheckInput) {
  const errors: PublishCheckIssue[] = [];
  const warnings: PublishCheckIssue[] = [];

  if (isBlank(test.title)) {
    errors.push({ code: "NO_TITLE", message: "Ð£ Ñ‚ÐµÑÑ‚Ð° Ð½ÐµÑ‚ Ð½Ð°Ð·Ð²Ð°Ð½Ð¸Ñ" });
  }

  if (test.price == null || test.price < 0) {
    errors.push({ code: "INVALID_PRICE", message: "Ð¦ÐµÐ½Ð° Ð´Ð¾Ð»Ð¶Ð½Ð° Ð±Ñ‹Ñ‚ÑŒ 0 Ð¸Ð»Ð¸ Ð±Ð¾Ð»ÑŒÑˆÐµ" });
  }

  if (!test.durationMinutes || test.durationMinutes <= 0) {
    errors.push({ code: "INVALID_DURATION", message: "Ð’Ñ€ÐµÐ¼Ñ Ñ‚ÐµÑÑ‚Ð° Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð±Ñ‹Ñ‚ÑŒ Ð±Ð¾Ð»ÑŒÑˆÐµ 0" });
  }

  if (!test.accessDays || test.accessDays <= 0) {
    errors.push({ code: "INVALID_ACCESS_DAYS", message: "Ð¡Ñ€Ð¾Ðº Ð´Ð¾ÑÑ‚ÑƒÐ¿Ð° Ð´Ð¾Ð»Ð¶ÐµÐ½ Ð±Ñ‹Ñ‚ÑŒ Ð±Ð¾Ð»ÑŒÑˆÐµ 0" });
  }

  const questions = (test.questions ?? []).filter((question) => !question.deletedAt);
  const isRikzRussian2026 = test.examMode === "RIKZ_RUSSIAN_2026";
  if ((test.questionsCount ?? questions.length) <= 0 || questions.length === 0) {
    errors.push({ code: "NO_QUESTIONS", message: "Ð’ Ñ‚ÐµÑÑ‚Ðµ Ð½ÐµÑ‚ Ð²Ð¾Ð¿Ñ€Ð¾ÑÐ¾Ð²" });
  }

  if ((test.maxRawScore ?? 0) <= 0) {
    errors.push({ code: "INVALID_MAX_RAW_SCORE", message: "ÐœÐ°ÐºÑÐ¸Ð¼Ð°Ð»ÑŒÐ½Ñ‹Ð¹ Ð±Ð°Ð»Ð» Ð´Ð¾Ð»Ð¶ÐµÐ½ Ð±Ñ‹Ñ‚ÑŒ Ð±Ð¾Ð»ÑŒÑˆÐµ 0" });
  }

  let questionsWithoutExplanations = 0;
  let questionsWithoutSubtopics = 0;

  for (const [index, question] of questions.entries()) {
    const number = index + 1;
    if (isBlank(question.questionText)) {
      errors.push({ code: "QUESTION_TEXT_REQUIRED", message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð½ÐµÑ‚ Ñ‚ÐµÐºÑÑ‚Ð°` });
    }
    if (isBlank(question.correctAnswer)) {
      errors.push({ code: "QUESTION_CORRECT_ANSWER_REQUIRED", message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð½ÐµÑ‚ Ð¿Ñ€Ð°Ð²Ð¸Ð»ÑŒÐ½Ð¾Ð³Ð¾ Ð¾Ñ‚Ð²ÐµÑ‚Ð°` });
    }
    if (isBlank(question.topic)) {
      errors.push({ code: "QUESTION_TOPIC_REQUIRED", message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð½ÐµÑ‚ Ñ‚ÐµÐ¼Ñ‹` });
    }
    if (!question.points || question.points <= 0) {
      errors.push({ code: "QUESTION_POINTS_REQUIRED", message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð±Ð°Ð»Ð»Ñ‹ Ð´Ð¾Ð»Ð¶Ð½Ñ‹ Ð±Ñ‹Ñ‚ÑŒ Ð±Ð¾Ð»ÑŒÑˆÐµ 0` });
    }

    if (isBlank(question.explanation)) {
      questionsWithoutExplanations += 1;
    }
    if (isBlank(question.subtopic)) {
      questionsWithoutSubtopics += 1;
    }

    if (question.questionType === "SINGLE_CHOICE") {
      const options = filledLegacyOptions(question);
      if (options.length < 2) {
        errors.push({ code: "QUESTION_OPTIONS_REQUIRED", message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð½ÑƒÐ¶Ð½Ð¾ Ð¼Ð¸Ð½Ð¸Ð¼ÑƒÐ¼ 2 Ð²Ð°Ñ€Ð¸Ð°Ð½Ñ‚Ð°` });
      }
      const answer = question.correctAnswer?.trim().toUpperCase();
      if (answer && !["A", "B", "C", "D"].includes(answer)) {
        errors.push({ code: "QUESTION_SINGLE_ANSWER_INVALID", message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð¾Ñ‚Ð²ÐµÑ‚ Ð´Ð¾Ð»Ð¶ÐµÐ½ Ð±Ñ‹Ñ‚ÑŒ A/B/C/D` });
      }
    }

    if (question.questionType === "MULTIPLE_CHOICE") {
      if (question.points !== 2) {
        errors.push({
          code: "QUESTION_MULTIPLE_CHOICE_POINTS_UNSUPPORTED",
          message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð´Ð»Ñ multiple_choice points Ð´Ð¾Ð»Ð¶ÐµÐ½ Ð±Ñ‹Ñ‚ÑŒ Ñ€Ð°Ð²ÐµÐ½ 2`
        });
      }

      const options = filledLegacyOptions(question);
      if (options.length < 2) {
        errors.push({ code: "QUESTION_OPTIONS_REQUIRED", message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð½ÑƒÐ¶Ð½Ð¾ Ð¼Ð¸Ð½Ð¸Ð¼ÑƒÐ¼ 2 Ð²Ð°Ñ€Ð¸Ð°Ð½Ñ‚Ð°` });
      }
      const answers = parseChoiceAnswer(question.correctAnswer ?? "");
      if (answers.length === 0 || answers.some((answer) => !["A", "B", "C", "D"].includes(answer))) {
        errors.push({
          code: "QUESTION_MULTIPLE_ANSWER_INVALID",
          message: `Ð’Ð¾Ð¿Ñ€Ð¾Ñ ${number}: Ð¾Ñ‚Ð²ÐµÑ‚Ñ‹ Ð´Ð¾Ð»Ð¶Ð½Ñ‹ Ð±Ñ‹Ñ‚ÑŒ A/B/C/D Ñ‡ÐµÑ€ÐµÐ· Ð·Ð°Ð¿ÑÑ‚ÑƒÑŽ`
        });
      }
    }
  }

  if (questions.length > 0 && questionsWithoutExplanations > 0) {
    warnings.push({
      code: "NO_EXPLANATIONS",
      message: `Ð£ ${questionsWithoutExplanations} Ð²Ð¾Ð¿Ñ€Ð¾Ñ(Ð¾Ð²) Ð½ÐµÑ‚ Ð¾Ð±ÑŠÑÑÐ½ÐµÐ½Ð¸Ñ`
    });
  }

  if (questions.length > 0 && questionsWithoutSubtopics > 0) {
    warnings.push({
      code: "NO_SUBTOPICS",
      message: `Ð£ ${questionsWithoutSubtopics} Ð²Ð¾Ð¿Ñ€Ð¾Ñ(Ð¾Ð²) Ð½ÐµÑ‚ Ð¿Ð¾Ð´Ñ‚ÐµÐ¼Ñ‹`
    });
  }

  if (test.showScaledScore) {
    if (!test.scoringSchemeId || !test.scoringScheme) {
      errors.push({ code: "SCORING_SCHEME_REQUIRED", message: "Ð”Ð»Ñ ÑˆÐºÐ°Ð»Ñ‹ 0-100 Ð½ÑƒÐ¶Ð½Ð¾ Ð²Ñ‹Ð±Ñ€Ð°Ñ‚ÑŒ ÑˆÐºÐ°Ð»Ñƒ" });
    } else if (!test.scoringScheme.isActive) {
      errors.push({ code: "SCORING_SCHEME_INACTIVE", message: "Ð’Ñ‹Ð±Ñ€Ð°Ð½Ð½Ð°Ñ ÑˆÐºÐ°Ð»Ð° Ð½ÐµÐ°ÐºÑ‚Ð¸Ð²Ð½Ð°" });
    } else if (test.scoringScheme.maxRawScore !== test.maxRawScore) {
      errors.push({
        code: "SCORING_SCHEME_MAX_SCORE_MISMATCH",
        message: "ÐœÐ°ÐºÑÐ¸Ð¼Ð°Ð»ÑŒÐ½Ñ‹Ð¹ Ð±Ð°Ð»Ð» Ñ‚ÐµÑÑ‚Ð° Ð½Ðµ ÑÐ¾Ð²Ð¿Ð°Ð´Ð°ÐµÑ‚ ÑÐ¾ ÑˆÐºÐ°Ð»Ð¾Ð¹"
      });
    } else {
      const rawScores = new Set(test.scoringScheme.scales.map((scale) => scale.rawScore));
      if (!rawScores.has(0) || !rawScores.has(test.scoringScheme.maxRawScore)) {
        errors.push({
          code: "SCORING_SCHEME_INCOMPLETE",
          message: "Ð’ ÑˆÐºÐ°Ð»Ðµ Ð´Ð¾Ð»Ð¶Ð½Ð° Ð±Ñ‹Ñ‚ÑŒ ÑÑ‚Ñ€Ð¾ÐºÐ° Ð´Ð»Ñ 0 Ð¸ Ð¼Ð°ÐºÑÐ¸Ð¼Ð°Ð»ÑŒÐ½Ð¾Ð³Ð¾ Ð¿ÐµÑ€Ð²Ð¸Ñ‡Ð½Ð¾Ð³Ð¾ Ð±Ð°Ð»Ð»Ð°"
        });
      }
    }
  }

  if (isRikzRussian2026) {
    addRikzRussian2026PublishChecks(test, questions, errors);
  }

  return {
    canPublish: errors.length === 0,
    errors,
    warnings
  };
}

export type PublishCheckTestPayload = Prisma.TestGetPayload<{
  include: {
    questions: true;
    scoringScheme: {
      include: {
        scales: true;
      };
    };
  };
}>;
