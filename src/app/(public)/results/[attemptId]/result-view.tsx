"use client";

import { useEffect, useState } from "react";
import {
  buildPartBreakdown,
  formatResultQuestionLabel,
  formatResultQuestionType,
  getScaledScoreDisplay,
  isAuthenticRikzRussianResult,
  type ResultPayload
} from "./result-view-model";

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

function statusLabel(status: ResultPayload["status"]) {
  return status === "expired" ? "Время вышло" : "Завершено";
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

  const isAuthentic = isAuthenticRikzRussianResult(result);
  const scaledScore = getScaledScoreDisplay(result);
  const partBreakdown = isAuthentic ? buildPartBreakdown(result.answer_details) : [];
  const detailItems = isAuthentic ? result.answer_details : result.mistakes;

  return (
    <>
      <section className="hero compact">
        <div className="stack compact">
          <div className="badge-row">
            <span className="badge accent">
              {isAuthentic ? "CE/CT Russian 2026 format" : result.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}
            </span>
            <span className={result.status === "expired" ? "status-pill pending" : "status-pill success"}>
              {statusLabel(result.status)}
            </span>
          </div>
          <h1 className="page-title">{result.test_title}</h1>
          <p className="lead">
            {isAuthentic
              ? "Результат тренировочного теста в формате ЦЭ/ЦТ по русскому языку."
              : "Итоговая оценка и разбор ошибок доступны после завершения попытки."}
          </p>
        </div>
      </section>

      <section className="cards-grid">
        <article className="panel compact">
          <p className="eyebrow">Первичный балл</p>
          <h2 className="metric-value">
            {result.raw_score} / {result.max_raw_score}
          </h2>
          {isAuthentic ? (
            <p className="muted">
              Набрано: {result.raw_score} из {result.max_raw_score} первичных баллов
            </p>
          ) : null}
        </article>

        {scaledScore ? (
          <article className="panel compact">
            <p className="eyebrow">Тестовый балл</p>
            <h2 className="metric-value">
              {scaledScore.score} / {scaledScore.maxScore}
            </h2>
          </article>
        ) : null}

        <article className="panel compact">
          <p className="eyebrow">Ошибки</p>
          <h2 className="metric-value">{result.mistakes.length}</h2>
        </article>
      </section>

      {result.scaled_score_note ? <p className="state-box">{result.scaled_score_note}</p> : null}

      {partBreakdown.length > 0 ? (
        <section className="cards-grid">
          {partBreakdown.map((part) => (
            <article className="panel compact" key={part.part}>
              <p className="eyebrow">Part {part.part}</p>
              <h2 className="metric-value">{part.count}</h2>
              <p className="muted">
                Заданий, {part.score} / {part.maxScore} первичных баллов
              </p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel stack">
        <div>
          <p className="eyebrow">Разбор</p>
          <h2 className="section-title">{isAuthentic ? "Детали ответов" : "Ошибки и правильные ответы"}</h2>
        </div>
        {detailItems.length === 0 ? <p className="state-box success">Ошибок нет.</p> : null}
        {detailItems.map((detail) => (
          <article className="result-mistake" key={detail.snapshot_question_id}>
            <p className="eyebrow">
              {formatResultQuestionLabel(detail)}
              {detail.topic ? `. ${detail.topic}` : ""}
              {detail.subtopic ? ` / ${detail.subtopic}` : ""}
            </p>
            <h3 className="card-title">{detail.question_text}</h3>
            {isAuthentic ? <p className="muted">{formatResultQuestionType(detail)}</p> : null}
            <p>
              <strong>{isAuthentic ? "Ответ ученика:" : "Ваш ответ:"}</strong> {detail.selected_answer}
            </p>
            {!isAuthentic && detail.correct_answer ? (
              <p>
                <strong>Правильный ответ:</strong> {detail.correct_answer}
              </p>
            ) : null}
            <p className="muted">
              {isAuthentic ? "Первичные баллы" : "Баллы"}: {detail.points_earned} / {detail.max_points}
            </p>
            {!isAuthentic && detail.explanation ? <p className="state-box">{detail.explanation}</p> : null}
          </article>
        ))}
      </section>
    </>
  );
}
