export const COMMERCIAL_PRODUCT_CODE = "russian-training-variant-01";
export const COMMERCIAL_PRICE_MINOR = 1000;
export const COMMERCIAL_CURRENCY = "BYN";
export const COMMERCIAL_ATTEMPT_LIMIT = 1;
export const COMMERCIAL_START_WINDOW_DAYS = 90;
export const COMMERCIAL_DURATION_MINUTES = 120;
export const COMMERCIAL_RESULT_RETENTION_DAYS = 365;
export const COMMERCIAL_RESULT_DISPLAY_MODE = "PRIMARY_ONLY";

function hasCommercialOrderTokenSecret() {
  const secret = process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY;
  return Boolean(secret && Buffer.byteLength(secret, "utf8") >= 32);
}

export function commercialLegalConfig() {
  return {
    version: process.env.LEGAL_BUNDLE_VERSION?.trim() ?? "",
    offerUrl: process.env.OFFER_URL?.trim() ?? "",
    privacyUrl: process.env.PRIVACY_URL?.trim() ?? "",
    refundPolicyUrl: process.env.REFUND_POLICY_URL?.trim() ?? "",
    disclaimerUrl: process.env.DISCLAIMER_URL?.trim() ?? "",
    supportEmail: process.env.SUPPORT_EMAIL?.trim() ?? "",
    supportTelegram: process.env.SUPPORT_TELEGRAM?.trim() ?? ""
  };
}

export function isCommercialCheckoutEnabled() {
  const legal = commercialLegalConfig();
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.COMMERCIAL_CHECKOUT_ENABLED === "true" &&
    process.env.PAYMENTS_MODE === "webpay_sandbox" &&
    hasCommercialOrderTokenSecret() &&
    Boolean(legal.version && legal.offerUrl && legal.privacyUrl && legal.refundPolicyUrl && legal.disclaimerUrl && legal.supportEmail)
  );
}

export function commercialCheckoutUnavailableReason() {
  if (process.env.NODE_ENV === "production") {
    return "COMMERCIAL_CHECKOUT_PRODUCTION_DISABLED";
  }
  if (process.env.COMMERCIAL_CHECKOUT_ENABLED !== "true" || process.env.PAYMENTS_MODE !== "webpay_sandbox") {
    return "COMMERCIAL_CHECKOUT_DISABLED";
  }
  const legal = commercialLegalConfig();
  if (!legal.version || !legal.offerUrl || !legal.privacyUrl || !legal.refundPolicyUrl || !legal.disclaimerUrl || !legal.supportEmail) {
    return "COMMERCIAL_LEGAL_CONFIGURATION_MISSING";
  }
  if (!hasCommercialOrderTokenSecret()) {
    return "COMMERCIAL_ORDER_TOKEN_CONFIGURATION_MISSING";
  }
  return null;
}
