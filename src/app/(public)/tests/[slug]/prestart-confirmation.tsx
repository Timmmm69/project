"use client";

import { useEffect, useRef, useState } from "react";

type PrestartState = "confirmation_ready" | "creating_attempt" | "already_started" | "start_error";

type StartSuccess = Readonly<{
  nextAction: "OPEN_ATTEMPT" | "OPEN_RESULT";
  nextUrl: string;
  restored: boolean;
}>;

function safeDestination(action: StartSuccess["nextAction"], value: string) {
  const prefix = action === "OPEN_ATTEMPT" ? "attempts" : "results";
  return new RegExp(
    `^/${prefix}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    "i"
  ).test(value);
}

function parseStartSuccess(value: unknown): StartSuccess | null {
  if (!value || typeof value !== "object" || !("success" in value) || value.success !== true ||
    !("data" in value) || !value.data || typeof value.data !== "object") {
    return null;
  }
  const data = value.data as Record<string, unknown>;
  if ((data.nextAction !== "OPEN_ATTEMPT" && data.nextAction !== "OPEN_RESULT") ||
    typeof data.nextUrl !== "string" || typeof data.restored !== "boolean" ||
    !safeDestination(data.nextAction, data.nextUrl)) {
    return null;
  }
  return {
    nextAction: data.nextAction,
    nextUrl: data.nextUrl,
    restored: data.restored
  };
}

export function PrestartConfirmation({ testId, cancelHref }: Readonly<{
  testId: string;
  cancelHref: string;
}>) {
  const [state, setState] = useState<PrestartState>("confirmation_ready");
  const [continueHref, setContinueHref] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state === "start_error") errorRef.current?.focus();
  }, [state]);

  async function startAttempt() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState("creating_attempt");
    setContinueHref(null);

    try {
      const response = await fetch("/api/attempts/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testId })
      });
      const body: unknown = await response.json();
      const success = response.ok ? parseStartSuccess(body) : null;
      if (!success) throw new Error("SAFE_START_FAILURE");

      if (success.nextAction === "OPEN_ATTEMPT" && success.restored) {
        setContinueHref(success.nextUrl);
        setState("already_started");
        return;
      }
      window.location.assign(success.nextUrl);
    } catch {
      setState("start_error");
    } finally {
      inFlightRef.current = false;
    }
  }

  if (state === "already_started" && continueHref) {
    return (
      <section className="panel prestart-surface" aria-labelledby="prestart-title">
        <div className="stack">
          <h1 className="page-title prestart-title" id="prestart-title" ref={headingRef} tabIndex={-1}>
            Попытка уже началась
          </h1>
          <p>Новая попытка не создаётся. Время продолжает идти с первоначального старта.</p>
          <div className="prestart-actions">
            <button className="button" type="button" onClick={() => window.location.assign(continueHref)}>
              Продолжить попытку
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (state === "start_error") {
    return (
      <section className="panel prestart-surface" aria-labelledby="prestart-title">
        <div className="stack">
          <h1 className="page-title prestart-title" id="prestart-title" ref={headingRef} tabIndex={-1}>
            Перед началом попытки
          </h1>
          <div className="prestart-error" ref={errorRef} role="alert" tabIndex={-1}>
            Не удалось запустить попытку. Система проверит, не была ли она уже создана. Повторите действие.
          </div>
          <div className="prestart-actions">
            <button className="button" type="button" onClick={startAttempt}>
              Проверить и повторить
            </button>
          </div>
        </div>
      </section>
    );
  }

  const creating = state === "creating_attempt";
  return (
    <section className="panel prestart-surface" aria-labelledby="prestart-title">
      <div className="stack">
        <h1 className="page-title prestart-title" id="prestart-title" ref={headingRef} tabIndex={-1}>
          Перед началом попытки
        </h1>
        <ul className="prestart-facts">
          <li>Это единственная попытка по данной покупке.</li>
          <li>После старта непрерывно идёт 120 минут. Паузы нет.</li>
          <li>Закрытие страницы, вкладки или браузера не останавливает время.</li>
          <li>После завершения показывается первичный результат: общий, Part A и Part B.</li>
        </ul>
        {creating ? <p className="prestart-status" role="status">Запускаем попытку…</p> : null}
        <div className="prestart-actions">
          <button
            aria-label="Начать единственную попытку и запустить непрерывный таймер на 120 минут"
            className="button"
            disabled={creating}
            type="button"
            onClick={startAttempt}
          >
            Начать попытку
          </button>
          <button
            className="button secondary"
            disabled={creating}
            type="button"
            onClick={() => window.location.assign(cancelHref)}
          >
            Вернуться без старта
          </button>
        </div>
      </div>
    </section>
  );
}

export function PrestartAccessExpired() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="prestart-access-expired-title"
      className="panel prestart-surface"
    >
      <div className="stack">
        <h1
          aria-describedby="prestart-access-expired-description"
          className="page-title prestart-title"
          id="prestart-access-expired-title"
          ref={headingRef}
          tabIndex={-1}
        >
          Срок начала попытки истёк
        </h1>
        <p className="prestart-error" id="prestart-access-expired-description">
          Начать попытку по этому доступу нельзя. Обратитесь в поддержку для проверки ситуации.
        </p>
      </div>
    </section>
  );
}
