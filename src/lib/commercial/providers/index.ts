import { LocalFakeCommercialProvider } from "@/lib/commercial/providers/fake-provider";
import type { CommercialPaymentProviderAdapter } from "@/lib/commercial/providers/types";
import { WebPaySandboxProvider } from "@/lib/commercial/providers/webpay-sandbox-provider";

export function commercialProviderForRuntime(): CommercialPaymentProviderAdapter {
  if (process.env.NODE_ENV !== "production" && process.env.COMMERCIAL_FAKE_PROVIDER_TEST_ONLY === "true") {
    return new LocalFakeCommercialProvider();
  }
  return new WebPaySandboxProvider();
}

export function isLocalFakeCommercialProviderEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.COMMERCIAL_FAKE_PROVIDER_TEST_ONLY === "true";
}

export { LocalFakeCommercialProvider, WebPaySandboxProvider };
export type { CommercialPaymentProviderAdapter, CheckoutSession, ProviderNotification } from "@/lib/commercial/providers/types";
