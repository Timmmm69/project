import type { CommercialPaymentProvider } from "@prisma/client";

export type CommercialProviderStatus = "pending" | "paid" | "failed" | "cancelled" | "expired";

export type CheckoutSession = {
  actionUrl: string;
  method: "POST";
  fields: Record<string, string>;
  expiresAt: Date | null;
};

export type ProviderNotification = {
  merchantReference: string;
  providerPaymentId: string | null;
  providerEventKey: string | null;
  status: CommercialProviderStatus;
  amountMinor: number;
  currency: string;
  signatureValid: boolean;
  eventType: string;
  redactedPayload: Record<string, string>;
};

export interface CommercialPaymentProviderAdapter {
  readonly provider: CommercialPaymentProvider;
  createCheckout(input: {
    merchantReference: string;
    amountMinor: number;
    currency: string;
    productName: string;
    returnUrl: string;
    cancelUrl: string;
    notificationUrl: string;
    checkoutProxyUrl?: string;
  }): Promise<CheckoutSession>;
  verifyNotification(rawBody: string): Promise<ProviderNotification>;
  fetchPaymentStatus(input: { merchantReference: string; providerPaymentId: string | null }): Promise<ProviderNotification>;
}
