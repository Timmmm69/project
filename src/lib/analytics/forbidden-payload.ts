const forbiddenKeys = new Set([
  "email", "email_hash", "user_email", "answer", "answers", "question", "question_text", "correct_answer",
  "accepted_answers", "explanation", "raw_score", "primary_score", "scaled_score", "lookup", "merchant_reference",
  "provider_payment_id", "signature", "secret", "token", "authorization", "cookie", "url", "stack", "message",
  "payload", "request_body", "response_body"
]);

const emailLike = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const bearerLike = /\b(?:bearer\s+|(?:api[_-]?key|token|secret)[=:]\s*)[A-Za-z0-9._~+/-]{12,}/i;
const urlWithQuery = /https?:\/\/[^\s?]+\?[^\s]+/i;

function normalizedKey(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function assertNoForbiddenAnalyticsPayload(value: unknown, path = "properties"): void {
  if (typeof value === "string") {
    if (emailLike.test(value) || bearerLike.test(value) || urlWithQuery.test(value) || value.length > 256) {
      throw new Error(`ANALYTICS_FORBIDDEN_VALUE:${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenAnalyticsPayload(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(normalizedKey(key))) throw new Error(`ANALYTICS_FORBIDDEN_KEY:${path}.${key}`);
      assertNoForbiddenAnalyticsPayload(item, `${path}.${key}`);
    }
  }
}
