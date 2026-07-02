"use client";

import { useEffect, useState } from "react";

type TopicResult = {
  topic: string;
  score: number;
  max_score: number;
  percent: number;
  status: "weak" | "requires_review" | "normal";
  wrong_subtopics: string[];
};

type Recommendation = {
  topic: string | null;
  subtopics: string[];
  message: string;
};

type Mistake = {
  snapshot_question_id: string;
  order_index: number;
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "short_text";
  selected_answer: string;
  correct_answer: string;
  topic: string;
  subtopic: string | null;
  points_earned: number;
  max_points: number;
  explanation: string | null;
};

type ResultPayload = {
  attempt_id: string;
  test_title: string;
  status: "completed" | "expired" | "cancelled";
  mode: "training" | "ce_ct";
  raw_score: number;
  max_raw_score: number;
  percent: number | null;
  level: string | null;
  scaled_score: number | null;
  max_scaled_score: number | null;
  scaled_score_note: string | null;
  topic_results: TopicResult[];
  recommendations: Recommendation[];
  mistakes: Mistake[];
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

const topicStatusLabels = {
  weak: "Слабая тема",
  requires_review: "Требует повторения",
  normal: "Нормально"
};

async function readJson<T>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

export function ResultView({ attemptId }: { attemptId: string }) {
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadResult() {
      const response = await fetch(`/api/results/${attemptId}`);
      const body = await readJson<{ result: ResultPayload }>(response);
      if (!body.success) {
        setMessage(body.error.message);
        return;
      }

      setResult(body.data.result);
    }

    void loadResult();
  }, [attemptId]);

  if (!result) {
    return (
      <section className="panel">
        <p className={message ? "form-error" : "muted"}>{message ?? "Загрузка результата"}</p>
      </section>
    );
  }

  return (
    <>
      <section className="toolbar">
        <div>
          <p className="eyebrow">Результат теста</p>
          <h1 className="page-title">{result.test_title}</h1>
          <p className="muted">{result.status === "expired" ? "Время вышло" : "Попытка завершена"}</p>
        </div>
      </section>

      <section className="cards-grid">
        <article className="panel compact">
          <p className="eyebrow">Первичный балл</p>
          <h2 className="metric-value">
            {result.raw_score} / {result.max_raw_score}
          </h2>
        </article>
        {result.percent !== null ? (
          <article className="panel compact">
            <p className="eyebrow">Процент</p>
            <h2 className="metric-value">{result.percent.toFixed(1)}%</h2>
          </article>
        ) : null}
        <article className="panel compact">
          <p className="eyebrow">Уровень</p>
          <h2 className="metric-value">{result.level ?? "-"}</h2>
        </article>
        {result.scaled_score !== null ? (
          <article className="panel compact">
            <p className="eyebrow">Тестовый балл</p>
            <h2 className="metric-value">
              {result.scaled_score} / {result.max_scaled_score ?? 100}
            </h2>
          </article>
        ) : null}
      </section>

      {result.scaled_score_note ? <p className="state-box">{result.scaled_score_note}</p> : null}

      <section className="panel stack">
        <h2 className="section-title">Темы</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тема</th>
                <th>Балл</th>
                <th>Процент</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {result.topic_results.map((topic) => (
                <tr key={topic.topic}>
                  <td>
                    {topic.topic}
                    {topic.wrong_subtopics.length > 0 ? (
                      <p className="muted">{topic.wrong_subtopics.join(", ")}</p>
                    ) : null}
                  </td>
                  <td>
                    {topic.score} / {topic.max_score}
                  </td>
                  <td>{topic.percent.toFixed(1)}%</td>
                  <td>{topicStatusLabels[topic.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="section-title">Рекомендации</h2>
        {result.recommendations.map((recommendation, index) => (
          <p className="state-box" key={`${recommendation.topic ?? "general"}-${index}`}>
            {recommendation.message}
          </p>
        ))}
      </section>

      <section className="panel stack">
        <h2 className="section-title">Ошибки</h2>
        {result.mistakes.length === 0 ? <p className="state-box success">Ошибок нет.</p> : null}
        {result.mistakes.map((mistake) => (
          <article className="result-mistake" key={mistake.snapshot_question_id}>
            <p className="eyebrow">
              Вопрос {mistake.order_index}. {mistake.topic}
              {mistake.subtopic ? ` / ${mistake.subtopic}` : ""}
            </p>
            <h3 className="card-title">{mistake.question_text}</h3>
            <p>
              <strong>Ваш ответ:</strong> {mistake.selected_answer}
            </p>
            <p>
              <strong>Правильный ответ:</strong> {mistake.correct_answer}
            </p>
            <p className="muted">
              Баллы: {mistake.points_earned} / {mistake.max_points}
            </p>
            {mistake.explanation ? <p className="state-box">{mistake.explanation}</p> : null}
          </article>
        ))}
      </section>
    </>
  );
}
