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

function hasKnownStatus(value: string | undefined) {
  return value === "1" || value === "2" || value === "3" || ["paid", "failed", "cancelled", "expired", "pending"].includes(value?.toLowerCase() ?? "");
}

function parseProviderFields(rawBody: string) {
  return Object.fromEntries(new URLSearchParams(rawBody).entries());
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
    const fields = parseProviderFields(rawBody);
    const total = fields.wsb_total ?? "";
    const expected = value.secretKey
      ? signature([fields.wsb_seed ?? "", value.storeId, fields.wsb_order_num ?? "", fields.wsb_test ?? "1", fields.wsb_currency_id ?? "", total], value.secretKey)
      : "";
    const parsedTotal = Number(total);

    return {
      merchantReference: fields.wsb_order_num ?? "",
      providerPaymentId: null,
      providerEventKey: null,
      status: "pending",
      amountMinor: Number.isFinite(parsedTotal) ? Math.round(parsedTotal * 100) : -1,
      currency: fields.wsb_currency_id ?? "",
      // A valid checkout signature proves only that these checkout fields were
      // issued by us. It does not authenticate an appended payment status.
      signatureValid: false,
      eventType: "webpay_callback_signal",
      redactedPayload: {
        ...redactProviderPayload(fields),
        checkout_fields_valid: String(fields.wsb_storeid === value.storeId && secureSignatureMatch(fields.wsb_signature, expected))
      }
    };
  }

  private verifyStatusResponse(rawBody: string, requestedMerchantReference: string): ProviderNotification {
    const fields = parseProviderFields(rawBody);
    const statusValue = fields.wsb_result_code ?? fields.wsb_status;
    const total = fields.wsb_total;
    const parsedTotal = total === undefined || total.trim() === "" ? Number.NaN : Number(total);
    const merchantReference = fields.wsb_order_num ?? "";
    const providerPaymentId = fields.wsb_transaction_id ?? fields.wsb_transaction_num ?? null;
    const completeAuthoritativeResponse =
      merchantReference === requestedMerchantReference &&
      Number.isFinite(parsedTotal) &&
      Boolean(fields.wsb_currency_id) &&
      hasKnownStatus(statusValue) &&
      (toStatus(statusValue) !== "paid" || Boolean(providerPaymentId));

    return {
      merchantReference,
      providerPaymentId,
      providerEventKey: providerPaymentId,
      status: toStatus(statusValue),
      amountMinor: Number.isFinite(parsedTotal) ? Math.round(parsedTotal * 100) : -1,
      currency: fields.wsb_currency_id ?? "",
      // Trust comes from the configured HTTPS server-to-server status endpoint,
      // not from the checkout signature or callback fields.
      signatureValid: completeAuthoritativeResponse,
      eventType: "webpay_status_response",
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
    if (url.protocol !== "https:") {
      throw new Error("WEBPAY_SANDBOX_STATUS_URL_MUST_BE_HTTPS");
    }
    url.searchParams.set("wsb_order_num", input.merchantReference);
    if (input.providerPaymentId) url.searchParams.set("wsb_transaction_id", input.providerPaymentId);
    const response = await fetch(url, { headers: { Accept: "application/x-www-form-urlencoded, application/json" }, cache: "no-store" });
    if (!response.ok) {
      throw new Error("WEBPAY_SANDBOX_STATUS_FETCH_FAILED");
    }
    return this.verifyStatusResponse(await response.text(), input.merchantReference);
  }
}
