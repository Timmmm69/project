import { createHash, timingSafeEqual } from "node:crypto";
import { redactProviderPayload } from "@/lib/commercial/security";
import type { CheckoutSession, CommercialPaymentProviderAdapter, ProviderNotification } from "@/lib/commercial/providers/types";

type WebPayConfig = {
  storeId: string;
  secretKey: string;
  checkoutUrl: string;
  statusUrl: string;
  storeName: string;
};

function config(): WebPayConfig {
  return {
    storeId: process.env.WEBPAY_SANDBOX_STORE_ID?.trim() ?? "",
    secretKey: process.env.WEBPAY_SANDBOX_SECRET_KEY?.trim() ?? "",
    checkoutUrl: process.env.WEBPAY_SANDBOX_CHECKOUT_URL?.trim() ?? "",
    statusUrl: process.env.WEBPAY_SANDBOX_STATUS_URL?.trim() ?? "",
    storeName: process.env.WEBPAY_SANDBOX_STORE_NAME?.trim() ?? "Тренировочные тесты"
  };
}

function requireConfig(value: WebPayConfig) {
  if (!value.storeId || !value.secretKey || !value.checkoutUrl) {
    throw new Error("WEBPAY_SANDBOX_CONFIGURATION_MISSING");
  }
}

function amount(value: number) {
  return (value / 100).toFixed(2);
}

function signature(parts: string[], secretKey: string) {
  return createHash("md5").update([...parts, secretKey].join(""), "utf8").digest("hex");
}

function secureSignatureMatch(received: string | undefined, expected: string) {
  if (!received) {
    return false;
  }
  const left = Buffer.from(received.toLowerCase());
  const right = Buffer.from(expected.toLowerCase());
  return left.length === right.length && timingSafeEqual(left, right);
}

function toStatus(value: string | undefined): ProviderNotification["status"] {
  if (value === "1" || value?.toLowerCase() === "paid") return "paid";
  if (value === "2" || value?.toLowerCase() === "failed") return "failed";
  if (value === "3" || value?.toLowerCase() === "cancelled") return "cancelled";
  if (value?.toLowerCase() === "expired") return "expired";
  return "pending";
}

// WEBPAY's sandbox form uses the documented v2 wsb_* fields. Credentials and
// the final status endpoint are deliberately environment-only and never bundled.
export class WebPaySandboxProvider implements CommercialPaymentProviderAdapter {
  readonly provider = "WEBPAY_SANDBOX" as const;

  async createCheckout(input: Parameters<CommercialPaymentProviderAdapter["createCheckout"]>[0]): Promise<CheckoutSession> {
    const value = config();
    requireConfig(value);
    const seed = String(Date.now());
    const total = amount(input.amountMinor);
    const signatureValue = signature([seed, value.storeId, input.merchantReference, "1", input.currency, total], value.secretKey);

    return {
      actionUrl: value.checkoutUrl,
      method: "POST",
      fields: {
        "*scart": "",
        wsb_version: "2",
        wsb_language_id: "russian",
        wsb_storeid: value.storeId,
        wsb_store: value.storeName,
        wsb_order_num: input.merchantReference,
        wsb_test: "1",
        wsb_currency_id: input.currency,
        wsb_seed: seed,
        wsb_total: total,
        wsb_invoice_item_name: input.productName,
        wsb_invoice_item_quantity: "1",
        wsb_invoice_item_price: total,
        wsb_return_url: input.returnUrl,
        wsb_cancel_return_url: input.cancelUrl,
        wsb_notify_url: input.notificationUrl,
        wsb_signature: signatureValue
      },
      expiresAt: null
    };
  }

  async verifyNotification(rawBody: string): Promise<ProviderNotification> {
    const value = config();
    const fields = Object.fromEntries(new URLSearchParams(rawBody).entries());
    const total = fields.wsb_total ?? "";
    const expected = value.secretKey
      ? signature([fields.wsb_seed ?? "", value.storeId, fields.wsb_order_num ?? "", fields.wsb_test ?? "1", fields.wsb_currency_id ?? "", total], value.secretKey)
      : "";
    const parsedTotal = Number(total);

    return {
      merchantReference: fields.wsb_order_num ?? "",
      providerPaymentId: fields.wsb_transaction_id ?? fields.wsb_transaction_num ?? null,
      providerEventKey: fields.wsb_transaction_id ?? fields.wsb_transaction_num ?? null,
      status: toStatus(fields.wsb_result_code ?? fields.wsb_status),
      amountMinor: Number.isFinite(parsedTotal) ? Math.round(parsedTotal * 100) : -1,
      currency: fields.wsb_currency_id ?? "",
      signatureValid: fields.wsb_storeid === value.storeId && secureSignatureMatch(fields.wsb_signature, expected),
      eventType: "webpay_notification",
      redactedPayload: redactProviderPayload(fields)
    };
  }

  async fetchPaymentStatus(input: { merchantReference: string; providerPaymentId: string | null }): Promise<ProviderNotification> {
    const value = config();
    requireConfig(value);
    if (!value.statusUrl) {
      throw new Error("WEBPAY_SANDBOX_STATUS_URL_MISSING");
    }
    const url = new URL(value.statusUrl);
    url.searchParams.set("wsb_order_num", input.merchantReference);
    if (input.providerPaymentId) url.searchParams.set("wsb_transaction_id", input.providerPaymentId);
    const response = await fetch(url, { headers: { Accept: "application/x-www-form-urlencoded, application/json" }, cache: "no-store" });
    if (!response.ok) {
      throw new Error("WEBPAY_SANDBOX_STATUS_FETCH_FAILED");
    }
    return this.verifyNotification(await response.text());
  }
}
