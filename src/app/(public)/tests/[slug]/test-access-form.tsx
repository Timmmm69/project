"use client";

import { FormEvent, useState } from "react";

type AccessStatus =
  | "can_start"
  | "continue_attempt"
  | "no_access"
  | "expired"
  | "revoked"
  | "no_attempts";

type AccessCheckResult = {
  hasAccess: boolean;
  status: AccessStatus;
  userId: string | null;
  access: {
    id: string;
    attemptsTotal: number;
    attemptsAvailable: number;
    expiresAt: string;
    revokedAt: string | null;
  } | null;
  attempt: {
    id: string;
    startedAt: string;
  } | null;
};

type PaymentSummary = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  accessId: string | null;
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

function statusText(result: AccessCheckResult | null) {
  if (!result) {
    return null;
  }

  const values: Record<AccessStatus, string> = {
    can_start: "Доступ найден. В следующем этапе здесь будет старт теста.",
    continue_attempt: "У вас уже есть начатая попытка. В следующем этапе здесь будет продолжение теста.",
    no_access: "Для этого email пока нет доступа к тесту.",
    expired: "Доступ для этого email истёк.",
    revoked: "Доступ для этого email был отозван.",
    no_attempts: "Доступ найден, но доступных попыток не осталось."
  };

  return values[result.status];
}

export function TestAccessForm({ testId }: { testId: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accessResult, setAccessResult] = useState<AccessCheckResult | null>(null);

  async function identifyEmail() {
    const response = await fetch("/api/students/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const identifyBody = await readJson<{ student: { id: string; email: string } }>(response);
    if (!identifyBody.success) {
      setMessage(identifyBody.error.message);
      return null;
    }

    const normalizedEmail = identifyBody.data.student.email;
    setEmail(normalizedEmail);
    return normalizedEmail;
  }

  async function checkAccessForEmail(normalizedEmail: string) {
    const accessResponse = await fetch("/api/access/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, testId })
    });
    const accessBody = await readJson<AccessCheckResult>(accessResponse);

    if (!accessBody.success) {
      setMessage(accessBody.error.message);
      return null;
    }

    setAccessResult(accessBody.data);
    return accessBody.data;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setPayment(null);
    setAccessResult(null);

    const normalizedEmail = await identifyEmail();
    if (normalizedEmail) {
      await checkAccessForEmail(normalizedEmail);
    }

    setBusy(false);
  }

  async function handleCreatePayment() {
    setBusy(true);
    setMessage(null);
    const normalizedEmail = await identifyEmail();
    if (!normalizedEmail) {
      setBusy(false);
      return;
    }

    const response = await fetch("/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, testId, provider: "mock" })
    });
    const body = await readJson<{ payment: PaymentSummary }>(response);
    setBusy(false);

    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setPayment(body.data.payment);
    setMessage("Тестовая оплата создана. Подтвердите её, чтобы открыть доступ.");
  }

  async function handleConfirmPayment() {
    if (!payment) {
      return;
    }

    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/payments/webhook/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: payment.id, status: "success" })
    });
    const body = await readJson<{ payment: PaymentSummary; createdAccess: boolean }>(response);
    if (!body.success) {
      setBusy(false);
      setMessage(body.error.message);
      return;
    }

    setPayment(body.data.payment);
    await checkAccessForEmail(email);
    setBusy(false);
    setMessage(body.data.createdAccess ? "Доступ открыт." : "Оплата уже была подтверждена ранее.");
  }

  async function handleActivateCode() {
    setBusy(true);
    setMessage(null);
    const normalizedEmail = await identifyEmail();
    if (!normalizedEmail) {
      setBusy(false);
      return;
    }

    const response = await fetch("/api/access-codes/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, testId, code })
    });
    const body = await readJson<{ access: { id: string } }>(response);
    if (!body.success) {
      setBusy(false);
      setMessage(body.error.message);
      return;
    }

    setCode("");
    await checkAccessForEmail(normalizedEmail);
    setBusy(false);
    setMessage("Код активирован. Доступ открыт.");
  }

  async function handleStartAttempt() {
    setBusy(true);
    setMessage(null);
    const normalizedEmail = await identifyEmail();
    if (!normalizedEmail) {
      setBusy(false);
      return;
    }

    const response = await fetch("/api/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, testId })
    });
    const body = await readJson<{ attempt: { attemptId: string }; restored: boolean }>(response);
    setBusy(false);

    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    window.location.href = `/attempts/${body.data.attempt.attemptId}`;
  }

  const text = statusText(accessResult);
  const showAccessActions = accessResult && !accessResult.hasAccess;

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label className="field">
        <span>Email для доступа</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          placeholder="student@example.com"
          required
        />
      </label>
      <button className="button" type="submit" disabled={busy}>
        Проверить доступ
      </button>
      {message ? <p className="form-error">{message}</p> : null}
      {text ? (
        <div className={accessResult?.hasAccess ? "state-box success" : "state-box"}>
          <p>{text}</p>
          {accessResult?.access ? (
            <p className="muted">
              Попыток доступно: {accessResult.access.attemptsAvailable} из {accessResult.access.attemptsTotal}.
            </p>
          ) : null}
          {accessResult?.status === "can_start" ? (
            <button className="button" type="button" disabled={busy} onClick={handleStartAttempt}>
              Начать тест
            </button>
          ) : null}
          {accessResult?.status === "continue_attempt" && accessResult.attempt ? (
            <a className="button" href={`/attempts/${accessResult.attempt.id}`}>
              Продолжить тест
            </a>
          ) : null}
        </div>
      ) : null}
      {showAccessActions ? (
        <div className="state-box">
          <div className="inline-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={handleCreatePayment}>
              Создать тестовую оплату
            </button>
            {payment?.status === "pending" ? (
              <button className="button" type="button" disabled={busy} onClick={handleConfirmPayment}>
                Подтвердить тестовую оплату
              </button>
            ) : null}
          </div>
          {payment ? (
            <p className="muted">
              Оплата: {payment.status}, сумма {(payment.amount / 100).toFixed(2)} {payment.currency}.
            </p>
          ) : null}
          <label className="field">
            <span>Код доступа</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
            />
          </label>
          <button className="button secondary" type="button" disabled={busy || !code} onClick={handleActivateCode}>
            Активировать код
          </button>
        </div>
      ) : null}
    </form>
  );
}
