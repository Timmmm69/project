export const ANALYTICS_PRIVACY_ERROR_CODES = [
  "FORBIDDEN_IDENTITY",
  "FORBIDDEN_DEVICE_TRACKING",
  "FORBIDDEN_EDUCATION_CONTENT",
  "FORBIDDEN_SCORE",
  "FORBIDDEN_SECURITY_DATA",
  "FORBIDDEN_URL",
  "FORBIDDEN_ERROR_OR_FREE_TEXT"
] as const;

export type AnalyticsPrivacyErrorCode = (typeof ANALYTICS_PRIVACY_ERROR_CODES)[number];
export type AnalyticsPrivacyCategory =
  | "identity"
  | "device_tracking"
  | "education_content"
  | "score"
  | "security"
  | "url"
  | "error_or_free_text";

export type AnalyticsPrivacyViolation = Readonly<{
  code: AnalyticsPrivacyErrorCode;
  category: AnalyticsPrivacyCategory;
  path: string;
}>;

export type AnalyticsPrivacyScanResult =
  | Readonly<{ success: true }>
  | Readonly<{ success: false; error: AnalyticsPrivacyViolation }>;

const entityAnalyticsIdKeys = new Set([
  "order_public_id_hash",
  "payment_attempt_public_id_hash",
  "access_public_id_hash",
  "attempt_public_id_hash"
]);

const keyCategories = new Map<string, AnalyticsPrivacyCategory>([
  ["email", "identity"],
  ["user_email", "identity"],
  ["buyer_email", "identity"],
  ["student_email", "identity"],
  ["email_hash", "identity"],
  ["email_fingerprint", "identity"],
  ["normalized_email", "identity"],
  ["masked_email", "identity"],
  ["name", "identity"],
  ["full_name", "identity"],
  ["first_name", "identity"],
  ["last_name", "identity"],
  ["phone", "identity"],
  ["address", "identity"],
  ["date_of_birth", "identity"],
  ["dob", "identity"],
  ["document", "identity"],
  ["document_data", "identity"],
  ["buyer_name", "identity"],
  ["student_name", "identity"],
  ["buyer_assertion", "identity"],
  ["student_assertion", "identity"],
  ["buyer", "identity"],
  ["student", "identity"],
  ["ip", "identity"],
  ["ip_address", "identity"],
  ["user_agent", "device_tracking"],
  ["browser_fingerprint", "device_tracking"],
  ["fingerprint", "device_tracking"],
  ["advertising_id", "device_tracking"],
  ["cross_site_id", "device_tracking"],
  ["viewport_width", "device_tracking"],
  ["viewport_height", "device_tracking"],
  ["viewport_dimensions", "device_tracking"],
  ["answer", "education_content"],
  ["answers", "education_content"],
  ["answer_hash", "education_content"],
  ["selected_answer", "education_content"],
  ["selected_options", "education_content"],
  ["answer_text", "education_content"],
  ["answer_token", "education_content"],
  ["answer_length", "education_content"],
  ["is_correct", "education_content"],
  ["question", "education_content"],
  ["question_content", "education_content"],
  ["question_id", "education_content"],
  ["question_number", "education_content"],
  ["question_text", "education_content"],
  ["question_options", "education_content"],
  ["options", "education_content"],
  ["shared_context", "education_content"],
  ["correct_answer", "education_content"],
  ["accepted_answers", "education_content"],
  ["explanation", "education_content"],
  ["scoring_rule", "education_content"],
  ["raw_score", "score"],
  ["primary_score", "score"],
  ["scaled_score", "score"],
  ["official_score", "score"],
  ["max_score", "score"],
  ["max_raw_score", "score"],
  ["max_scaled_score", "score"],
  ["score_value", "score"],
  ["score", "score"],
  ["exact_score", "score"],
  ["lookup", "score"],
  ["lookup_value", "score"],
  ["lookup_score", "score"],
  ["session_token", "security"],
  ["recovery_token", "security"],
  ["verified_session_token", "security"],
  ["token", "security"],
  ["token_hash", "security"],
  ["api_key", "security"],
  ["api_key_hash", "security"],
  ["client_secret", "security"],
  ["secret_key", "security"],
  ["private_key", "security"],
  ["signing_key", "security"],
  ["encryption_key", "security"],
  ["webhook_secret", "security"],
  ["access_code", "security"],
  ["access_code_hash", "security"],
  ["otp", "security"],
  ["otp_hash", "security"],
  ["cookie", "security"],
  ["authorization", "security"],
  ["authorization_header", "security"],
  ["csrf", "security"],
  ["magic_link", "security"],
  ["checkout_token", "security"],
  ["order_lookup_token", "security"],
  ["signature", "security"],
  ["secret", "security"],
  ["password", "security"],
  ["credentials", "security"],
  ["provider_credentials", "security"],
  ["provider_token", "security"],
  ["provider_secret", "security"],
  ["provider_payment_id", "security"],
  ["merchant_id", "security"],
  ["store_id", "security"],
  ["wsb_storeid", "security"],
  ["wsb_signature", "security"],
  ["merchant_reference", "security"],
  ["provider_reference", "security"],
  ["card_number", "security"],
  ["pan", "security"],
  ["cardholder", "security"],
  ["cardholder_name", "security"],
  ["cvv", "security"],
  ["cvc", "security"],
  ["cvv2", "security"],
  ["cvc2", "security"],
  ["card_expiry", "security"],
  ["expiry_date", "security"],
  ["expiration_date", "security"],
  ["card_token", "security"],
  ["payment_token", "security"],
  ["invoice", "security"],
  ["rrn", "security"],
  ["id", "security"],
  ["user_id", "security"],
  ["order_id", "security"],
  ["payment_id", "security"],
  ["access_id", "security"],
  ["attempt_id", "security"],
  ["url", "url"],
  ["raw_url", "url"],
  ["query", "url"],
  ["query_string", "url"],
  ["fragment", "url"],
  ["hash_fragment", "url"],
  ["stack", "error_or_free_text"],
  ["stack_trace", "error_or_free_text"],
  ["exception", "error_or_free_text"],
  ["raw_exception", "error_or_free_text"],
  ["request_body", "error_or_free_text"],
  ["response_body", "error_or_free_text"],
  ["provider_message", "error_or_free_text"],
  ["support_correspondence", "error_or_free_text"],
  ["metadata", "error_or_free_text"],
  ["message", "error_or_free_text"],
  ["description", "error_or_free_text"],
  ["reason_text", "error_or_free_text"],
  ["context", "error_or_free_text"],
  ["payload", "error_or_free_text"]
]);

const errorCodes: Record<AnalyticsPrivacyCategory, AnalyticsPrivacyErrorCode> = {
  identity: "FORBIDDEN_IDENTITY",
  device_tracking: "FORBIDDEN_DEVICE_TRACKING",
  education_content: "FORBIDDEN_EDUCATION_CONTENT",
  score: "FORBIDDEN_SCORE",
  security: "FORBIDDEN_SECURITY_DATA",
  url: "FORBIDDEN_URL",
  error_or_free_text: "FORBIDDEN_ERROR_OR_FREE_TEXT"
};

const emailLike = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const maskedEmailLike = /(?:\*{2,}|[A-Z0-9._%+-]\*+)@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const commonDigestShape = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;
const ipv4Like = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const ipv6Like = /^(?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}$/i;
const userAgentLike = /\b(?:Mozilla\/\d|AppleWebKit\/|Chrome\/\d|Firefox\/\d|Safari\/\d)\b/i;
const bearerLike = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i;
const jwtLike = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const rawUrlLike = /(?:https?:\/\/|\/\/)[^\s]+/i;
const queryOrFragmentLike = /(?:^|[/?#&])(?:token|code|key|secret|signature|authorization|session|recovery)[=:][^\s&#]+/i;
const stackTraceLike = /(?:\n|^)\s*at\s+(?:new\s+)?[\w.$<>]+\s*\(|Error:\s+.+\n\s*at\s+/;
const paymentCardNumberLike = /^\d(?:[ -]?\d){12,18}$/;

function isLuhnValidPaymentCardNumber(value: string) {
  if (!paymentCardNumberLike.test(value)) return false;

  const digits = value.replace(/[ -]/g, "");
  let checksum = 0;
  let doubleDigit = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    checksum += digit;
    doubleDigit = !doubleDigit;
  }

  return checksum % 10 === 0;
}

function normalizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function safePath(parent: string, rawKey: string, normalized: string) {
  if (/^[a-zA-Z0-9_]+$/.test(rawKey) && rawKey.length <= 64) {
    return `${parent}.${normalized}`;
  }
  return `${parent}.[forbidden_key]`;
}

function failure(category: AnalyticsPrivacyCategory, path: string): AnalyticsPrivacyScanResult {
  return { success: false, error: { code: errorCodes[category], category, path } };
}

function scanString(value: string, path: string, key: string | null): AnalyticsPrivacyScanResult {
  if (emailLike.test(value) || maskedEmailLike.test(value) || (commonDigestShape.test(value) && !key?.endsWith("_public_id_hash"))) {
    return failure("identity", path);
  }
  if (ipv4Like.test(value) || ipv6Like.test(value)) {
    return failure("identity", path);
  }
  if (userAgentLike.test(value)) {
    return failure("device_tracking", path);
  }
  if (isLuhnValidPaymentCardNumber(value)) {
    return failure("security", path);
  }
  if (bearerLike.test(value) || jwtLike.test(value)) {
    return failure("security", path);
  }
  if (rawUrlLike.test(value) || queryOrFragmentLike.test(value)) {
    return failure("url", path);
  }
  if (stackTraceLike.test(value) || value.length > 256) {
    return failure("error_or_free_text", path);
  }
  return { success: true };
}

function scan(value: unknown, path: string, key: string | null): AnalyticsPrivacyScanResult {
  if (typeof value === "string") {
    return scanString(value, path, key);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = scan(value[index], `${path}[${index}]`, key);
      if (!result.success) return result;
    }
    return { success: true };
  }
  if (value !== null && typeof value === "object") {
    for (const [rawKey, item] of Object.entries(value)) {
      const normalized = normalizeKey(rawKey);
      const itemPath = safePath(path, rawKey, normalized);
      if (emailLike.test(rawKey) || maskedEmailLike.test(rawKey) || commonDigestShape.test(rawKey)) {
        return failure("identity", itemPath);
      }
      const category = keyCategories.get(normalized);
      if (category && !entityAnalyticsIdKeys.has(normalized)) {
        return failure(category, itemPath);
      }
      const result = scan(item, itemPath, normalized);
      if (!result.success) return result;
    }
  }
  return { success: true };
}

/** Fail-closed defense-in-depth scan. The result never contains the inspected value. */
export function scanAnalyticsPrivacy(value: unknown): AnalyticsPrivacyScanResult {
  return scan(value, "$", null);
}

export class AnalyticsPrivacyError extends Error {
  constructor(readonly detail: AnalyticsPrivacyViolation) {
    super(`ANALYTICS_PRIVACY_REJECTED:${detail.code}:${detail.path}`);
    this.name = "AnalyticsPrivacyError";
  }
}

export function assertAnalyticsPrivacy(value: unknown): void {
  const result = scanAnalyticsPrivacy(value);
  if (!result.success) {
    throw new AnalyticsPrivacyError(result.error);
  }
}
