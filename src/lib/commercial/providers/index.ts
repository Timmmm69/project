import { LocalFakeCommercialProvider } from "@/lib/commercial/providers/fake-provider";
import type { CommercialPaymentProviderAdapter } from "@/lib/commercial/providers/types";
import { WebPaySandboxProvider } from "@/lib/commercial/providers/webpay-sandbox-provider";

export function commercialProviderForRuntime(): CommercialPaymentProviderAdapter {
  return process.env.NODE_ENV === "test" ? new LocalFakeCommercialProvider() : new WebPaySandboxProvider();
}

export { LocalFakeCommercialProvider, WebPaySandboxProvider };
export type { CommercialPaymentProviderAdapter, CheckoutSession, ProviderNotification } from "@/lib/commercial/providers/types";
