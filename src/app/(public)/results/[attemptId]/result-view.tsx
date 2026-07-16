"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildAuthenticResultSummary,
  formatResultQuestionLabel,
  getScaledScoreDisplay,
  isAuthenticRikzRussianResult,
  parseResultPayload,
  type ResultPayload
} from "./result-view-model";
import {
  AuthenticResultSurface,
  ResultLoadingSurface,
  ResultNotReadySurface,
  ResultTemporaryErrorSurface
} from "./result-surface";

type LoadState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "temporary-error" }>
  | Readonly<{ kind: "not-ready" }>
  | Readonly<{ kind: "success"; result: ResultPayload }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function apiFailureCode(body: unknown) {
  if (!isRecord(body) || body.success !== false || !isRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}

function resultFromApiBody(body: unknown): ResultPayload | null {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data) || !isRecord(body.data.result)) {
    return null;
  }

  return parseResultPayload(body.data.result);
}

function hasRejectedAuthenticResult(body: unknown) {
  return isRecord(body)
    && body.success === true
    && isRecord(body.data)
    && isRecord(body.data.result)
    && body.data.result.exam_mode === "rikz_russian_2026";
}

function statusLabel(status: ResultPayload["status"]) {
  return status === "expired" ? "Время вышло" : "Завершено";
}

export function ResultView({ attemptId }: { attemptId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const requestInFlight = useRef(false);

  const loadResult = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoadState({ kind: "loading" });

    try {
      const response = await fetch(`/api/results/${attemptId}`, {
        cache: "no-store",
        method: "GET"
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        setLoadState({ kind: "temporary-error" });
        return;
      }

      if (!response.ok || (isRecord(body) && body.success === false)) {
        setLoadState({
          kind: apiFailureCode(body) === "RESULT_NOT_READY" ? "not-ready" : "temporary-error"
        });
        return;
      }

      const result = resultFromApiBody(body);
      setLoadState(result
        ? { kind: "success", result }
        : { kind: hasRejectedAuthenticResult(body) ? "not-ready" : "temporary-error" });
    } catch {
      setLoadState({ kind: "temporary-error" });
    } finally {
      requestInFlight.current = false;
    }
  }, [attemptId]);

  useEffect(() => {
    void loadResult();
  }, [loadResult]);

  if (loadState.kind === "loading") {
    return <ResultLoadingSurface />;
  }

  if (loadState.kind === "temporary-error") {
    return <ResultTemporaryErrorSurface onRetry={() => void loadResult()} retrying={requestInFlight.current} />;
  }

  if (loadState.kind === "not-ready") {
    return <ResultNotReadySurface onRetry={() => void loadResult()} retrying={requestInFlight.current} />;
  }

  const result = loadState.result;
  if (isAuthenticRikzRussianResult(result)) {
    const summary = buildAuthenticResultSummary(result);
    return summary
      ? <AuthenticResultSurface summary={summary} />
      : <ResultNotReadySurface onRetry={() => void loadResult()} retrying={requestInFlight.current} />;
  }

  const scaledScore = getScaledScoreDisplay(result);
  const detailItems = result.mistakes;

  return (
    <>
      <section className="hero compact">
        <div className="stack compact">
          <div className="badge-row">
            <span className="badge accent">{result.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</span>
            <span className={result.status === "expired" ? "status-pill pending" : "status-pill success"}>
              {statusLabel(result.status)}
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

      <section className="panel stack">
        <div>
          <p className="eyebrow">Разбор</p>
          <h2 className="section-title">Ошибки и правильные ответы</h2>
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
            <p>
              <strong>Ваш ответ:</strong> {detail.selected_answer}
            </p>
            {detail.correct_answer ? (
              <p>
                <strong>Правильный ответ:</strong> {detail.correct_answer}
              </p>
            ) : null}
            <p className="muted">Баллы: {detail.points_earned} / {detail.max_points}</p>
            {detail.explanation ? <p className="state-box">{detail.explanation}</p> : null}
          </article>
        ))}
      </section>
    </>
  );
}
