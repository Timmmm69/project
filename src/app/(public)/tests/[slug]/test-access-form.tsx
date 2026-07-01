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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accessResult, setAccessResult] = useState<AccessCheckResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setAccessResult(null);

    const identifyResponse = await fetch("/api/students/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const identifyBody = await readJson<{ student: { id: string; email: string } }>(identifyResponse);
    if (!identifyBody.success) {
      setBusy(false);
      setMessage(identifyBody.error.message);
      return;
    }

    const normalizedEmail = identifyBody.data.student.email;
    const accessResponse = await fetch("/api/access/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, testId })
    });
    const accessBody = await readJson<AccessCheckResult>(accessResponse);
    setBusy(false);

    if (!accessBody.success) {
      setMessage(accessBody.error.message);
      return;
    }

    setEmail(normalizedEmail);
    setAccessResult(accessBody.data);
  }

  const text = statusText(accessResult);

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
        </div>
      ) : null}
    </form>
  );
}
