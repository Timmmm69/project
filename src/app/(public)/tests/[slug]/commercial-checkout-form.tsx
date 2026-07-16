"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RecoveryAccessPanel } from "./recovery-access-panel";

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
  orderStatus: string;
  paymentStatus: string | null;
  accessStatus: "granted" | "none";
  nextAction: "OPEN_PRE" | "RESUME_TEST" | "VIEW_RESULT" | "WAIT_FOR_PAYMENT" | "NONE";
  nextUrl: string | null;
};

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string; details?: { nextAction?: string } } };

function newKey() {
  return crypto.randomUUID();
}

function isSafeVerifiedDestination(value: string) {
  return /^\/(?:attempts|results)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function CommercialCheckoutForm({ legal, testId, priceMinor, currency, verifiedPreAuthorized, recovery }: {
  legal: LegalLinks;
  testId: string;
  priceMinor: number;
  currency: string;
  verifiedPreAuthorized: boolean;
  recovery: Readonly<{ productCode: string; supportEmail: string }> | null;
}) {
  const query = useSearchParams();
  const [email, setEmail] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<OrderState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [existingAccess, setExistingAccess] = useState(false);
  const orderKey = useRef<string | null>(null);
  const checkoutFlowId = useRef<string | null>(null);
  const paymentKey = useRef<string | null>(null);
  const claimKey = useRef<string | null>(null);

  async function loadStatus(publicId: string) {
    const response = await fetch(`/api/commercial/orders/${publicId}/status`, { cache: "no-store" });
    const body = await response.json() as ApiResponse<Omit<OrderState, "publicId">>;
    if (!body.success) {
      setMessage("Не удалось восстановить заказ в этой сессии.");
      return;
    }
    const restored = { publicId, ...body.data };
    setOrder(restored);
    if (restored.accessStatus === "granted") setMessage("Оплата подтверждена. Доступ активирован.");
    else if (restored.orderStatus === "pending") setMessage("Платеж обрабатывается. Повторно оплачивать не нужно.");
  }

  useEffect(() => {
    const publicId = query.get("commercialOrder");
    if (publicId) void loadStatus(publicId);
  }, [query]);

  async function createOrder() {
    setBusy(true);
    setMessage(null);
    setExistingAccess(false);
    orderKey.current ??= newKey();
    if (!checkoutFlowId.current) {
      const flowResponse = await fetch("/api/commercial/checkout-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productCode: "russian-training-variant-01" })
      });
      const flowBody = await flowResponse.json() as ApiResponse<{ checkout_flow_id: string }>;
      if (!flowBody.success) {
        setBusy(false);
        setMessage(flowBody.error.message);
        return;
      }
      checkoutFlowId.current = flowBody.data.checkout_flow_id;
    }
    const response = await fetch("/api/commercial/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": orderKey.current },
      body: JSON.stringify({
        productCode: "russian-training-variant-01",
        checkout_flow_id: checkoutFlowId.current,
        email,
        adultBuyerConfirmed: adult,
        legalBundleVersion: legal.version
      })
    });
    const body = await response.json() as ApiResponse<{ order: { publicId: string; status: string } }>;
    setBusy(false);
    if (!body.success) {
      setExistingAccess(body.error.code === "EXISTING_ACCESS");
      setMessage(body.error.code === "ORDER_ALREADY_PENDING" ? "Для этого email уже есть ожидающий оплаты заказ." : body.error.message);
      return;
    }
    setOrder({
      publicId: body.data.order.publicId,
      orderStatus: body.data.order.status,
      paymentStatus: null,
      accessStatus: "none",
      nextAction: "WAIT_FOR_PAYMENT",
      nextUrl: null
    });
    setMessage("Заказ создан. Перейдите к тестовой оплате.");
  }

  async function beginPayment() {
    if (!order) return;
    setBusy(true);
    paymentKey.current ??= newKey();
    const response = await fetch(`/api/commercial/orders/${order.publicId}/payment-session`, {
      method: "POST",
      headers: { "Idempotency-Key": paymentKey.current }
    });
    const body = await response.json() as ApiResponse<{ paymentSession: { actionUrl: string; method: "POST"; fields: Record<string, string> } }>;
    setBusy(false);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }
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
    setMessage(updated.accessStatus === "granted" ? "Оплата подтверждена. Доступ активирован." : "Статус заказа обновлен.");
  }

  async function claimAndContinue() {
    if (!order) return;
    setBusy(true);
    claimKey.current ??= newKey();
    const response = await fetch(`/api/commercial/orders/${order.publicId}/claim-access`, {
      method: "POST",
      headers: { "Idempotency-Key": claimKey.current }
    });
    const body = await response.json() as ApiResponse<{ nextAction: OrderState["nextAction"]; nextUrl: string }>;
    if (!body.success) {
      setBusy(false);
      setMessage(body.error.message);
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
    const body = await response.json() as ApiResponse<{
      nextAction: "OPEN_ATTEMPT" | "OPEN_RESULT";
      nextUrl: string;
      attempt?: { attemptId: string };
      restored: boolean;
    }>;
    setBusy(false);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }
    if (!isSafeVerifiedDestination(body.data.nextUrl)) {
      setMessage("Не удалось восстановить заказ в этой сессии.");
      return;
    }
    window.location.assign(body.data.nextUrl);
  }

  const price = `${(priceMinor / 100).toFixed(2)} ${currency}`;
  const paid = order?.accessStatus === "granted";
  if (verifiedPreAuthorized) {
    return (
      <>
        <section className="subpanel stack compact" id="commercial-checkout">
          {message ? <p className="form-message info">{message}</p> : null}
          <button className="button" type="button" disabled={busy} onClick={startVerifiedAttempt}>
            Начать или продолжить тест
          </button>
        </section>
        {recovery ? <RecoveryAccessPanel {...recovery} /> : null}
      </>
    );
  }
  return (
    <>
      <section className="subpanel stack compact" id="commercial-checkout">
        <div>
          <h3 className="subsection-title">Тестовая оплата</h3>
          <p className="muted">Одна услуга прохождения одного тренировочного онлайн-теста.</p>
        </div>
        <p className="form-message info">Тестовый платеж. Реальные деньги не списываются.</p>
        <ul className="muted">
          <li>{price}, одна попытка.</li>
          <li>Начать тест можно в течение 90 дней.</li>
          <li>После начала: 120 минут без паузы.</li>
          <li>Показывается первичный результат. Полный возврат доступен до старта.</li>
        </ul>
        {!order ? <>
          <label className="field"><span>Email для заказа</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="checkbox-row"><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} /><span>Подтверждаю, что я совершеннолетний покупатель.</span></label>
        </> : null}
        <p className="muted">
          <a className="text-link" href={legal.offerUrl} target="_blank">Оферта</a>{" · "}
          <a className="text-link" href={legal.privacyUrl} target="_blank">Конфиденциальность</a>{" · "}
          <a className="text-link" href={legal.refundPolicyUrl} target="_blank">Возврат</a>{" · "}
          <a className="text-link" href={legal.disclaimerUrl} target="_blank">Дисклеймер</a>
        </p>
        <p className="muted">Поддержка: {legal.supportEmail}{legal.supportTelegram ? ` · Telegram: ${legal.supportTelegram}` : ""}</p>
        {message ? <p className="form-message info">{message}</p> : null}
        {!order ? <button className="button" type="button" disabled={busy || !email || !adult} onClick={createOrder}>Перейти к оплате {price}</button> : null}
        {existingAccess ? <button className="button" type="button" disabled={busy} onClick={continueExistingAccess}>Продолжить тест</button> : null}
        {order && !paid ? <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={beginPayment}>Открыть тестовую оплату</button><button className="button secondary" type="button" disabled={busy} onClick={refreshStatus}>Проверить статус</button></div> : null}
        {paid ? <button className="button" type="button" disabled={busy} onClick={claimAndContinue}>{order?.nextAction === "RESUME_TEST" ? "Продолжить тест" : order?.nextAction === "VIEW_RESULT" ? "Посмотреть результат" : "Перейти к началу"}</button> : null}
      </section>
      {recovery ? <RecoveryAccessPanel {...recovery} /> : null}
    </>
  );
}
