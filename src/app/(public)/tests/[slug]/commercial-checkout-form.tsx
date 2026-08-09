"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type LegalLinks = {
  version: string;
  offerUrl: string;
  privacyUrl: string;
  refundPolicyUrl: string;
  disclaimerUrl: string;
  supportEmail: string;
  supportTelegram: string;
};

type OrderState = {
  publicId: string;
  orderReference: string;
  category: "payment_pending" | "payment_paid" | "payment_failed" | "payment_cancelled" | "payment_expired" | "payment_status_unknown" | "paid_without_access";
  timestamps: {
    createdAt: string;
    updatedAt: string;
    paymentUpdatedAt: string | null;
    paidAt: string | null;
  };
  cooldown: {
    refreshAfterSeconds: number | null;
    supportAvailableAt: string | null;
  };
  allowedActions: Array<"create_payment_session" | "refresh_status" | "retry_payment" | "continue_access" | "contact_support">;
};

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string; details?: { nextAction?: string } } };

type RecoveryChallengeResponse = { challenge: { operationId: string; emailMasked: string; tokenTtlMs: number } };
type RecoveryVerifyResponse = { session: { id: string; operationId: string; emailMasked: string; expiresAt: string } };

type CheckoutPhase = "idle" | "creating_order" | "creating_session" | "redirecting" | "fallback" | "session_error";

function newKey() {
  return crypto.randomUUID();
}

export function CommercialCheckoutForm({ legal, testId, productCode, priceMinor, currency, verifiedPreAuthorized }: {
  legal: LegalLinks;
  testId: string;
  productCode: string;
  priceMinor: number;
  currency: string;
  verifiedPreAuthorized: boolean;
}) {
  const query = useSearchParams();
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailMasked, setEmailMasked] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [verifyOperationId, setVerifyOperationId] = useState<string | null>(null);
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderState | null>(null);
  const [existingAccess, setExistingAccess] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<CheckoutPhase>("idle");
  const orderKey = useRef<string | null>(null);
  const checkoutFlowId = useRef<string | null>(null);
  const paymentKey = useRef<string | null>(null);
  const challengeKey = useRef<string | null>(null);
  const paymentFormRef = useRef<{ action: string; fields: Record<string, string> } | null>(null);
  const redirectingOrderId = useRef<string | null>(null);

  const price = `${(priceMinor / 100).toFixed(2)} ${currency}`;
  const paid = order?.category === "payment_paid";
  const canPay = order?.allowedActions.includes("create_payment_session") || order?.allowedActions.includes("retry_payment");
  const canRefresh = order?.allowedActions.includes("refresh_status");

  function resetRedirectState() {
    setCheckoutPhase("idle");
    redirectingOrderId.current = null;
    paymentFormRef.current = null;
  }

  async function loadStatus(publicId: string) {
    const response = await fetch(`/api/commercial/orders/${publicId}/status`, { cache: "no-store" });
    const body = await response.json() as ApiResponse<Omit<OrderState, "publicId">>;
    if (!body.success) {
      setMessage("Не удалось восстановить заказ в этой сессии.");
      return;
    }
    if (body.data.orderReference !== publicId) {
      setMessage("Не удалось восстановить заказ в этой сессии.");
      return;
    }
    const restored = { publicId, ...body.data };
    setOrder(restored);
    setEmailVerified(true);
    if (restored.category === "payment_paid") setMessage("Оплата подтверждена. Доступ к одной попытке готов.");
    else if (restored.category === "payment_status_unknown") setMessage("Статус оплаты пока неизвестен. Повторно оплачивать не нужно.");
    else if (restored.category === "paid_without_access") setMessage("Оплата подтверждена. Доступ оформляется.");
    else if (restored.category === "payment_pending") setMessage("Платёж обрабатывается. Повторно оплачивать не нужно.");
  }

  useEffect(() => {
    const publicId = query.get("commercialOrder");
    if (publicId) void loadStatus(publicId);
  }, [query]);

  async function requestOtp() {
    setBusy(true);
    setMessage(null);
    challengeKey.current ??= newKey();
    try {
      const response = await fetch("/api/recovery/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, productCode, intent: "recovery", idempotencyKey: challengeKey.current })
      });
      const body = await response.json() as ApiResponse<RecoveryChallengeResponse>;
      setBusy(false);
      if (!body.success) {
        setMessage(body.error.message);
        return;
      }
      setOtpSent(true);
      setVerifyOperationId(body.data.challenge.operationId);
      setEmailMasked(body.data.challenge.emailMasked);
      setMessage("Код подтверждения отправлен на указанный email.");
    } catch {
      setBusy(false);
      setMessage("Не удалось отправить код. Проверьте соединение.");
    }
  }

  async function verifyOtp() {
    if (!verifyOperationId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/recovery/challenges/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otp, operationId: verifyOperationId })
      });
      const body = await response.json() as ApiResponse<RecoveryVerifyResponse>;
      setBusy(false);
      if (!body.success) {
        setMessage(body.error.message);
        return;
      }
      if (body.data.session) {
        setEmailVerified(true);
        setEmailMasked(body.data.session.emailMasked);
        setMessage(null);
      } else {
        setMessage("Неверный код. Попробуйте ещё раз.");
      }
    } catch {
      setBusy(false);
      setMessage("Не удалось проверить код. Попробуйте ещё раз.");
    }
  }

  async function createCheckoutFlow() {
    if (checkoutFlowId.current) return checkoutFlowId.current;
    const response = await fetch("/api/commercial/checkout-flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productCode })
    });
    const body = await response.json() as ApiResponse<{ checkout_flow_id: string }>;
    if (!body.success) throw new Error(body.error.message);
    checkoutFlowId.current = body.data.checkout_flow_id;
    return checkoutFlowId.current;
  }

  async function handleCreateOrder() {
    setCheckoutPhase("creating_order");
    setBusy(true);
    setMessage(null);
    setExistingAccess(false);
    orderKey.current ??= newKey();

    try {
      const flowId = await createCheckoutFlow();
      const response = await fetch("/api/commercial/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": orderKey.current },
        body: JSON.stringify({
          productCode,
          checkout_flow_id: flowId,
          adultBuyerConfirmed: adult,
          legalBundleVersion: legal.version
        })
      });
      const body = await response.json() as ApiResponse<{ order: { publicId: string; status: string; idempotent?: boolean } }>;
      if (!body.success) {
        setCheckoutPhase("idle");
        setBusy(false);
        setExistingAccess(body.error.code === "EXISTING_ACCESS");
        if (body.error.code === "ORDER_ALREADY_PENDING") {
          setMessage("Для этого email уже есть ожидающий оплаты заказ.");
        } else {
          setMessage(body.error.message);
        }
        return;
      }
      const createdAt = new Date().toISOString();
      setOrder({
        publicId: body.data.order.publicId,
        orderReference: body.data.order.publicId,
        category: "payment_pending",
        timestamps: { createdAt, updatedAt: createdAt, paymentUpdatedAt: null, paidAt: null },
        cooldown: { refreshAfterSeconds: 10, supportAvailableAt: null },
        allowedActions: ["create_payment_session"]
      });
      redirectingOrderId.current = body.data.order.publicId;
      await handleCreateSession(body.data.order.publicId);
    } catch {
      setCheckoutPhase("idle");
      setBusy(false);
      setMessage("Не удалось создать заказ. Оплата не начиналась.");
    }
  }

  async function handleCreateSession(publicId: string) {
    setCheckoutPhase("creating_session");
    setMessage(null);
    paymentKey.current ??= newKey();
    try {
      const response = await fetch(`/api/commercial/orders/${publicId}/payment-session`, {
        method: "POST",
        headers: { "Idempotency-Key": paymentKey.current }
      });
      const body = await response.json() as ApiResponse<{ paymentSession: { actionUrl: string; method: "POST"; fields: Record<string, string> } }>;
      if (!body.success) {
        setCheckoutPhase("session_error");
        setBusy(false);
        setMessage(null);
        return;
      }
      paymentFormRef.current = { action: body.data.paymentSession.actionUrl, fields: body.data.paymentSession.fields };
      setCheckoutPhase("redirecting");
      const form = document.createElement("form");
      form.method = body.data.paymentSession.method;
      form.action = body.data.paymentSession.actionUrl;
      for (const [name, value] of Object.entries(body.data.paymentSession.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
      setTimeout(() => {
        if (document.body.contains(form)) {
          form.remove();
          setCheckoutPhase("fallback");
          setBusy(false);
        }
      }, 10_000);
    } catch {
      setCheckoutPhase("session_error");
      setBusy(false);
    }
  }

  async function handleRetryPayment() {
    if (!order) return;
    await handleCreateSession(order.publicId);
  }

  async function handleFallbackPayment() {
    if (paymentFormRef.current) {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = paymentFormRef.current.action;
      for (const [name, value] of Object.entries(paymentFormRef.current.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
    }
  }

  async function handleRetryAfterSessionError() {
    if (!order) return;
    setMessage(null);
    const response = await fetch(`/api/commercial/orders/${order.publicId}/refresh-status`, { method: "POST" });
    const body = await response.json() as ApiResponse<Omit<OrderState, "publicId">>;
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }
    const updated = { publicId: order.publicId, ...body.data };
    setOrder(updated);
    const canRetry = updated.allowedActions.includes("create_payment_session") ||
      updated.allowedActions.includes("retry_payment");
    if (canRetry) {
      await handleCreateSession(order.publicId);
    } else {
      setCheckoutPhase("idle");
      setBusy(false);
      setMessage("Перед повторной попыткой мы проверили состояние заказа. Создавать дубликат не нужно.");
    }
  }

  async function refreshStatus() {
    if (!order) return;
    setBusy(true);
    const response = await fetch(`/api/commercial/orders/${order.publicId}/refresh-status`, { method: "POST" });
    const body = await response.json() as ApiResponse<Omit<OrderState, "publicId">>;
    setBusy(false);
    if (!body.success) return setMessage(body.error.message);
    const updated = { publicId: order.publicId, ...body.data };
    setOrder(updated);
    setMessage(updated.category === "payment_paid" ? "Оплата подтверждена. Доступ к одной попытке готов." : "Статус заказа обновлён.");
  }

  async function claimAndContinue() {
    if (!order) return;
    setBusy(true);
    const response = await fetch(`/api/commercial/orders/${order.publicId}/claim-access`, { method: "POST" });
    const body = await response.json() as ApiResponse<{ nextAction: "START_TEST" | "RESUME_TEST" | "VIEW_RESULT"; nextUrl: string; testId: string }>;
    if (!body.success) {
      setBusy(false);
      setMessage(body.error.message);
      return;
    }
    if (body.data.nextAction === "START_TEST") {
      const start = await fetch(`/api/commercial/orders/${order.publicId}/start-attempt`, {
        method: "POST",
      });
      const startBody = await start.json() as ApiResponse<{ nextUrl: string }>;
      if (!startBody.success) {
        setBusy(false);
        setMessage(startBody.error.message);
        return;
      }
      window.location.assign(startBody.data.nextUrl);
      return;
    }
    window.location.assign(body.data.nextUrl);
  }

  async function continueExistingAccess() {
    setBusy(true);
    const response = await fetch("/api/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, testId })
    });
    const body = await response.json() as ApiResponse<{ attempt: { attemptId: string } }>;
    if (!body.success) {
      setBusy(false);
      setMessage(body.error.message);
      return;
    }
    window.location.assign(`/attempts/${body.data.attempt.attemptId}`);
  }

  async function startVerifiedAttempt() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testId })
    });
    const body = await response.json() as ApiResponse<{ attempt: { attemptId: string } }>;
    setBusy(false);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }
    window.location.assign(`/attempts/${body.data.attempt.attemptId}`);
  }

  function handleEmailKeyUp(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && email && !otpSent) {
      void requestOtp();
    }
  }

  function handleOtpKeyUp(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && otp.length === 6 && verifyOperationId) {
      void verifyOtp();
    }
  }

  if (verifiedPreAuthorized) {
    return (
      <section className="subpanel stack compact">
        {message ? <p className="form-message info">{message}</p> : null}
        <button className="button" type="button" disabled={busy} onClick={startVerifiedAttempt}>
          Начать или продолжить тест
        </button>
      </section>
    );
  }

  if (checkoutPhase === "creating_order") {
    return (
      <section className="subpanel">
        <div className="checkout-loader">
          <div className="spinner" />
          <p className="subsection-title">Создаём заказ…</p>
          <p className="muted">Фиксируем цену {price}, состав покупки и данные для перехода к оплате.</p>
        </div>
      </section>
    );
  }

  if (checkoutPhase === "creating_session") {
    return (
      <section className="subpanel">
        <div className="checkout-loader">
          <div className="spinner" />
          <p className="subsection-title">Открываем защищённую страницу WEBPAY…</p>
          <p className="muted">Вы будете перенаправлены на защищённую страницу WEBPAY. Номер карты, срок действия, CVV/CVC и данные 3-D Secure вводятся только на стороне WEBPAY. Наш сайт не получает реквизиты карты.</p>
        </div>
      </section>
    );
  }

  if (checkoutPhase === "redirecting") {
    return (
      <section className="subpanel">
        <div className="checkout-loader">
          <div className="spinner" />
          <p className="subsection-title">Переходим к оплате…</p>
          <p className="muted">Реквизиты карты нужно будет ввести на стороне WEBPAY.</p>
        </div>
      </section>
    );
  }

  if (checkoutPhase === "fallback") {
    return (
      <section className="subpanel">
        <div className="checkout-loader">
          <p className="subsection-title">Страница оплаты не открылась автоматически</p>
          <p className="muted">Заказ уже создан. Откройте подготовленную страницу оплаты вручную.</p>
          <button className="button" type="button" onClick={handleFallbackPayment}>
            Открыть страницу WEBPAY
          </button>
        </div>
      </section>
    );
  }

  if (checkoutPhase === "session_error") {
    return (
      <section className="subpanel stack compact">
        <div className="checkout-loader">
          <p className="subsection-title">Не удалось открыть страницу оплаты</p>
          <p className="muted">Заказ сохранён. Перед повторной попыткой мы проверим его состояние, чтобы не создать дубликат.</p>
          <button className="button" type="button" disabled={busy} onClick={handleRetryAfterSessionError}>
            {busy ? "Проверяем заказ…" : "Попробовать снова"}
          </button>
          <button className="button secondary" type="button" onClick={() => { resetRedirectState(); }}
            disabled={busy}>
            Вернуться к странице теста
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="subpanel stack compact">
      <div>
        <p className="eyebrow">Оформление покупки</p>
        <h3 className="subsection-title">Одна попытка тренировочного онлайн-теста по русскому языку</h3>
      </div>

      <section className="checkout-section panel stack compact">
        <div className="inline-actions">
          <p className="subsection-title">{price}</p>
          <span className="badge">Разовый платёж</span>
        </div>
        <p className="muted">Без подписки, автоматического продления и повторных списаний. Одна покупка — одна попытка.</p>
        <ul className="muted">
          <li>Начать попытку можно в течение 90 дней после подтверждения оплаты.</li>
          <li>После начала даётся 120 минут без паузы.</li>
          <li>После завершения показывается только первичный результат.</li>
          <li>Результат доступен 12 месяцев.</li>
        </ul>
      </section>

      {!emailVerified ? (
        <section className="checkout-section panel stack compact">
          <div>
            <p className="eyebrow">Подтверждение email</p>
            <p className="muted">Email используется для доступа, восстановления и открытия результата.</p>
          </div>
          {otpSent && emailMasked ? (
            <>
              <p className="muted">Код отправлен на <strong>{emailMasked}</strong></p>
              <label className="field">
                <span>Код подтверждения</span>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} onKeyUp={handleOtpKeyUp} placeholder="000000" />
              </label>
              <button className="button" type="button" disabled={busy || otp.length !== 6} onClick={verifyOtp}>
                {busy ? "Проверяем…" : "Подтвердить email"}
              </button>
              <button className="button secondary" type="button" disabled={busy} onClick={() => { setOtpSent(false); setOtp(""); setVerifyOperationId(null); setEmailMasked(null); setMessage(null); }}>
                Изменить email
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>Email для заказа</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyUp={handleEmailKeyUp} />
              </label>
              <button className="button" type="button" disabled={busy || !email} onClick={requestOtp}>
                {busy ? "Отправляем…" : "Подтвердить email"}
              </button>
            </>
          )}
        </section>
      ) : null}

      {emailVerified && !order && !existingAccess ? (
        <>
          <section className="checkout-section panel stack compact">
            <div>
              <p className="eyebrow">Способ оплаты</p>
              <p className="subsection-title">Банковская карта</p>
            </div>
            <p className="muted">Вы будете перенаправлены на защищённую страницу WEBPAY.</p>
            <p className="muted">Номер карты, срок действия, CVV/CVC и данные 3-D Secure вводятся только на стороне WEBPAY. Наш сайт не получает реквизиты карты.</p>
            {emailMasked ? <p className="muted">Подтверждённый email: <strong>{emailMasked}</strong></p> : null}
          </section>

          <section className="checkout-section panel stack compact">
            <p className="eyebrow">Подтверждение условий</p>
            <label className="checkbox-row">
              <input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />
              <span>Подтверждаю, что мне исполнилось 18 лет и указанный email находится под моим контролем.</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
              <span>Подтверждаю ознакомление с публичной офертой, условиями оплаты и возврата, а также политикой обработки персональных данных.</span>
            </label>
          </section>

          <section className="checkout-section panel stack compact">
            <p className="muted">
              <a className="text-link" href={legal.offerUrl} target="_blank" rel="noopener noreferrer">Публичная оферта</a>{" · "}
              <a className="text-link" href={legal.privacyUrl} target="_blank" rel="noopener noreferrer">Конфиденциальность</a>{" · "}
              <a className="text-link" href={legal.refundPolicyUrl} target="_blank" rel="noopener noreferrer">Условия возврата</a>{" · "}
              <a className="text-link" href={legal.disclaimerUrl} target="_blank" rel="noopener noreferrer">Дисклеймер</a>
            </p>
            <p className="muted">Поддержка: {legal.supportEmail}{legal.supportTelegram ? ` · Telegram: ${legal.supportTelegram}` : ""}</p>
          </section>
        </>
      ) : null}

      {message ? <p className={message.includes("отправлен") || message.includes("готов") || message.includes("обновлён") ? "form-message success" : "form-message info"}>{message}</p> : null}

      {emailVerified && !order ? (
        <button className="button" type="button" disabled={busy || !adult || !terms} onClick={handleCreateOrder}>
          {busy ? "Создаём заказ…" : "Перейти к оплате картой"}
        </button>
      ) : null}

      {existingAccess ? (
        <button className="button" type="button" disabled={busy} onClick={continueExistingAccess}>
          Продолжить тест
        </button>
      ) : null}

      {order && !paid ? (
        <div className="inline-actions">
          {canPay ? (
            <button className="button" type="button" disabled={busy} onClick={handleRetryPayment}>
              {busy ? "Открываем…" : "Попробовать оплатить снова"}
            </button>
          ) : null}
          {canRefresh ? (
            <button className="button secondary" type="button" disabled={busy} onClick={refreshStatus}>
              Обновить статус
            </button>
          ) : null}
        </div>
      ) : null}

      {paid ? (
        <button className="button" type="button" disabled={busy} onClick={claimAndContinue}>
          Перейти к началу теста
        </button>
      ) : null}
    </section>
  );
}
