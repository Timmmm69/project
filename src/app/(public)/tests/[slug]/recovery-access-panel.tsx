"use client";

import { FormEvent, useEffect, useReducer, useRef, useState } from "react";
import {
  initialRecoveryUiState,
  parseChallengeResponse,
  parseContinuationResponse,
  parseRecoveryStateResponse,
  parseVerificationResponse,
  recoveryErrorCode,
  recoveryUiReducer,
  reuseLogicalOperationId,
  safeRecoveryErrorText,
  type RecoveryRetryTarget
} from "./recovery-access-machine";

type RecoveryAccessPanelProps = Readonly<{
  productCode: string;
  supportEmail: string;
}>;

function safeRetryAfter(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86_400
    ? seconds
    : undefined;
}

async function readResponseBody(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

const actionableCopy = {
  access_unstarted: {
    text: "Доступ найден. Можно перейти к началу теста.",
    action: "Перейти к тесту"
  },
  attempt_active: {
    text: "Найдена активная попытка. Таймер продолжает отсчитываться с момента начала.",
    action: "Продолжить тест"
  },
  result_available: {
    text: "Завершённая попытка найдена. Результат можно открыть повторно.",
    action: "Посмотреть результат"
  }
} as const;

export function RecoveryAccessPanel({
  productCode,
  supportEmail
}: RecoveryAccessPanelProps) {
  const [state, dispatch] = useReducer(recoveryUiReducer, initialRecoveryUiState);
  const [email, setEmail] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const otpValueRef = useRef("");
  const requestOperationRef = useRef<string | null>(null);
  const verificationOperationRef = useRef<string | null>(null);
  const continuationOperationRef = useRef<string | null>(null);
  const requestEmailRef = useRef("");
  const requestInFlightRef = useRef(false);
  const verificationInFlightRef = useRef(false);
  const resolveInFlightRef = useRef(false);
  const continuationInFlightRef = useRef(false);
  const mountedProbeRef = useRef(false);

  useEffect(() => {
    if (mountedProbeRef.current) return;
    mountedProbeRef.current = true;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/recovery/state", {
          cache: "no-store",
          credentials: "same-origin"
        });
        const body = await readResponseBody(response);
        if (!active) return;
        if (response.ok) {
          const resolved = parseRecoveryStateResponse(body);
          if (resolved) dispatch({ type: "RESOLVE_SUCCEEDED", state: resolved });
          return;
        }
        const code = recoveryErrorCode(body);
        if (response.status === 404 && code === "FEATURE_UNAVAILABLE") {
          dispatch({ type: "FEATURE_UNAVAILABLE" });
        } else if (response.status === 403 && code === "SCOPE_NOT_ALLOWED") {
          dispatch({ type: "SCOPE_NOT_ALLOWED" });
        }
      } catch {
        // The unopened secondary flow stays quiet on an initial network failure.
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const nextDeadline = Math.max(
      state.resendAvailableAt ?? 0,
      state.retryAvailableAt ?? 0
    );
    if (nextDeadline === 0) return;
    setNow(Date.now());
    if (nextDeadline <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.resendAvailableAt, state.retryAvailableAt]);

  useEffect(() => {
    if (state.phase === "closed" || state.phase === "feature_unavailable") return;
    const target = state.errorCode ? errorRef.current : headingRef.current;
    target?.focus();
  }, [state.phase, state.errorCode]);

  function temporaryFailure(
    errorCode: string,
    retryTarget: RecoveryRetryTarget,
    retryAfterSeconds?: number
  ) {
    dispatch({
      type: "TEMPORARY_ERROR",
      errorCode,
      retryTarget,
      retryAfterSeconds,
      now: Date.now()
    });
  }

  async function handleErrorResponse(
    response: Response,
    body: unknown,
    context: "email" | "code" | "resolve" | "continue"
  ) {
    const code = recoveryErrorCode(body);
    if (code === "FEATURE_UNAVAILABLE") {
      dispatch({ type: "FEATURE_UNAVAILABLE" });
      return;
    }
    if (code === "CODE_INVALID" && context === "code") {
      dispatch({ type: "CODE_INVALID" });
      return;
    }
    if (code === "CODE_EXPIRED" && context === "code") {
      dispatch({ type: "CODE_EXPIRED", now: Date.now() });
      return;
    }
    if (code === "CHALLENGE_NOT_ACTIVE" || code === "RECOVERY_SESSION_REQUIRED") {
      dispatch({ type: "SESSION_REQUIRED", errorCode: code });
      return;
    }
    if (code === "SCOPE_NOT_ALLOWED") {
      dispatch({ type: "SCOPE_NOT_ALLOWED" });
      return;
    }
    if (code === "STATE_CHANGED_RETRY_RESOLVE" && context === "continue") {
      continuationOperationRef.current = null;
      dispatch({ type: "STATE_CHANGED" });
      await resolveState();
      return;
    }
    if (code === "CONTINUATION_OPERATION_CONFLICT" && context === "continue") {
      dispatch({ type: "CONTINUATION_CONFLICT" });
      return;
    }
    if (code === "INVALID_REQUEST") {
      if (context === "email" || context === "code") {
        dispatch({ type: "INVALID_REQUEST", context });
      } else {
        temporaryFailure("INVALID_REQUEST", context);
      }
      return;
    }

    const retryTarget: RecoveryRetryTarget = context === "email"
      ? "request_code"
      : context === "code"
        ? "verify_code"
        : context;
    temporaryFailure(
      code === "RATE_LIMITED" ? "RATE_LIMITED" :
        code === "RESOLUTION_TEMPORARY_ERROR" ? code :
          code === "TEMPORARY_UNAVAILABLE" ? code : "TEMPORARY_UNAVAILABLE",
      retryTarget,
      code === "RATE_LIMITED" ? safeRetryAfter(response) : undefined
    );
  }

  async function resolveState(silentSessionRequired = false) {
    if (resolveInFlightRef.current) return;
    resolveInFlightRef.current = true;
    dispatch({ type: "RESOLVE_STARTED" });
    try {
      const response = await fetch("/api/recovery/state", {
        cache: "no-store",
        credentials: "same-origin"
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        if (silentSessionRequired && response.status === 401 &&
          recoveryErrorCode(body) === "RECOVERY_SESSION_REQUIRED") {
          dispatch({ type: "SESSION_REQUIRED" });
          return;
        }
        await handleErrorResponse(response, body, "resolve");
        return;
      }
      const resolved = parseRecoveryStateResponse(body);
      if (response.status !== 200 || !resolved) {
        temporaryFailure("MALFORMED_RESPONSE", "resolve");
        return;
      }
      dispatch({ type: "RESOLVE_SUCCEEDED", state: resolved });
    } catch {
      temporaryFailure("NETWORK_FAILURE", "resolve");
    } finally {
      resolveInFlightRef.current = false;
    }
  }

  function openPanel() {
    dispatch({ type: "OPEN" });
    void resolveState(true);
  }

  function changeEmail(value: string) {
    setEmail(value);
    requestEmailRef.current = normalizeEmail(value);
    requestOperationRef.current = null;
    verificationOperationRef.current = null;
    otpValueRef.current = "";
    dispatch({ type: "EMAIL_CHANGED" });
  }

  async function requestCode(forceNewOperation: boolean) {
    if (requestInFlightRef.current) return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      dispatch({ type: "INVALID_REQUEST", context: "email" });
      return;
    }
    if (forceNewOperation) requestOperationRef.current = null;
    requestOperationRef.current = reuseLogicalOperationId(
      requestOperationRef.current,
      () => crypto.randomUUID()
    );
    const operationId = requestOperationRef.current;
    requestEmailRef.current = normalizedEmail;
    requestInFlightRef.current = true;
    dispatch({ type: "REQUEST_STARTED", operationId });
    try {
      const response = await fetch("/api/recovery/challenges", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          productCode,
          intent: "recovery",
          idempotencyKey: operationId
        })
      });
      const body = await readResponseBody(response);
      if (requestEmailRef.current !== normalizedEmail) return;
      if (!response.ok) {
        await handleErrorResponse(response, body, "email");
        return;
      }
      const parsed = parseChallengeResponse(body);
      if (!parsed || response.status !== 202) {
        temporaryFailure("MALFORMED_RESPONSE", "request_code");
        return;
      }
      requestOperationRef.current = null;
      dispatch({ type: "REQUEST_SUCCEEDED", ...parsed, now: Date.now() });
    } catch {
      temporaryFailure("NETWORK_FAILURE", "request_code");
    } finally {
      requestInFlightRef.current = false;
    }
  }

  async function verifyCode() {
    if (verificationInFlightRef.current) return;
    const code = otpValueRef.current;
    if (!/^\d{6}$/.test(code)) {
      dispatch({ type: "INVALID_REQUEST", context: "code" });
      return;
    }
    verificationOperationRef.current = reuseLogicalOperationId(
      verificationOperationRef.current,
      () => crypto.randomUUID()
    );
    const operationId = verificationOperationRef.current;
    verificationInFlightRef.current = true;
    dispatch({ type: "VERIFICATION_STARTED", operationId });
    try {
      const response = await fetch("/api/recovery/challenges/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, operationId })
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        await handleErrorResponse(response, body, "code");
        return;
      }
      if (response.status !== 200 || !parseVerificationResponse(body)) {
        temporaryFailure("MALFORMED_RESPONSE", "verify_code");
        return;
      }
      verificationOperationRef.current = null;
      otpValueRef.current = "";
      dispatch({ type: "VERIFICATION_SUCCEEDED" });
      await resolveState();
    } catch {
      temporaryFailure("NETWORK_FAILURE", "verify_code");
    } finally {
      verificationInFlightRef.current = false;
    }
  }

  async function continueRecovery() {
    if (continuationInFlightRef.current) return;
    continuationOperationRef.current = reuseLogicalOperationId(
      continuationOperationRef.current,
      () => crypto.randomUUID()
    );
    const operationId = continuationOperationRef.current;
    continuationInFlightRef.current = true;
    dispatch({ type: "CONTINUATION_STARTED", operationId });
    try {
      const response = await fetch("/api/recovery/continue", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId })
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        await handleErrorResponse(response, body, "continue");
        return;
      }
      const destination = parseContinuationResponse(body);
      if (response.status !== 200 || !destination) {
        temporaryFailure("MALFORMED_RESPONSE", "continue");
        return;
      }
      window.location.assign(destination.nextUrl);
    } catch {
      temporaryFailure("NETWORK_FAILURE", "continue");
    } finally {
      continuationInFlightRef.current = false;
    }
  }

  async function cancelRecovery() {
    try {
      await fetch("/api/recovery/session", {
        method: "DELETE",
        credentials: "same-origin"
      });
    } catch {
      // Local cleanup is still safe; DELETE is idempotent and can be retried later.
    } finally {
      requestOperationRef.current = null;
      verificationOperationRef.current = null;
      continuationOperationRef.current = null;
      otpValueRef.current = "";
      setEmail("");
      dispatch({ type: "CANCEL" });
    }
  }

  function retryLastAction() {
    if (state.retryTarget === "request_code") void requestCode(false);
    else if (state.retryTarget === "verify_code") void verifyCode();
    else if (state.retryTarget === "resolve") void resolveState();
    else if (state.retryTarget === "continue") void continueRecovery();
  }

  if (state.phase === "feature_unavailable") return null;
  if (state.phase === "closed") {
    return (
      <button className="button secondary" type="button" onClick={openPanel}>
        Восстановить доступ
      </button>
    );
  }

  const resendSeconds = state.resendAvailableAt
    ? Math.max(0, Math.ceil((state.resendAvailableAt - now) / 1000))
    : 0;
  const retrySeconds = state.retryAvailableAt
    ? Math.max(0, Math.ceil((state.retryAvailableAt - now) / 1000))
    : 0;
  const errorText = safeRecoveryErrorText(state.errorCode);
  const action = state.phase === "access_unstarted" ||
    state.phase === "attempt_active" || state.phase === "result_available"
    ? actionableCopy[state.phase]
    : null;
  const busy = state.phase === "requesting_code" || state.phase === "verifying_code" ||
    state.phase === "resolving" || state.phase === "continuing";

  return (
    <section className="subpanel stack compact recovery-panel" aria-labelledby="recovery-heading">
      <h3 className="subsection-title" id="recovery-heading" ref={headingRef} tabIndex={-1}>
        Восстановить доступ
      </h3>

      {errorText ? (
        <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>{errorText}</p>
      ) : null}

      <div aria-live="polite" className="stack compact">
        {state.phase === "enter_email" ? (
          <form className="form-stack" onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void requestCode(false);
          }}>
            <p className="muted">
              Введите email, который использовался при покупке. Мы отправим на него одноразовый код.
            </p>
            <label className="field">
              <span>Email для восстановления</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => changeEmail(event.target.value)}
                required
              />
            </label>
            <button className="button" type="submit">Получить код</button>
          </form>
        ) : null}

        {state.phase === "requesting_code" ? (
          <p className="form-message info">Запрашиваем одноразовый код…</p>
        ) : null}

        {state.phase === "code_sent" ? (
          <form className="form-stack" onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void verifyCode();
          }}>
            <p className="form-message info">
              Если этот email связан с доступом, на него отправлен одноразовый код.
            </p>
            {state.maskedEmail ? (
              <p className="muted recovery-masked">Адрес: {state.maskedEmail}</p>
            ) : null}
            <label className="field">
              <span>Код из письма</span>
              <input
                ref={otpInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                  event.target.value = digits;
                  if (otpValueRef.current !== digits) {
                    otpValueRef.current = digits;
                    verificationOperationRef.current = null;
                    dispatch({ type: "VERIFICATION_INPUT_CHANGED" });
                  }
                }}
              />
            </label>
            <button className="button" type="submit">Подтвердить код</button>
            <div className="inline-actions">
              <button
                className="button secondary"
                type="button"
                disabled={resendSeconds > 0}
                title={resendSeconds > 0 ? "Повторная отправка станет доступна после отсчёта." : undefined}
                onClick={() => void requestCode(true)}
              >
                {resendSeconds > 0
                  ? `Отправить код повторно через ${resendSeconds} сек.`
                  : "Отправить новый код"}
              </button>
              <button className="button secondary" type="button" onClick={() => changeEmail("")}>
                Изменить email
              </button>
            </div>
          </form>
        ) : null}

        {state.phase === "verifying_code" ? (
          <p className="form-message info">Проверяем код…</p>
        ) : null}
        {state.phase === "resolving" ? (
          <p className="form-message info">Проверяем состояние доступа…</p>
        ) : null}

        {action ? (
          <div className="stack compact">
            <p>{action.text}</p>
            <button className="button" type="button" onClick={() => void continueRecovery()}>
              {action.action}
            </button>
          </div>
        ) : null}

        {state.phase === "continuing" ? (
          <p className="form-message info">Открываем защищённый переход…</p>
        ) : null}

        {state.phase === "start_window_expired" ? (
          <p>Срок начала попытки истёк. Обратитесь в поддержку, чтобы проверить доступ.</p>
        ) : null}

        {state.phase === "no_access" ? (
          <div className="stack compact">
            <p>Для этого email оплаченный доступ не найден.</p>
            <a className="text-link" href="#commercial-checkout">Вернуться к оплате</a>
          </div>
        ) : null}

        {state.phase === "support_required" ? (
          <div className="stack compact">
            <p>Не удалось безопасно определить состояние доступа. Обратитесь в поддержку.</p>
            <a className="text-link recovery-masked" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          </div>
        ) : null}

        {state.phase === "temporary_error" ? (
          <button
            className="button"
            type="button"
            disabled={retrySeconds > 0}
            title={retrySeconds > 0 ? "Повтор станет доступен после отсчёта." : undefined}
            onClick={retryLastAction}
          >
            {retrySeconds > 0 ? `Повторить через ${retrySeconds} сек.` : "Повторить"}
          </button>
        ) : null}
      </div>

      <button
        className="button secondary"
        type="button"
        disabled={busy}
        title={busy ? "Дождитесь завершения текущего запроса." : undefined}
        onClick={() => void cancelRecovery()}
      >
        Отменить восстановление
      </button>
    </section>
  );
}
