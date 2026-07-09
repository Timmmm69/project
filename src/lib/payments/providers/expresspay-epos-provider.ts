import type { CreateProviderPaymentInput, CreateProviderPaymentResult, PaymentProviderAdapter, ProviderWebhookResult } from "@/lib/payments/providers/types";
import { PaymentProviderConfigurationError } from "@/lib/payments/providers/types";

type ExpressPayConfig = {
  sandbox: boolean;
  baseUrl: string;
  token: string;
  serviceId: string;
  secret: string;
  notificationSecret: string;
};

function readConfig(): ExpressPayConfig {
  return {
    sandbox: process.env.EXPRESSPAY_SANDBOX !== "false",
    baseUrl: process.env.EXPRESSPAY_BASE_URL ?? "",
    token: process.env.EXPRESSPAY_TOKEN ?? "",
    serviceId: process.env.EXPRESSPAY_SERVICE_ID ?? "",
    secret: process.env.EXPRESSPAY_SECRET ?? "",
    notificationSecret: process.env.EXPRESSPAY_NOTIFICATION_SECRET ?? ""
  };
}

function assertConfigured(config: ExpressPayConfig) {
  const missing = [
    ["EXPRESSPAY_BASE_URL", config.baseUrl],
    ["EXPRESSPAY_TOKEN", config.token],
    ["EXPRESSPAY_SERVICE_ID", config.serviceId]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new PaymentProviderConfigurationError(
      `ExpressPay/E-POS is not configured. Missing: ${missing.map(([key]) => key).join(", ")}`
    );
  }
}

export class ExpressPayEposProvider implements PaymentProviderAdapter {
  readonly provider = "EXPRESSPAY_EPOS" as const;

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult> {
    void input;
    const config = readConfig();
    assertConfigured(config);

    throw new PaymentProviderConfigurationError(
      "ExpressPay/E-POS API integration requires official provider documentation and credentials before real HTTP calls are enabled."
    );
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderWebhookResult> {
    void providerPaymentId;
    const config = readConfig();
    assertConfigured(config);

    throw new PaymentProviderConfigurationError(
      "ExpressPay/E-POS status check requires official provider documentation before implementation."
    );
  }

  async handleWebhook(payload: unknown, headers: Headers): Promise<ProviderWebhookResult> {
    const isValid = await this.verifyWebhookSignature(payload, headers);
    if (!isValid) {
      throw new Error("PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    }

    const body = payload as {
      paymentId?: string;
      providerPaymentId?: string;
      invoiceId?: string;
      status?: string;
    };
    const providerStatus = body.status ?? "unknown";

    return {
      internalPaymentId: body.paymentId ?? null,
      providerPaymentId: body.providerPaymentId ?? body.invoiceId ?? null,
      providerStatus,
      status: this.mapProviderStatusToInternalStatus(providerStatus),
      rawPayload: payload
    };
  }

  async verifyWebhookSignature(payload: unknown, headers: Headers) {
    void payload;
    void headers;
    const config = readConfig();
    if (!config.notificationSecret) {
      return false;
    }

    return false;
  }

  mapProviderStatusToInternalStatus(providerStatus: string) {
    const normalized = providerStatus.trim().toLowerCase();
    if (["success", "succeeded", "paid", "completed", "оплачен", "paid_success"].includes(normalized)) {
      return "success";
    }
    if (["failed", "declined", "error", "ошибка", "payment_failed"].includes(normalized)) {
      return "failed";
    }
    if (["cancelled", "canceled", "отменен", "отменён"].includes(normalized)) {
      return "cancelled";
    }
    if (["expired", "timeout", "истек", "истёк"].includes(normalized)) {
      return "expired";
    }
    if (["refunded", "refund"].includes(normalized)) {
      return "refunded";
    }
    if (["pending", "created", "new", "ожидает"].includes(normalized)) {
      return "pending";
    }
    return "unknown";
  }
}
