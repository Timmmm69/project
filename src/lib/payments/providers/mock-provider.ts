import type { PaymentProviderAdapter, CreateProviderPaymentInput, CreateProviderPaymentResult, ProviderWebhookResult } from "@/lib/payments/providers/types";

export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly provider = "MOCK" as const;

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult> {
    const providerPaymentId = `mock_${input.internalPaymentId}`;

    return {
      providerPaymentId,
      providerInvoiceId: `mock_invoice_${input.internalPaymentId}`,
      providerAccountNumber: `MOCK-${input.internalPaymentId.slice(0, 8).toUpperCase()}`,
      paymentUrl: null,
      qrCodeUrl: null,
      qrCodePayload: `mock-payment:${input.internalPaymentId}`,
      paymentInstructions:
        "Dev mode: use Simulate success payment or Simulate failed payment to test access creation.",
      providerStatus: "pending",
      rawPayload: {
        provider: "mock",
        providerPaymentId,
        amount: input.amount,
        currency: input.currency
      }
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderWebhookResult> {
    return {
      providerPaymentId,
      providerStatus: "pending",
      status: "pending",
      rawPayload: { provider: "mock", providerPaymentId, status: "pending" }
    };
  }

  async handleWebhook(payload: unknown): Promise<ProviderWebhookResult> {
    const body = payload as { paymentId?: string; providerPaymentId?: string; status?: string };
    const providerStatus = body.status ?? "unknown";

    return {
      internalPaymentId: body.paymentId ?? null,
      providerPaymentId: body.providerPaymentId ?? (body.paymentId ? `mock_${body.paymentId}` : null),
      providerStatus,
      status: this.mapProviderStatusToInternalStatus(providerStatus),
      rawPayload: payload
    };
  }

  async verifyWebhookSignature() {
    return true;
  }

  mapProviderStatusToInternalStatus(providerStatus: string) {
    const normalized = providerStatus.toLowerCase();
    if (["success", "paid", "completed"].includes(normalized)) {
      return "success";
    }
    if (["failed", "declined", "error"].includes(normalized)) {
      return "failed";
    }
    if (["cancelled", "canceled"].includes(normalized)) {
      return "cancelled";
    }
    if (["expired", "timeout"].includes(normalized)) {
      return "expired";
    }
    if (["refunded"].includes(normalized)) {
      return "refunded";
    }
    if (["pending", "created", "new"].includes(normalized)) {
      return "pending";
    }
    return "unknown";
  }
}
