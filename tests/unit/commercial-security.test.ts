import { afterEach, describe, expect, it } from "vitest";
import { commercialCheckoutUnavailableReason } from "@/lib/commercial/config";
import { LocalFakeCommercialProvider, WebPaySandboxProvider, commercialProviderForRuntime, isLocalFakeCommercialProviderEnabled } from "@/lib/commercial/providers";
import { createLookupToken, hashLookupToken, lookupTokenMatches, normalizeCommercialEmail } from "@/lib/commercial/security";
import { commercialOrderSchema } from "@/lib/commercial/schemas";
import { canOpenNewPaymentAttempt, canTransitionOrder, canTransitionPaymentAttempt, isActivePaymentAttempt, isTerminalPaymentAttempt } from "@/lib/commercial/state-machine";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

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
    expect(canOpenNewPaymentAttempt("PAID")).toBe(false);
  });

  it("verifies the deterministic fake provider without exposing an email", async () => {
    const provider = new LocalFakeCommercialProvider();
    const notification = await provider.verifyNotification(JSON.stringify({ merchant_reference: "ref-1", event_key: "event-1", status: "paid", amount_minor: "1000", currency: "BYN", signature: "local-fake-valid" }));
    expect(notification.signatureValid).toBe(true);
    expect(JSON.stringify(notification.redactedPayload)).not.toContain("email");
  });

  it("rejects an invalid WebPay sandbox signature", async () => {
    process.env.WEBPAY_SANDBOX_STORE_ID = "store";
    process.env.WEBPAY_SANDBOX_SECRET_KEY = "secret";
    const provider = new WebPaySandboxProvider();
    const notification = await provider.verifyNotification("wsb_seed=1&wsb_order_num=order&wsb_test=1&wsb_currency_id=BYN&wsb_total=10.00&wsb_result_code=1&wsb_signature=bad");
    expect(notification.signatureValid).toBe(false);
  });

  it("verifies a signed WebPay sandbox paid notification", async () => {
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
    expect(notification.signatureValid).toBe(true);
    expect(notification.status).toBe("paid");
    expect(notification.amountMinor).toBe(1000);
  });
});
