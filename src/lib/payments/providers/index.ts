import type { PaymentProvider as PrismaPaymentProvider } from "@prisma/client";
import { ExpressPayEposProvider } from "@/lib/payments/providers/expresspay-epos-provider";
import { MockPaymentProvider } from "@/lib/payments/providers/mock-provider";
import type { PaymentProviderAdapter } from "@/lib/payments/providers/types";

export function providerFromEnv(): PrismaPaymentProvider {
  const provider = (process.env.PAYMENT_PROVIDER ?? "mock").toLowerCase();

  if (provider === "mock") {
    return "MOCK";
  }
  if (provider === "expresspay_epos" || provider === "expresspay" || provider === "epos" || provider === "erip") {
    return "EXPRESSPAY_EPOS";
  }

  return "OTHER";
}

export function getPaymentProvider(provider: PrismaPaymentProvider = providerFromEnv()): PaymentProviderAdapter {
  if (provider === "MOCK") {
    return new MockPaymentProvider();
  }
  if (provider === "EXPRESSPAY_EPOS") {
    return new ExpressPayEposProvider();
  }

  throw new Error(`PAYMENT_PROVIDER_UNSUPPORTED:${provider}`);
}
