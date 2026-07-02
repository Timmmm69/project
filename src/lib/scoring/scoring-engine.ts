import type { ScoringSchemeSnapshot, SnapshotQuestion, TestSnapshot } from "@/lib/attempts/snapshot";
import { normalizeCorrectAnswer } from "@/lib/questions/normalization";

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
    const isCorrect = isCorrectAnswer(question, selectedAnswer);
    return {
      snapshotQuestionId: question.snapshotQuestionId,
      question,
      selectedAnswer,
      isCorrect,
      pointsEarned: isCorrect ? question.points : 0,
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
  const scaled = snapshot.mode === "ce_ct" ? findScaledScore(rawScore, scoringSchemeSnapshot) : { scaledScore: null, maxScaledScore: null };

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
