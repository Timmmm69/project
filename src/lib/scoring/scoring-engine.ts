import type { ScoringSchemeSnapshot, SnapshotQuestion, TestSnapshot } from "@/lib/attempts/snapshot";
import {
  normalizeCorrectAnswer,
  normalizeShortAnswerTokenAnswer,
  parseMultipleChoiceLetters
} from "@/lib/questions/normalization";

export type TopicStatus = "weak" | "requires_review" | "normal";

export type ScoredAnswer = {
  snapshotQuestionId: string;
  question: SnapshotQuestion;
  selectedAnswer: string | null;
  isCorrect: boolean;
  pointsEarned: number;
  maxPoints: number;
};

export type TopicResult = {
  topic: string;
  score: number;
  max_score: number;
  percent: number;
  status: TopicStatus;
  wrong_subtopics: string[];
};

export type Recommendation = {
  topic: string | null;
  subtopics: string[];
  message: string;
};

export type ScoringResult = {
  answers: ScoredAnswer[];
  rawScore: number;
  maxRawScore: number;
  percent: number;
  level: string;
  scaledScore: number | null;
  maxScaledScore: number | null;
  topicResults: TopicResult[];
  recommendations: Recommendation[];
};

type StudentAnswerInput = {
  snapshotQuestionId: string | null;
  selectedAnswer: string | null;
};

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeStudentAnswer(question: SnapshotQuestion, selectedAnswer: string | null) {
  if (selectedAnswer === null || selectedAnswer.trim().length === 0) {
    return null;
  }

  return normalizeCorrectAnswer(question.questionType, selectedAnswer);
}

function isCorrectAnswer(question: SnapshotQuestion, selectedAnswer: string | null) {
  if (!selectedAnswer) {
    return false;
  }

  const normalizedCorrectAnswer = normalizeCorrectAnswer(question.questionType, question.correctAnswer);
  if (question.questionType === "short_text") {
    return normalizedCorrectAnswer.split(";").filter(Boolean).includes(selectedAnswer);
  }

  return selectedAnswer === normalizedCorrectAnswer;
}

function symmetricDifferenceSize(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let size = 0;

  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      size += 1;
    }
  }
  for (const value of rightSet) {
    if (!leftSet.has(value)) {
      size += 1;
    }
  }

  return size;
}

function scoreQuestion(question: SnapshotQuestion, selectedAnswer: string | null) {
  if (!selectedAnswer) {
    return {
      isCorrect: false,
      pointsEarned: 0
    };
  }

  if (question.questionType === "multiple_choice") {
    if (question.points !== 2) {
      throw new Error("MULTIPLE_CHOICE_POINTS_UNSUPPORTED");
    }

    const correct = parseMultipleChoiceLetters(question.correctAnswer);
    const selected = parseMultipleChoiceLetters(selectedAnswer);
    const diffSize = symmetricDifferenceSize(correct, selected);

    return {
      isCorrect: diffSize === 0,
      pointsEarned: diffSize === 0 ? 2 : diffSize === 1 ? 1 : 0
    };
  }

  const isCorrect = isCorrectAnswer(question, selectedAnswer);
  return {
    isCorrect,
    pointsEarned: isCorrect ? question.points : 0
  };
}

function acceptedAnswerTokens(question: SnapshotQuestion) {
  const accepted = question.acceptedAnswers;
  if (Array.isArray(accepted)) {
    return accepted
      .filter((item): item is string => typeof item === "string")
      .map(normalizeShortAnswerTokenAnswer)
      .filter(Boolean);
  }
  if (typeof accepted === "string") {
    return [normalizeShortAnswerTokenAnswer(accepted)].filter(Boolean);
  }
  return [question.correctAnswer].map(normalizeShortAnswerTokenAnswer).filter(Boolean);
}

// Authentic Russian CE/CT snapshot format:
// Part A uses `correctAnswer` as an A-E set string, e.g. "A,C".
// Part B uses `acceptedAnswers` as the token list, e.g. ["ёж", "ежи"].
export function rikzRussian2026Scoring(question: SnapshotQuestion, selectedAnswer: string | null) {
  if (!selectedAnswer) {
    return {
      isCorrect: false,
      pointsEarned: 0
    };
  }

  if (question.questionType === "multi_select_five") {
    const correct = parseMultipleChoiceLetters(question.correctAnswer);
    const selected = parseMultipleChoiceLetters(selectedAnswer);
    const diffSize = symmetricDifferenceSize(correct, selected);

    return {
      isCorrect: diffSize === 0,
      pointsEarned: diffSize === 0 ? 2 : diffSize === 1 ? 1 : 0
    };
  }

  if (question.questionType === "short_answer_token") {
    const normalizedSelected = normalizeShortAnswerTokenAnswer(selectedAnswer);
    const accepted = acceptedAnswerTokens(question);
    const isCorrect = accepted.includes(normalizedSelected);

    return {
      isCorrect,
      pointsEarned: isCorrect ? question.points : 0
    };
  }

  return scoreQuestion(question, selectedAnswer);
}

export function getResultLevel(percent: number) {
  if (percent < 40) {
    return "низкий";
  }
  if (percent < 60) {
    return "ниже среднего";
  }
  if (percent < 80) {
    return "средний";
  }
  if (percent < 90) {
    return "хороший";
  }
  return "высокий";
}

function getTopicStatus(percent: number): TopicStatus {
  if (percent < 60) {
    return "weak";
  }
  if (percent < 80) {
    return "requires_review";
  }
  return "normal";
}

function buildTopicResults(answers: ScoredAnswer[]): TopicResult[] {
  const topics = new Map<string, { score: number; maxScore: number; wrongSubtopics: Set<string> }>();

  for (const answer of answers) {
    const topic = answer.question.topic;
    const current = topics.get(topic) ?? { score: 0, maxScore: 0, wrongSubtopics: new Set<string>() };
    current.score += answer.pointsEarned;
    current.maxScore += answer.maxPoints;
    if (!answer.isCorrect && answer.question.subtopic) {
      current.wrongSubtopics.add(answer.question.subtopic);
    }
    topics.set(topic, current);
  }

  return Array.from(topics.entries()).map(([topic, value]) => {
    const percent = value.maxScore > 0 ? roundPercent((value.score / value.maxScore) * 100) : 0;
    return {
      topic,
      score: value.score,
      max_score: value.maxScore,
      percent,
      status: getTopicStatus(percent),
      wrong_subtopics: Array.from(value.wrongSubtopics)
    };
  });
}

function buildRecommendations(topicResults: TopicResult[], answers: ScoredAnswer[]): Recommendation[] {
  const mistakes = answers.filter((answer) => !answer.isCorrect);
  if (mistakes.length === 0) {
    return [
      {
        topic: null,
        subtopics: [],
        message: "Ошибок нет. Результат высокий. Для закрепления можно пройти следующий тест."
      }
    ];
  }

  const weakTopics = topicResults.filter((topic) => topic.status === "weak");
  const topicsToRecommend =
    weakTopics.length > 0 ? weakTopics : topicResults.filter((topic) => topic.status === "requires_review");

  if (topicsToRecommend.length === 0) {
    return [
      {
        topic: null,
        subtopics: [],
        message: "Серьезных слабых тем не найдено. Рекомендуем повторить вопросы, в которых были ошибки."
      }
    ];
  }

  return topicsToRecommend.slice(0, 5).map((topic) => {
    const subtopics = topic.wrong_subtopics;
    const message =
      subtopics.length > 0
        ? `Повторите тему "${topic.topic}": ${subtopics.join(", ")}.`
        : `Повторите тему "${topic.topic}".`;

    return {
      topic: topic.topic,
      subtopics,
      message
    };
  });
}

function findScaledScore(rawScore: number, scoringSchemeSnapshot: ScoringSchemeSnapshot | null) {
  if (!scoringSchemeSnapshot) {
    return {
      scaledScore: null,
      maxScaledScore: null
    };
  }

  const match = scoringSchemeSnapshot.scale.find((item) => item.rawScore === rawScore);
  return {
    scaledScore: match?.scaledScore ?? null,
    maxScaledScore: scoringSchemeSnapshot.maxScaledScore
  };
}

// Scaled score is intentionally read only from the attempt's scoring scheme snapshot.
// It must not be recomputed from mutable current ScoringScheme rows after an attempt starts.
function canUseScaledScore(snapshot: TestSnapshot, scoringSchemeSnapshot: ScoringSchemeSnapshot | null) {
  const isRikzRussian2026 = snapshot.examMode === "rikz_russian_2026";
  return (
    (isRikzRussian2026 || snapshot.mode === "ce_ct") &&
    snapshot.maxRawScore === 80 &&
    Boolean(scoringSchemeSnapshot?.scoringSchemeId) &&
    scoringSchemeSnapshot?.subject === "russian" &&
    scoringSchemeSnapshot.examType === "ce_ct" &&
    scoringSchemeSnapshot.year === 2026 &&
    scoringSchemeSnapshot.maxRawScore === 80 &&
    scoringSchemeSnapshot.maxScaledScore === 100
  );
}

export function scoreAttemptSnapshot(
  snapshot: TestSnapshot,
  answers: StudentAnswerInput[],
  scoringSchemeSnapshot: ScoringSchemeSnapshot | null
): ScoringResult {
  const answerByQuestion = new Map(
    answers
      .filter((answer) => answer.snapshotQuestionId)
      .map((answer) => [answer.snapshotQuestionId as string, answer.selectedAnswer])
  );

  const scoredAnswers = snapshot.questions.map((question) => {
    const selectedAnswer = normalizeStudentAnswer(question, answerByQuestion.get(question.snapshotQuestionId) ?? null);
    const score =
      snapshot.examMode === "rikz_russian_2026"
        ? rikzRussian2026Scoring(question, selectedAnswer)
        : scoreQuestion(question, selectedAnswer);
    return {
      snapshotQuestionId: question.snapshotQuestionId,
      question,
      selectedAnswer,
      isCorrect: score.isCorrect,
      pointsEarned: score.pointsEarned,
      maxPoints: question.points
    };
  });

  const rawScore = scoredAnswers.reduce((sum, answer) => sum + answer.pointsEarned, 0);
  const maxRawScore = scoredAnswers.reduce((sum, answer) => sum + answer.maxPoints, 0);
  if (maxRawScore <= 0) {
    throw new Error("INVALID_MAX_RAW_SCORE");
  }

  const percent = roundPercent((rawScore / maxRawScore) * 100);
  const topicResults = buildTopicResults(scoredAnswers);
  const scaled = canUseScaledScore(snapshot, scoringSchemeSnapshot)
    ? findScaledScore(rawScore, scoringSchemeSnapshot)
    : { scaledScore: null, maxScaledScore: null };

  return {
    answers: scoredAnswers,
    rawScore,
    maxRawScore,
    percent,
    level: getResultLevel(percent),
    scaledScore: scaled.scaledScore,
    maxScaledScore: scaled.maxScaledScore,
    topicResults,
    recommendations: buildRecommendations(topicResults, scoredAnswers)
  };
}
