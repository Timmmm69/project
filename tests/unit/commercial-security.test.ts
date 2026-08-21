import { afterEach, describe, expect, it, vi } from "vitest";
import { commercialCheckoutUnavailableReason } from "@/lib/commercial/config";
import { commercialNotificationMismatch, hasProviderPaymentIdConflict } from "@/lib/commercial/commercial-service";
import { LocalFakeCommercialProvider, WebPaySandboxProvider, commercialProviderForRuntime, isLocalFakeCommercialProviderEnabled } from "@/lib/commercial/providers";
import { createLookupToken, hashLookupToken, lookupTokenMatches, normalizeCommercialEmail } from "@/lib/commercial/security";
import { commercialOrderSchema } from "@/lib/commercial/schemas";
import {
  canOpenNewPaymentAttempt,
  canRetryTerminalOrder,
  canTransitionOrder,
  canTransitionOrderForNewPaymentAttempt,
  canTransitionPaymentAttempt,
  isActivePaymentAttempt,
  isTerminalPaymentAttempt
} from "@/lib/commercial/state-machine";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

function configureWebPayStatus() {
  process.env.WEBPAY_SANDBOX_STORE_ID = "store";
  process.env.WEBPAY_SANDBOX_SECRET_KEY = "secret";
  process.env.WEBPAY_SANDBOX_CHECKOUT_URL = "https://checkout.example.test";
  process.env.WEBPAY_SANDBOX_STATUS_URL = "https://status.example.test/payment";
}

function mockWebPayStatus(body: URLSearchParams) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body.toString(), {
    status: 200,
    headers: { "content-type": "application/x-www-form-urlencoded" }
  })));
}

describe("commercial checkout safeguards", () => {
  it("normalizes email and requires adult confirmation", () => {
    expect(normalizeCommercialEmail("  Student@Example.COM ")).toBe("student@example.com");
    expect(commercialOrderSchema.safeParse({ productCode: "russian-training-variant-01", email: "student@example.com", adultBuyerConfirmed: false, legalBundleVersion: "v1" }).success).toBe(false);
  });

  it("keeps checkout disabled without the full sandbox and legal configuration", () => {
    process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";
    process.env.PAYMENTS_MODE = "webpay_sandbox";
    expect(commercialCheckoutUnavailableReason()).toBe("COMMERCIAL_LEGAL_CONFIGURATION_MISSING");
  });

  it("keeps checkout disabled without the dedicated order token secret", () => {
    process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";
    process.env.PAYMENTS_MODE = "webpay_sandbox";
    process.env.LEGAL_BUNDLE_VERSION = "v1";
    process.env.OFFER_URL = "https://example.test/offer";
    process.env.PRIVACY_URL = "https://example.test/privacy";
    process.env.REFUND_POLICY_URL = "https://example.test/refund";
    process.env.DISCLAIMER_URL = "https://example.test/disclaimer";
    process.env.SUPPORT_EMAIL = "support@example.test";
    delete process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY;
    expect(commercialCheckoutUnavailableReason()).toBe("COMMERCIAL_ORDER_TOKEN_CONFIGURATION_MISSING");
  });

  it("keeps the local fake provider behind an explicit non-production test flag", () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "development";
    process.env.COMMERCIAL_FAKE_PROVIDER_TEST_ONLY = "true";
    expect(isLocalFakeCommercialProviderEnabled()).toBe(true);
    expect(commercialProviderForRuntime()).toBeInstanceOf(LocalFakeCommercialProvider);
    env.NODE_ENV = "production";
    expect(isLocalFakeCommercialProviderEnabled()).toBe(false);
  });

  it("uses opaque lookup tokens that only match their hash", () => {
    const token = createLookupToken();
    expect(lookupTokenMatches(token, hashLookupToken(token))).toBe(true);
    expect(lookupTokenMatches("other", hashLookupToken(token))).toBe(false);
  });

  it("enforces allowed state transitions and rejects PAID downgrade", () => {
    expect(canTransitionOrder("CREATED", "PENDING")).toBe(true);
    expect(canTransitionOrder("PENDING", "PAID")).toBe(true);
    expect(canTransitionOrder("PAID", "FAILED")).toBe(false);
    expect(canTransitionPaymentAttempt("PENDING", "PAID")).toBe(true);
    expect(canTransitionPaymentAttempt("PAID", "CANCELLED")).toBe(false);
    expect(canTransitionPaymentAttempt("FAILED", "PENDING")).toBe(false);
    expect(isActivePaymentAttempt("PENDING")).toBe(true);
    expect(isActivePaymentAttempt("FAILED")).toBe(false);
    expect(isTerminalPaymentAttempt("FAILED")).toBe(true);
    expect(canOpenNewPaymentAttempt("FAILED")).toBe(true);
    expect(canOpenNewPaymentAttempt("CANCELLED")).toBe(true);
    expect(canOpenNewPaymentAttempt("EXPIRED")).toBe(true);
    expect(canOpenNewPaymentAttempt("CREATED")).toBe(true);
    expect(canOpenNewPaymentAttempt("PENDING")).toBe(false);
    expect(canOpenNewPaymentAttempt("PAID")).toBe(false);
    expect(canRetryTerminalOrder("FAILED")).toBe(true);
    expect(canRetryTerminalOrder("CANCELLED")).toBe(true);
    expect(canRetryTerminalOrder("EXPIRED")).toBe(true);
    expect(canRetryTerminalOrder("CREATED")).toBe(false);
    expect(canRetryTerminalOrder("PENDING")).toBe(false);
    expect(canRetryTerminalOrder("PAID")).toBe(false);
    expect(canTransitionOrderForNewPaymentAttempt("FAILED")).toBe(true);
    expect(canTransitionOrderForNewPaymentAttempt("CANCELLED")).toBe(true);
    expect(canTransitionOrderForNewPaymentAttempt("EXPIRED")).toBe(true);
    expect(canTransitionOrderForNewPaymentAttempt("PENDING")).toBe(false);
    expect(canTransitionOrderForNewPaymentAttempt("PAID")).toBe(false);
    expect(canTransitionPaymentAttempt("PAID", "FAILED")).toBe(false);
    expect(canTransitionPaymentAttempt("PAID", "CANCELLED")).toBe(false);
    expect(hasProviderPaymentIdConflict({ currentStatus: "PAID", currentProviderPaymentId: "payment-1", nextStatus: "PAID", nextProviderPaymentId: "payment-1" })).toBe(false);
    expect(hasProviderPaymentIdConflict({ currentStatus: "PAID", currentProviderPaymentId: "payment-1", nextStatus: "PAID", nextProviderPaymentId: "payment-2" })).toBe(true);
  });

  it("verifies the deterministic fake provider without exposing an email", async () => {
    const provider = new LocalFakeCommercialProvider();
    const notification = await provider.verifyNotification(JSON.stringify({ merchant_reference: "ref-1", event_key: "event-1", status: "paid", amount_minor: "1000", currency: "BYN", signature: "local-fake-valid" }));
    expect(notification.signatureValid).toBe(true);
    expect(JSON.stringify(notification.redactedPayload)).not.toContain("email");
    expect(JSON.stringify(notification.redactedPayload)).not.toContain("signature");
    expect(JSON.stringify(notification.redactedPayload)).not.toContain("secret");
  });

  it("rejects an invalid WebPay sandbox signature", async () => {
    process.env.WEBPAY_SANDBOX_STORE_ID = "store";
    process.env.WEBPAY_SANDBOX_SECRET_KEY = "secret";
    const provider = new WebPaySandboxProvider();
    const notification = await provider.verifyNotification("wsb_seed=1&wsb_order_num=order&wsb_test=1&wsb_currency_id=BYN&wsb_total=10.00&wsb_result_code=1&wsb_signature=bad");
    expect(notification.signatureValid).toBe(false);
  });

  it("does not treat signed checkout fields with an appended paid status as payment proof", async () => {
    process.env.WEBPAY_SANDBOX_STORE_ID = "store";
    process.env.WEBPAY_SANDBOX_SECRET_KEY = "secret";
    process.env.WEBPAY_SANDBOX_CHECKOUT_URL = "https://sandbox.invalid";
    const provider = new WebPaySandboxProvider();
    const checkout = await provider.createCheckout({
      merchantReference: "order-1",
      amountMinor: 1000,
      currency: "BYN",
      productName: "Test",
      returnUrl: "https://example.test/return",
      cancelUrl: "https://example.test/cancel",
      notificationUrl: "https://example.test/notify"
    });
    const fields = checkout.fields;
    const notification = await provider.verifyNotification(
      new URLSearchParams({
        wsb_seed: fields.wsb_seed,
        wsb_storeid: fields.wsb_storeid,
        wsb_order_num: fields.wsb_order_num,
        wsb_test: fields.wsb_test,
        wsb_currency_id: fields.wsb_currency_id,
        wsb_total: fields.wsb_total,
        wsb_signature: fields.wsb_signature,
        wsb_result_code: "1",
        wsb_transaction_id: "transaction-1"
      }).toString()
    );
    expect(notification.redactedPayload.checkout_fields_valid).toBe("true");
    expect(notification.signatureValid).toBe(false);
    expect(notification.status).toBe("pending");
    expect(notification.providerPaymentId).toBeNull();
    expect(notification.amountMinor).toBe(1000);
  });

  it("accepts a complete server-to-server paid status for the requested merchant reference", async () => {
    configureWebPayStatus();
    mockWebPayStatus(new URLSearchParams({
      wsb_order_num: "order-1",
      wsb_result_code: "1",
      wsb_transaction_id: "transaction-1",
      wsb_total: "10.00",
      wsb_currency_id: "BYN"
    }));
    const notification = await new WebPaySandboxProvider().fetchPaymentStatus({ merchantReference: "order-1", providerPaymentId: null });
    expect(notification).toMatchObject({
      merchantReference: "order-1",
      providerPaymentId: "transaction-1",
      status: "paid",
      amountMinor: 1000,
      currency: "BYN",
      signatureValid: true
    });
  });

  it.each([
    ["missing amount", { wsb_currency_id: "BYN" }, false, "AMOUNT_MISMATCH"],
    ["missing currency", { wsb_total: "10.00" }, false, "CURRENCY_MISMATCH"],
    ["different amount", { wsb_total: "9.99", wsb_currency_id: "BYN" }, true, "AMOUNT_MISMATCH"],
    ["different currency", { wsb_total: "10.00", wsb_currency_id: "USD" }, true, "CURRENCY_MISMATCH"]
  ])("rejects an authoritative status with %s", async (_name, fields, signatureValid, expectedMismatch) => {
    configureWebPayStatus();
    mockWebPayStatus(new URLSearchParams({
      wsb_order_num: "order-1",
      wsb_result_code: "1",
      wsb_transaction_id: "transaction-1",
      ...fields
    }));
    const provider = new WebPaySandboxProvider();
    const notification = await provider.fetchPaymentStatus({ merchantReference: "order-1", providerPaymentId: null });
    expect(notification.signatureValid).toBe(signatureValid);
    expect(commercialNotificationMismatch({
      expectedProvider: "WEBPAY_SANDBOX",
      expectedMerchantReference: "order-1",
      expectedAmountMinor: 1000,
      expectedCurrency: "BYN",
      provider: provider.provider,
      notification
    })).toBe(expectedMismatch);
  });

  it("rejects a status response for a different merchant reference", async () => {
    configureWebPayStatus();
    mockWebPayStatus(new URLSearchParams({
      wsb_order_num: "other-order",
      wsb_result_code: "1",
      wsb_transaction_id: "transaction-1",
      wsb_total: "10.00",
      wsb_currency_id: "BYN"
    }));
    const notification = await new WebPaySandboxProvider().fetchPaymentStatus({ merchantReference: "order-1", providerPaymentId: null });
    expect(notification.signatureValid).toBe(false);
    expect(notification.merchantReference).toBe("other-order");
  });

  it("rejects a notification from a provider different from the payment attempt", () => {
    const notification = {
      merchantReference: "order-1",
      providerPaymentId: "transaction-1",
      providerEventKey: "transaction-1",
      status: "paid" as const,
      amountMinor: 1000,
      currency: "BYN",
      signatureValid: true,
      eventType: "webpay_status_response",
      redactedPayload: {}
    };
    expect(commercialNotificationMismatch({
      expectedProvider: "WEBPAY_SANDBOX",
      expectedMerchantReference: "order-1",
      expectedAmountMinor: 1000,
      expectedCurrency: "BYN",
      provider: "LOCAL_FAKE",
      notification
    })).toBe("PROVIDER_MISMATCH");
  });
});
