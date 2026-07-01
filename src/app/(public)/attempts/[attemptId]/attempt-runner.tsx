"use client";

import { useEffect, useMemo, useState } from "react";

type AttemptQuestion = {
  snapshotQuestionId: string;
  orderIndex: number;
  questionText: string;
  questionType: "single_choice" | "multiple_choice" | "short_text";
  options: {
    A?: string;
    B?: string;
    C?: string;
    D?: string;
  };
  topic: string;
  subtopic: string | null;
};

type AttemptPayload = {
  attemptId: string;
  testId: string;
  status: "started" | "completed" | "expired" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  durationMinutes: number;
  endsAt: string;
  serverNow: string;
  answers: {
    snapshotQuestionId: string | null;
    selectedAnswer: string | null;
    answeredAt: string | null;
  }[];
  questions: AttemptQuestion[];
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

function formatRemaining(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function toggleMultipleAnswer(current: string, letter: string) {
  const values = new Set(current.split(",").filter(Boolean));
  if (values.has(letter)) {
    values.delete(letter);
  } else {
    values.add(letter);
  }
  return Array.from(values).sort().join(",");
}

export function AttemptRunner({ attemptId }: { attemptId: string }) {
  const [attempt, setAttempt] = useState<AttemptPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  async function loadAttempt() {
    setMessage(null);
    const response = await fetch(`/api/attempts/${attemptId}`);
    const body = await readJson<{ attempt: AttemptPayload }>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    const loaded = body.data.attempt;
    setAttempt(loaded);
    setAnswers(
      Object.fromEntries(
        loaded.answers
          .filter((answer) => answer.snapshotQuestionId)
          .map((answer) => [answer.snapshotQuestionId as string, answer.selectedAnswer ?? ""])
      )
    );

    const serverNow = new Date(loaded.serverNow).getTime();
    const endsAt = new Date(loaded.endsAt).getTime();
    setRemainingSeconds(Math.max(0, Math.floor((endsAt - serverNow) / 1000)));
  }

  useEffect(() => {
    void loadAttempt();
  }, [attemptId]);

  useEffect(() => {
    if (!attempt || attempt.status !== "started" || remainingSeconds === null) {
      return;
    }
    if (remainingSeconds <= 0) {
      void handleExpire();
      return;
    }

    const timer = window.setTimeout(() => {
      setRemainingSeconds((value) => (value === null ? value : Math.max(0, value - 1)));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [attempt, remainingSeconds]);

  const answeredCount = useMemo(
    () => Object.values(answers).filter((value) => value.trim().length > 0).length,
    [answers]
  );

  async function saveAnswer(question: AttemptQuestion, value: string) {
    setAnswers((current) => ({ ...current, [question.snapshotQuestionId]: value }));
    setMessage(null);

    const response = await fetch(`/api/attempts/${attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshotQuestionId: question.snapshotQuestionId,
        selectedAnswer: value || null
      })
    });
    const body = await readJson<{ saved: boolean }>(response);
    if (!body.success) {
      setMessage(body.error.message);
    }
  }

  async function handleComplete() {
    if (!confirm("Завершить тест? После этого ответы нельзя будет изменить.")) {
      return;
    }

    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/attempts/${attemptId}/complete`, { method: "POST" });
    const body = await readJson<{ resultUrl: string }>(response);
    setBusy(false);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    await loadAttempt();
    setMessage("Тест завершён. Расчёт результатов будет добавлен в следующем модуле.");
  }

  async function handleExpire() {
    if (busy) {
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/attempts/${attemptId}/expire`, { method: "POST" });
    const body = await readJson<{ resultUrl: string }>(response);
    setBusy(false);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    await loadAttempt();
    setMessage("Время вышло. Попытка завершена.");
  }

  if (!attempt) {
    return (
      <section className="panel">
        <p className={message ? "form-error" : "muted"}>{message ?? "Загрузка попытки"}</p>
      </section>
    );
  }

  const isFinished = attempt.status !== "started";

  return (
    <>
      <section className="toolbar">
        <div>
          <p className="eyebrow">Прохождение теста</p>
          <h1 className="page-title">Попытка</h1>
          <p className="muted">
            Ответов: {answeredCount} из {attempt.questions.length}
          </p>
        </div>
        <div className={remainingSeconds !== null && remainingSeconds <= 60 ? "timer danger" : "timer"}>
          {isFinished ? attempt.status : formatRemaining(remainingSeconds ?? 0)}
        </div>
      </section>

      {message ? <p className={isFinished ? "state-box success" : "form-error"}>{message}</p> : null}

      {isFinished ? (
        <section className="panel stack">
          <h2 className="section-title">Попытка завершена</h2>
          <p className="muted">Ответы больше нельзя изменить. Результаты и scoring появятся в следующем этапе.</p>
        </section>
      ) : null}

      <section className="stack">
        {attempt.questions.map((question) => {
          const value = answers[question.snapshotQuestionId] ?? "";
          return (
            <article className="panel stack compact" key={question.snapshotQuestionId}>
              <div>
                <p className="eyebrow">
                  Вопрос {question.orderIndex}. {question.topic}
                  {question.subtopic ? ` / ${question.subtopic}` : ""}
                </p>
                <h2 className="card-title">{question.questionText}</h2>
              </div>

              {question.questionType === "single_choice" ? (
                <div className="answer-options">
                  {Object.entries(question.options).map(([letter, label]) => (
                    <label className="choice-row" key={letter}>
                      <input
                        type="radio"
                        name={question.snapshotQuestionId}
                        checked={value === letter}
                        disabled={isFinished}
                        onChange={() => saveAnswer(question, letter)}
                      />
                      <span>
                        {letter}. {label}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}

              {question.questionType === "multiple_choice" ? (
                <div className="answer-options">
                  {Object.entries(question.options).map(([letter, label]) => (
                    <label className="choice-row" key={letter}>
                      <input
                        type="checkbox"
                        checked={value.split(",").includes(letter)}
                        disabled={isFinished}
                        onChange={() => saveAnswer(question, toggleMultipleAnswer(value, letter))}
                      />
                      <span>
                        {letter}. {label}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}

              {question.questionType === "short_text" ? (
                <label className="field">
                  <span>Ответ</span>
                  <input
                    value={value}
                    disabled={isFinished}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.snapshotQuestionId]: event.target.value
                      }))
                    }
                    onBlur={(event) => saveAnswer(question, event.target.value)}
                  />
                </label>
              ) : null}
            </article>
          );
        })}
      </section>

      {!isFinished ? (
        <section className="panel">
          <button className="button" type="button" disabled={busy} onClick={handleComplete}>
            Завершить тест
          </button>
        </section>
      ) : null}
    </>
  );
}
