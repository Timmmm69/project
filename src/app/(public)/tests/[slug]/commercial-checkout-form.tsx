"use client";

import { useState } from "react";

type LegalLinks = {
  version: string;
  offerUrl: string;
  privacyUrl: string;
  refundPolicyUrl: string;
  disclaimerUrl: string;
  supportEmail: string;
  supportTelegram: string;
};

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string; details?: { nextAction?: string } } };

function idempotencyKey() {
  return crypto.randomUUID();
}

export function CommercialCheckoutForm({ legal }: { legal: LegalLinks }) {
  const [email, setEmail] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<{ publicId: string; status: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function createOrder() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/commercial/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify({ productCode: "russian-training-variant-01", email, adultBuyerConfirmed: adult, legalBundleVersion: legal.version })
    });
    const body = (await response.json()) as ApiResponse<{ order: { publicId: string; status: string } }>;
    setBusy(false);
    if (!body.success) {
      setMessage(body.error.code === "EXISTING_ACCESS" ? "Доступ уже открыт. Ниже можно проверить доступ и начать тест." : body.error.message);
      return;
    }
    setOrder(body.data.order);
    setMessage("Заказ создан. Перейдите к тестовой оплате.");
  }

  async function beginPayment() {
    if (!order) return;
    setBusy(true);
    const response = await fetch(`/api/commercial/orders/${order.publicId}/payment-session`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() }
    });
    const body = (await response.json()) as ApiResponse<{ paymentSession: { actionUrl: string; method: "POST"; fields: Record<string, string> } }>;
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
    const body = (await response.json()) as ApiResponse<{ orderStatus: string; accessStatus: string }>;
    setBusy(false);
    if (!body.success) return setMessage(body.error.message);
    if (body.data.accessStatus === "granted") return setMessage("Оплата подтверждена. Доступ активирован.");
    setMessage(body.data.orderStatus === "pending" ? "Платёж обрабатывается. Повторно оплачивать не нужно." : `Статус заказа: ${body.data.orderStatus}.`);
  }

  return (
    <section className="subpanel stack compact">
      <div>
        <h3 className="subsection-title">Тестовая оплата</h3>
        <p className="muted">Одна услуга прохождения одного интерактивного тренировочного онлайн-теста.</p>
      </div>
      <p className="form-message info">Тестовый платёж. Реальные деньги не списываются.</p>
      <ul className="muted">
        <li>10 BYN, одна попытка.</li>
        <li>Начать тест можно в течение 90 дней.</li>
        <li>После начала: 120 минут без паузы.</li>
        <li>Показывается первичный результат. Полный возврат доступен до старта.</li>
      </ul>
      <label className="field">
        <span>Email для заказа</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />
        <span>Подтверждаю, что я совершеннолетний покупатель.</span>
      </label>
      <p className="muted">
        <a className="text-link" href={legal.offerUrl} target="_blank">Оферта</a>{" · "}
        <a className="text-link" href={legal.privacyUrl} target="_blank">Конфиденциальность</a>{" · "}
        <a className="text-link" href={legal.refundPolicyUrl} target="_blank">Возврат</a>{" · "}
        <a className="text-link" href={legal.disclaimerUrl} target="_blank">Дисклеймер</a>
      </p>
      <p className="muted">Поддержка: {legal.supportEmail}{legal.supportTelegram ? ` · Telegram: ${legal.supportTelegram}` : ""}</p>
      {message ? <p className="form-message info">{message}</p> : null}
      {!order ? <button className="button" type="button" disabled={busy || !email || !adult} onClick={createOrder}>Перейти к оплате 10 BYN</button> : <div className="inline-actions"><button className="button" type="button" disabled={busy} onClick={beginPayment}>Открыть тестовую оплату</button><button className="button secondary" type="button" disabled={busy} onClick={refreshStatus}>Проверить статус</button></div>}
    </section>
  );
}
