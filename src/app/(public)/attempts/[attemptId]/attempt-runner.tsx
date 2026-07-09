"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AttemptQuestion = {
  snapshotQuestionId: string;
  orderIndex: number;
  questionText: string;
  questionType: "single_choice" | "multiple_choice" | "short_text" | "multi_select_five" | "short_answer_token";
  officialPart: "A" | "B" | null;
  officialNumber: number | null;
  options: {
    A?: string;
    B?: string;
    C?: string;
    D?: string;
    E?: string;
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

export function toggleMultipleAnswer(current: string, letter: string) {
  const values = new Set(current.split(",").filter(Boolean));
  if (values.has(letter)) {
    values.delete(letter);
  } else {
    values.add(letter);
  }
  return Array.from(values).sort().join(",");
}

function questionLabel(question: AttemptQuestion) {
  if (question.officialPart && question.officialNumber) {
    return `Part ${question.officialPart}${question.officialNumber}`;
  }
  return `Question ${question.orderIndex}`;
}

export function AttemptRunner({ attemptId }: { attemptId: string }) {
  const [attempt, setAttempt] = useState<AttemptPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answersRef = useRef<Record<string, string>>({});
  const saveQueuesRef = useRef<Record<string, Promise<void>>>({});
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
    const loadedAnswers = Object.fromEntries(
      loaded.answers
        .filter((answer) => answer.snapshotQuestionId)
        .map((answer) => [answer.snapshotQuestionId as string, answer.selectedAnswer ?? ""])
    );
    setAttempt(loaded);
    answersRef.current = loadedAnswers;
    setAnswers(loadedAnswers);

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
  const progressPercent = attempt?.questions.length ? Math.round((answeredCount / attempt.questions.length) * 100) : 0;

  async function persistAnswer(question: AttemptQuestion, value: string) {
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

  function saveAnswer(question: AttemptQuestion, value: string) {
    const nextAnswers = {
      ...answersRef.current,
      [question.snapshotQuestionId]: value
    };
    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    const previousSave = saveQueuesRef.current[question.snapshotQuestionId] ?? Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(() => persistAnswer(question, value));
    saveQueuesRef.current[question.snapshotQuestionId] = nextSave;
  }

  function saveMultipleAnswer(question: AttemptQuestion, letter: string) {
    const currentValue = answersRef.current[question.snapshotQuestionId] ?? "";
    saveAnswer(question, toggleMultipleAnswer(currentValue, letter));
  }

  async function handleComplete() {
    if (!confirm("Завершить тест? После этого ответы нельзя будет изменить.")) {
      return;
    }

    setBusy(true);
    setMessage(null);
    await Promise.all(Object.values(saveQueuesRef.current));
    const response = await fetch(`/api/attempts/${attemptId}/complete`, { method: "POST" });
    const body = await readJson<{ resultUrl: string }>(response);
    setBusy(false);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    window.location.href = body.data.resultUrl;
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

    window.location.href = body.data.resultUrl;
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
      <section className="hero compact">
        <div className="toolbar">
          <div className="stack compact">
            <p className="eyebrow">Прохождение теста</p>
            <h1 className="page-title">Попытка</h1>
            <p className="lead">
              Ответы сохраняются автоматически. Обновление страницы не списывает вторую попытку.
            </p>
          </div>
          <div className={remainingSeconds !== null && remainingSeconds <= 60 ? "timer danger" : "timer"}>
            {isFinished ? attempt.status : formatRemaining(remainingSeconds ?? 0)}
          </div>
        </div>
        <div className="stack compact">
          <p className="muted">
            Ответов: {answeredCount} из {attempt.questions.length}
          </p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </section>

      {message ? <p className={isFinished ? "state-box success" : "form-error"}>{message}</p> : null}

      {isFinished ? (
        <section className="panel stack">
          <h2 className="section-title">Попытка завершена</h2>
          <a className="button" href={`/results/${attemptId}`}>
            Посмотреть результат
          </a>
        </section>
      ) : null}

      <section className="attempt-layout">
        <div className="stack">
          {attempt.questions.map((question) => {
            const value = answers[question.snapshotQuestionId] ?? "";
            return (
              <article className="panel stack compact" key={question.snapshotQuestionId}>
                <div>
                  <p className="eyebrow">
                    Вопрос {question.orderIndex}. {question.topic}
                    {question.subtopic ? ` / ${question.subtopic}` : ""}
                  </p>
                  {question.officialPart && question.officialNumber ? (
                    <p className="muted">{questionLabel(question)}</p>
                  ) : null}
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

                {question.questionType === "multiple_choice" || question.questionType === "multi_select_five" ? (
                  <div className="answer-options">
                    {Object.entries(question.options).map(([letter, label]) => (
                      <label className="choice-row" key={letter}>
                        <input
                          type="checkbox"
                          checked={value.split(",").includes(letter)}
                          disabled={isFinished}
                          onChange={() => saveMultipleAnswer(question, letter)}
                        />
                        <span>
                          {letter}. {label}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}

                {question.questionType === "short_text" || question.questionType === "short_answer_token" ? (
                  <label className="field">
                    <span>Ответ</span>
                    <input
                      value={value}
                      disabled={isFinished}
                      onChange={(event) => saveAnswer(question, event.target.value)}
                    />
                  </label>
                ) : null}
              </article>
            );
          })}
        </div>

        {!isFinished ? (
          <aside className="panel stack compact attempt-side">
            <p className="eyebrow">Завершение</p>
            <p className="muted">
              Проверьте ответы перед отправкой. После завершения изменить их нельзя.
            </p>
            <button className="button" type="button" disabled={busy} onClick={handleComplete}>
              Завершить тест
            </button>
          </aside>
        ) : null}
      </section>
    </>
  );
}
