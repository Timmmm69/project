import { apiFailure, apiSuccess } from "@/lib/api-response";
import { createPaymentForTest } from "@/lib/payments/payment-service";
import { publicCreatePaymentSchema } from "@/lib/payments/payment-schemas";
import { PaymentProviderConfigurationError } from "@/lib/payments/providers/types";
import { serializePayment } from "@/lib/payments/serialize";

export async function POST(request: Request) {
  const parsed = publicCreatePaymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid payment data",
        details: parsed.error.flatten()
      },
      422
    );
  }

  try {
    const provider =
      parsed.data.provider === "mock"
        ? "MOCK"
        : parsed.data.provider === "expresspay_epos"
          ? "EXPRESSPAY_EPOS"
          : undefined;
    const payment = await createPaymentForTest({
      email: parsed.data.email,
      testId: parsed.data.testId,
      request,
      provider
    });

    return apiSuccess({ payment: serializePayment(payment) }, { status: 201 });
  } catch (error) {
    if (error instanceof PaymentProviderConfigurationError) {
      return apiFailure({ code: "PAYMENT_PROVIDER_NOT_CONFIGURED", message: error.message }, 503);
    }
    if (error instanceof Error && error.message === "TEST_NOT_FOUND") {
      return apiFailure({ code: "NOT_FOUND", message: "Test not found" }, 404);
    }
    if (error instanceof Error && error.message === "PAYMENT_CURRENCY_NOT_SUPPORTED") {
      return apiFailure({ code: "PAYMENT_CURRENCY_NOT_SUPPORTED", message: "Only BYN payments are supported" }, 409);
    }
    if (error instanceof Error && error.message === "EMAIL_NOT_AVAILABLE") {
      return apiFailure({ code: "EMAIL_NOT_AVAILABLE", message: "Email cannot be used for student access" }, 409);
    }
    if (error instanceof Error && error.message.startsWith("PAYMENT_PROVIDER_UNSUPPORTED")) {
      return apiFailure({ code: "PAYMENT_PROVIDER_UNSUPPORTED", message: "Payment provider is not supported" }, 409);
    }

    return apiFailure({ code: "PAYMENT_CREATE_FAILED", message: "Payment cannot be created" }, 500);
  }
}
