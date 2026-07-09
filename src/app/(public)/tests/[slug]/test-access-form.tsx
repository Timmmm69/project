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
  provider: string;
  providerPaymentId: string | null;
  providerInvoiceId: string | null;
  providerAccountNumber: string | null;
  paymentUrl: string | null;
  qrCodeUrl: string | null;
  qrCodePayload: string | null;
  paymentInstructions: string | null;
  providerStatus: string | null;
  accessId: string | null;
  accessCreated: boolean;
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
type MessageTone = "error" | "info" | "success";

async function readJson<T>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

function statusText(result: AccessCheckResult | null) {
  if (!result) {
    return null;
  }

  const values: Record<AccessStatus, string> = {
    can_start: "Доступ найден. Можно начать тест.",
    continue_attempt: "У вас уже есть начатая попытка. Можно продолжить тест.",
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
  const [messageTone, setMessageTone] = useState<MessageTone>("info");
  const [accessResult, setAccessResult] = useState<AccessCheckResult | null>(null);

  function showMessage(text: string, tone: MessageTone) {
    setMessage(text);
    setMessageTone(tone);
  }

  function clearMessage() {
    setMessage(null);
    setMessageTone("info");
  }

  async function identifyEmail() {
    const response = await fetch("/api/students/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const identifyBody = await readJson<{ student: { id: string; email: string } }>(response);
    if (!identifyBody.success) {
      showMessage(identifyBody.error.message, "error");
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
      showMessage(accessBody.error.message, "error");
      return null;
    }

    setAccessResult(accessBody.data);
    return accessBody.data;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    clearMessage();
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
    clearMessage();
    const normalizedEmail = await identifyEmail();
    if (!normalizedEmail) {
      setBusy(false);
      return;
    }

    const response = await fetch("/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, testId })
    });
    const body = await readJson<{ payment: PaymentSummary }>(response);
    setBusy(false);

    if (!body.success) {
      showMessage(body.error.message, "error");
      return;
    }

    setPayment(body.data.payment);
    showMessage("Тестовая оплата создана. Подтвердите её, чтобы открыть доступ.", "info");
  }

  async function refreshPaymentStatus(paymentId: string) {
    const response = await fetch(`/api/payments/${paymentId}/status`);
    const body = await readJson<{ payment: PaymentSummary }>(response);
    if (!body.success) {
      showMessage(body.error.message, "error");
      return null;
    }

    setPayment(body.data.payment);
    return body.data.payment;
  }

  async function handleSimulatePayment(status: "success" | "failed") {
    if (!payment) {
      return;
    }

    setBusy(true);
    clearMessage();
    const response = await fetch(`/api/dev/payments/${payment.id}/simulate-${status}`, { method: "POST" });
    const body = await readJson<{ payment: PaymentSummary; createdAccess: boolean }>(response);
    if (!body.success) {
      setBusy(false);
      showMessage(body.error.message, "error");
      return;
    }

    setPayment(body.data.payment);
    await checkAccessForEmail(email);
    setBusy(false);
    if (status === "success") {
      showMessage(body.data.createdAccess ? "Доступ открыт." : "Оплата уже была подтверждена ранее.", "success");
    } else {
      showMessage("Тестовая оплата отмечена как failed. Access не создан.", "info");
    }
  }

  async function handleCheckPayment() {
    if (!payment) {
      return;
    }

    setBusy(true);
    clearMessage();
    const updated = await refreshPaymentStatus(payment.id);
    if (updated?.accessCreated) {
      await checkAccessForEmail(email);
      showMessage("Оплата подтверждена. Доступ открыт.", "success");
    } else if (updated) {
      showMessage(`Статус оплаты: ${updated.status}.`, "info");
    }
    setBusy(false);
  }

  async function handleActivateCode() {
    setBusy(true);
    clearMessage();
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
      showMessage(body.error.message, "error");
      return;
    }

    setCode("");
    await checkAccessForEmail(normalizedEmail);
    setBusy(false);
    showMessage("Код активирован. Доступ открыт.", "success");
  }

  async function handleStartAttempt() {
    setBusy(true);
    clearMessage();
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
      showMessage(body.error.message, "error");
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
      {message ? <p className={`form-message ${messageTone}`}>{message}</p> : null}
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
              <button className="button secondary" type="button" disabled={busy} onClick={handleCheckPayment}>
                Проверить оплату
              </button>
            ) : null}
            {payment?.provider === "mock" && payment.status === "pending" ? (
              <>
                <button className="button" type="button" disabled={busy} onClick={() => handleSimulatePayment("success")}>
                  Simulate success payment
                </button>
                <button className="button secondary" type="button" disabled={busy} onClick={() => handleSimulatePayment("failed")}>
                  Simulate failed payment
                </button>
              </>
            ) : null}
          </div>
          {payment ? (
            <div className="stack compact">
              <p className="muted">
                Оплата: {payment.status}, сумма {(payment.amount / 100).toFixed(2)} {payment.currency}.
              </p>
              <p className="muted">Provider: {payment.provider}{payment.providerStatus ? ` / ${payment.providerStatus}` : ""}</p>
              {payment.providerAccountNumber ? (
                <p className="muted">Account number: {payment.providerAccountNumber}</p>
              ) : null}
              {payment.paymentUrl ? (
                <a className="text-link" href={payment.paymentUrl} target="_blank">
                  Открыть страницу оплаты
                </a>
              ) : null}
              {payment.qrCodePayload ? <p className="muted">QR payload: {payment.qrCodePayload}</p> : null}
              {payment.paymentInstructions ? <p className="state-box">{payment.paymentInstructions}</p> : null}
            </div>
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
