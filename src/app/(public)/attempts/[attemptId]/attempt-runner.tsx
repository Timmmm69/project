"use client";

import { parsePolicyAnswer, type AnswerPolicy } from "@/lib/scoring/answer-policy";
import { useEffect, useMemo, useRef, useState } from "react";

type AttemptQuestion = {
  snapshotQuestionId: string;
  orderIndex: number;
  questionText: string;
  questionType: "single_choice" | "multiple_choice" | "short_text" | "multi_select_five" | "short_answer_token";
  officialPart: "A" | "B" | null;
  officialNumber: number | null;
  answerFormat?: AnswerPolicy;
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
  const finishingRef = useRef(false);
  const deadlineRef = useRef(0);
  const [expiryRetry, setExpiryRetry] = useState(0);
  const [checkedFormats, setCheckedFormats] = useState<Record<string, boolean>>({});
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
    deadlineRef.current = performance.now() + Math.max(0, endsAt - serverNow);
    setRemainingSeconds(Math.max(0, Math.ceil((endsAt - serverNow) / 1000)));
  }

  useEffect(() => {
    void loadAttempt();
  }, [attemptId]);

  useEffect(() => {
    if (!attempt || attempt.status !== "started" || remainingSeconds === null) {
      return;
    }
    if (remainingSeconds <= 0) {
      if (busy) return;
      const retryDelay = expiryRetry === 0 ? 0 : Math.min(30_000, 1000 * 2 ** Math.min(expiryRetry - 1, 5));
      const retry = window.setTimeout(() => { void handleExpire(); }, retryDelay);
      return () => window.clearTimeout(retry);
    }

    const timer = window.setTimeout(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((deadlineRef.current - performance.now()) / 1000)));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [attempt, remainingSeconds, busy, expiryRetry]);

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
      throw new Error(body.error.message);
    }
  }

  function saveAnswer(question: AttemptQuestion, value: string) {
    if (finishingRef.current) return;
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
    void nextSave.catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Не удалось сохранить ответ. Проверьте соединение."));
  }

  function saveMultipleAnswer(question: AttemptQuestion, letter: string) {
    const currentValue = answersRef.current[question.snapshotQuestionId] ?? "";
    saveAnswer(question, toggleMultipleAnswer(currentValue, letter));
  }

  async function finishAttempt(expire: boolean) {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (expire) {
        // Pending requests remain subject to the server deadline.
        await Promise.allSettled(Object.values(saveQueuesRef.current));
      } else {
        // Retry failed autosaves with the latest raw value. Inputs are frozen
        // synchronously so a failed save cannot silently finish a stale answer.
        const pending = Object.entries(saveQueuesRef.current);
        const results = await Promise.allSettled(pending.map(([, promise]) => promise));
        const failedIds = new Set(pending.filter((_, index) => results[index].status === "rejected").map(([id]) => id));
        await Promise.all(attempt!.questions.filter((question) => failedIds.has(question.snapshotQuestionId)).map((question) =>
          persistAnswer(question, answersRef.current[question.snapshotQuestionId] ?? "")
        ));
      }
      const response = await fetch(`/api/attempts/${attemptId}/${expire ? "expire" : "complete"}`, { method: "POST" });
      const body = await readJson<{ resultUrl: string }>(response);
      if (!body.success) throw new Error(body.error.message);
      window.location.href = body.data.resultUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось завершить тест. Проверьте соединение и повторите.");
      finishingRef.current = false;
      setExpiryRetry((value) => value + 1);
      setBusy(false);
    }
  }

  async function handleComplete() {
    if (!finishingRef.current && confirm("Завершить тест? После этого ответы нельзя будет изменить.")) {
      await finishAttempt(false);
    }
  }

  async function handleExpire() {
    await finishAttempt(true);
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
                          disabled={isFinished || busy}
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
                          disabled={isFinished || busy}
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
                      disabled={isFinished || busy}
                      aria-describedby={question.answerFormat ? `${question.snapshotQuestionId}-format` : undefined}
                      aria-invalid={Boolean(checkedFormats[question.snapshotQuestionId] && question.answerFormat && parsePolicyAnswer(value, question.answerFormat).status === "invalid")}
                      onBlur={() => setCheckedFormats((current) => ({ ...current, [question.snapshotQuestionId]: true }))}
                      onChange={(event) => saveAnswer(question, event.target.value)}
                    />
                    {question.answerFormat ? (
                      <span className="muted" id={`${question.snapshotQuestionId}-format`}>
                        {question.answerFormat.kind === "set"
                          ? `Цифры ${question.answerFormat.alphabet.split("").join(", ")} без повторов. Порядок не важен; можно разделять пробелами или запятыми.`
                          : question.answerFormat.kind === "matching"
                            ? `Все пары в порядке ${question.answerFormat.positions.split("").join("–")}, без пробелов: буква и цифра ${question.answerFormat.values.split("").join(", ")}. Используйте кириллицу.`
                            : question.answerFormat.subtype === "digits"
                              ? "Запишите цифры подряд в требуемом порядке."
                              : "Запишите ответ без пробелов. Буквы е и ё различаются."}
                        {checkedFormats[question.snapshotQuestionId] && value.trim() && parsePolicyAnswer(value, question.answerFormat).status === "invalid"
                          ? " Запись неполная или содержит недопустимые символы; проверьте формат." : ""}
                      </span>
                    ) : null}
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
