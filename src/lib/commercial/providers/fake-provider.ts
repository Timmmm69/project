import type { CheckoutSession, CommercialPaymentProviderAdapter, ProviderNotification } from "@/lib/commercial/providers/types";

export class LocalFakeCommercialProvider implements CommercialPaymentProviderAdapter {
  readonly provider = "LOCAL_FAKE" as const;

  async createCheckout(input: Parameters<CommercialPaymentProviderAdapter["createCheckout"]>[0]): Promise<CheckoutSession> {
    return {
      actionUrl: input.checkoutProxyUrl ?? "http://local-fake.invalid/checkout",
      method: "POST",
      fields: {
        merchant_reference: input.merchantReference,
        amount_minor: String(input.amountMinor),
        currency: input.currency,
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl
      },
      expiresAt: null
    };
  }

  async verifyNotification(rawBody: string): Promise<ProviderNotification> {
    const payload = JSON.parse(rawBody) as Record<string, string>;
    return {
      merchantReference: payload.merchant_reference ?? "",
      providerPaymentId: payload.payment_id ?? null,
      providerEventKey: payload.event_key ?? null,
      status: (payload.status as ProviderNotification["status"]) ?? "pending",
      amountMinor: Number(payload.amount_minor),
      currency: payload.currency ?? "BYN",
      signatureValid: payload.signature === "local-fake-valid",
      eventType: "fake_notification",
      redactedPayload: { status: payload.status ?? "", merchant_reference: payload.merchant_reference ?? "" }
    };
  }

  async fetchPaymentStatus(input: Parameters<CommercialPaymentProviderAdapter["fetchPaymentStatus"]>[0]): Promise<ProviderNotification> {
    return {
      merchantReference: input.merchantReference,
      providerPaymentId: input.providerPaymentId,
      providerEventKey: null,
      status: "pending",
      amountMinor: input.amountMinor ?? 0,
      currency: input.currency ?? "BYN",
      signatureValid: true,
      eventType: "fake_status",
      redactedPayload: { status: "pending" }
    };
  }
}
