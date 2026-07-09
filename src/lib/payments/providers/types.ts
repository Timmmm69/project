import type { PaymentProvider as PrismaPaymentProvider, PaymentStatus } from "@prisma/client";

export type InternalPaymentStatus = Lowercase<PaymentStatus>;

export type CreateProviderPaymentInput = {
  internalPaymentId: string;
  testTitle: string;
  amount: number;
  currency: string;
  studentEmail: string;
  returnUrl: string;
  failUrl: string;
  notificationUrl: string;
  description: string;
};

export type CreateProviderPaymentResult = {
  providerPaymentId: string;
  providerInvoiceId?: string | null;
  providerAccountNumber?: string | null;
  paymentUrl?: string | null;
  qrCodeUrl?: string | null;
  qrCodePayload?: string | null;
  paymentInstructions?: string | null;
  providerStatus?: string | null;
  rawPayload?: unknown;
};

export type ProviderWebhookResult = {
  providerPaymentId?: string | null;
  internalPaymentId?: string | null;
  providerStatus: string;
  status: InternalPaymentStatus | "unknown";
  rawPayload: unknown;
};

export interface PaymentProviderAdapter {
  readonly provider: PrismaPaymentProvider;
  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult>;
  getPaymentStatus(providerPaymentId: string): Promise<ProviderWebhookResult>;
  handleWebhook(payload: unknown, headers: Headers): Promise<ProviderWebhookResult>;
  verifyWebhookSignature(payload: unknown, headers: Headers): Promise<boolean>;
  mapProviderStatusToInternalStatus(providerStatus: string): InternalPaymentStatus | "unknown";
  cancelPayment?(providerPaymentId: string): Promise<ProviderWebhookResult>;
}

export class PaymentProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderConfigurationError";
  }
}
