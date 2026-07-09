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
    explanation?: string | null;
    subtopic?: string | null;
    deletedAt?: Date | null;
  }>;
};

function isBlank(value?: string | null) {
  return !value || value.trim().length === 0;
}

function filledOptions(question: NonNullable<PublishCheckInput["questions"]>[number]) {
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

export function runPublishCheck(test: PublishCheckInput) {
  const errors: PublishCheckIssue[] = [];
  const warnings: PublishCheckIssue[] = [];

  if (isBlank(test.title)) {
    errors.push({ code: "NO_TITLE", message: "У теста нет названия" });
  }

  if (test.price == null || test.price < 0) {
    errors.push({ code: "INVALID_PRICE", message: "Цена должна быть 0 или больше" });
  }

  if (!test.durationMinutes || test.durationMinutes <= 0) {
    errors.push({ code: "INVALID_DURATION", message: "Время теста должно быть больше 0" });
  }

  if (!test.accessDays || test.accessDays <= 0) {
    errors.push({ code: "INVALID_ACCESS_DAYS", message: "Срок доступа должен быть больше 0" });
  }

  const questions = (test.questions ?? []).filter((question) => !question.deletedAt);
  if ((test.questionsCount ?? questions.length) <= 0 || questions.length === 0) {
    errors.push({ code: "NO_QUESTIONS", message: "В тесте нет вопросов" });
  }

  if ((test.maxRawScore ?? 0) <= 0) {
    errors.push({ code: "INVALID_MAX_RAW_SCORE", message: "Максимальный балл должен быть больше 0" });
  }

  let questionsWithoutExplanations = 0;
  let questionsWithoutSubtopics = 0;

  for (const [index, question] of questions.entries()) {
    const number = index + 1;
    if (isBlank(question.questionText)) {
      errors.push({ code: "QUESTION_TEXT_REQUIRED", message: `Вопрос ${number}: нет текста` });
    }
    if (isBlank(question.correctAnswer)) {
      errors.push({ code: "QUESTION_CORRECT_ANSWER_REQUIRED", message: `Вопрос ${number}: нет правильного ответа` });
    }
    if (isBlank(question.topic)) {
      errors.push({ code: "QUESTION_TOPIC_REQUIRED", message: `Вопрос ${number}: нет темы` });
    }
    if (!question.points || question.points <= 0) {
      errors.push({ code: "QUESTION_POINTS_REQUIRED", message: `Вопрос ${number}: баллы должны быть больше 0` });
    }

    if (isBlank(question.explanation)) {
      questionsWithoutExplanations += 1;
    }
    if (isBlank(question.subtopic)) {
      questionsWithoutSubtopics += 1;
    }

    if (question.questionType === "SINGLE_CHOICE") {
      const options = filledOptions(question);
      if (options.length < 2) {
        errors.push({ code: "QUESTION_OPTIONS_REQUIRED", message: `Вопрос ${number}: нужно минимум 2 варианта` });
      }
      const answer = question.correctAnswer?.trim().toUpperCase();
      if (answer && !["A", "B", "C", "D"].includes(answer)) {
        errors.push({ code: "QUESTION_SINGLE_ANSWER_INVALID", message: `Вопрос ${number}: ответ должен быть A/B/C/D` });
      }
    }

    if (question.questionType === "MULTIPLE_CHOICE") {
      if (question.points !== 2) {
        errors.push({
          code: "QUESTION_MULTIPLE_CHOICE_POINTS_UNSUPPORTED",
          message: `Вопрос ${number}: для multiple_choice points должен быть равен 2`
        });
      }

      const options = filledOptions(question);
      if (options.length < 2) {
        errors.push({ code: "QUESTION_OPTIONS_REQUIRED", message: `Вопрос ${number}: нужно минимум 2 варианта` });
      }
      const answers = parseChoiceAnswer(question.correctAnswer ?? "");
      if (answers.length === 0 || answers.some((answer) => !["A", "B", "C", "D"].includes(answer))) {
        errors.push({
          code: "QUESTION_MULTIPLE_ANSWER_INVALID",
          message: `Вопрос ${number}: ответы должны быть A/B/C/D через запятую`
        });
      }
    }
  }

  if (questions.length > 0 && questionsWithoutExplanations > 0) {
    warnings.push({
      code: "NO_EXPLANATIONS",
      message: `У ${questionsWithoutExplanations} вопрос(ов) нет объяснения`
    });
  }

  if (questions.length > 0 && questionsWithoutSubtopics > 0) {
    warnings.push({
      code: "NO_SUBTOPICS",
      message: `У ${questionsWithoutSubtopics} вопрос(ов) нет подтемы`
    });
  }

  if (test.showScaledScore) {
    if (!test.scoringSchemeId || !test.scoringScheme) {
      errors.push({ code: "SCORING_SCHEME_REQUIRED", message: "Для шкалы 0-100 нужно выбрать шкалу" });
    } else if (!test.scoringScheme.isActive) {
      errors.push({ code: "SCORING_SCHEME_INACTIVE", message: "Выбранная шкала неактивна" });
    } else if (test.scoringScheme.maxRawScore !== test.maxRawScore) {
      errors.push({
        code: "SCORING_SCHEME_MAX_SCORE_MISMATCH",
        message: "Максимальный балл теста не совпадает со шкалой"
      });
    } else {
      const rawScores = new Set(test.scoringScheme.scales.map((scale) => scale.rawScore));
      if (!rawScores.has(0) || !rawScores.has(test.scoringScheme.maxRawScore)) {
        errors.push({
          code: "SCORING_SCHEME_INCOMPLETE",
          message: "В шкале должна быть строка для 0 и максимального первичного балла"
        });
      }
    }
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
