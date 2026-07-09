"use client";

import { useEffect, useState } from "react";

type Mistake = {
  snapshot_question_id: string;
  order_index: number;
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "short_text";
  selected_answer: string;
  correct_answer: string | null;
  topic: string | null;
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
  scaled_score: number | null;
  max_scaled_score: number | null;
  scaled_score_note: string | null;
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
      <section className="hero compact">
        <div className="stack compact">
          <div className="badge-row">
            <span className="badge accent">{result.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</span>
            <span className={result.status === "expired" ? "status-pill pending" : "status-pill success"}>
              {result.status === "expired" ? "время вышло" : "завершено"}
            </span>
          </div>
          <h1 className="page-title">{result.test_title}</h1>
          <p className="lead">Итоговая оценка и разбор ошибок доступны после завершения попытки.</p>
        </div>
      </section>

      <section className="cards-grid">
        <article className="panel compact">
          <p className="eyebrow">Первичный балл</p>
          <h2 className="metric-value">
            {result.raw_score} / {result.max_raw_score}
          </h2>
        </article>

        {result.scaled_score !== null ? (
          <article className="panel compact">
            <p className="eyebrow">Тестовый балл</p>
            <h2 className="metric-value">
              {result.scaled_score} / {result.max_scaled_score ?? 100}
            </h2>
          </article>
        ) : null}

        <article className="panel compact">
          <p className="eyebrow">Ошибки</p>
          <h2 className="metric-value">{result.mistakes.length}</h2>
        </article>
      </section>

      {result.scaled_score_note ? <p className="state-box">{result.scaled_score_note}</p> : null}

      <section className="panel stack">
        <div>
          <p className="eyebrow">Разбор</p>
          <h2 className="section-title">Ошибки и правильные ответы</h2>
        </div>
        {result.mistakes.length === 0 ? <p className="state-box success">Ошибок нет.</p> : null}
        {result.mistakes.map((mistake) => (
          <article className="result-mistake" key={mistake.snapshot_question_id}>
            <p className="eyebrow">
              Вопрос {mistake.order_index}
              {mistake.topic ? `. ${mistake.topic}` : ""}
              {mistake.subtopic ? ` / ${mistake.subtopic}` : ""}
            </p>
            <h3 className="card-title">{mistake.question_text}</h3>
            <p>
              <strong>Ваш ответ:</strong> {mistake.selected_answer}
            </p>
            {mistake.correct_answer ? (
              <p>
                <strong>Правильный ответ:</strong> {mistake.correct_answer}
              </p>
            ) : null}
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
