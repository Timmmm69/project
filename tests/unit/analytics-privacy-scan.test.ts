import { describe, expect, it } from "vitest";
import {
  scanAnalyticsPrivacy,
  type AnalyticsPrivacyCategory,
  type AnalyticsPrivacyErrorCode
} from "@/lib/analytics/privacy-scan";

const errorCodeByCategory: Record<AnalyticsPrivacyCategory, AnalyticsPrivacyErrorCode> = {
  identity: "FORBIDDEN_IDENTITY",
  device_tracking: "FORBIDDEN_DEVICE_TRACKING",
  education_content: "FORBIDDEN_EDUCATION_CONTENT",
  score: "FORBIDDEN_SCORE",
  security: "FORBIDDEN_SECURITY_DATA",
  url: "FORBIDDEN_URL",
  error_or_free_text: "FORBIDDEN_ERROR_OR_FREE_TEXT"
};

function expectPrivacyRejection(
  payload: unknown,
  category: AnalyticsPrivacyCategory,
  sensitiveValues: readonly string[]
) {
  const result = scanAnalyticsPrivacy(payload);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("EXPECTED_PRIVACY_FAILURE");

  expect(result.error.category).toBe(category);
  expect(result.error.code).toBe(errorCodeByCategory[category]);
  expect(result.error.path).toMatch(/^\$/);

  const output = JSON.stringify(result.error);
  for (const sensitiveValue of sensitiveValues) {
    expect(output).not.toContain(sensitiveValue);
  }
}

const forbiddenAliases: ReadonlyArray<readonly [string, AnalyticsPrivacyCategory]> = [
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
  ["merchant_id", "security"],
  ["store_id", "security"],
  ["wsb_storeid", "security"],
  ["wsb_signature", "security"],
  ["provider_token", "security"],
  ["provider_secret", "security"],
  ["question", "education_content"],
  ["question_content", "education_content"],
  ["answer_hash", "education_content"],
  ["selected_options", "education_content"]
];

function keyVariants(alias: string) {
  const parts = alias.split("_");
  const camelCase = parts
    .map((part, index) => index === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");

  return [...new Set([
    alias,
    camelCase,
    alias.replace(/_/g, "-"),
    parts.join("_-")
  ])];
}

const forbiddenAliasVariants = forbiddenAliases.flatMap(([alias, category]) =>
  keyVariants(alias).map((key) => [`${alias} via ${key}`, key, category] as const)
);

const existingForbiddenKeyCases: ReadonlyArray<
  readonly [string, Record<string, unknown>, AnalyticsPrivacyCategory, readonly string[]]
> = [
  ["raw email", { email: "student@example.test" }, "identity", ["student@example.test"]],
  ["masked email", { masked_email: "s***@example.test" }, "identity", ["s***@example.test"]],
  ["IP", { ip_address: "192.0.2.10" }, "identity", ["192.0.2.10"]],
  ["user agent", { user_agent: "Mozilla/5.0 Chrome/120" }, "device_tracking", ["Mozilla/5.0 Chrome/120"]],
  ["selected answer", { selected_answer: "selected-sensitive-value" }, "education_content", ["selected-sensitive-value"]],
  ["question text", { question_text: "confidential-question-value" }, "education_content", ["confidential-question-value"]],
  ["correct answer", { correct_answer: "correct-sensitive-value" }, "education_content", ["correct-sensitive-value"]],
  ["accepted answers", { accepted_answers: ["accepted-sensitive-value"] }, "education_content", ["accepted-sensitive-value"]],
  ["explanation", { explanation: "confidential-explanation-value" }, "education_content", ["confidential-explanation-value"]],
  ["raw score", { raw_score: 40 }, "score", ["40"]],
  ["primary score", { primary_score: 41 }, "score", ["41"]],
  ["scaled score", { scaled_score: 90 }, "score", ["90"]],
  ["lookup value", { lookup_value: 91 }, "score", ["91"]],
  ["OTP", { otp: "123456" }, "security", ["123456"]],
  ["session token", { session_token: "secret-session-value" }, "security", ["secret-session-value"]],
  ["recovery token", { recovery_token: "secret-recovery-value" }, "security", ["secret-recovery-value"]],
  ["cookie", { cookie: "session=secret-cookie-value" }, "security", ["session=secret-cookie-value"]],
  ["authorization", { authorization: "Bearer secret-authorization-value" }, "security", ["Bearer secret-authorization-value"]],
  ["provider signature", { signature: "signed-secret-value" }, "security", ["signed-secret-value"]],
  ["raw URL", { raw_url: "https://example.test/result?token=secret" }, "url", ["https://example.test/result?token=secret"]],
  ["stack trace", { stack_trace: "Error: secret\n at handler (app.ts:1:1)" }, "error_or_free_text", ["Error: secret\n at handler (app.ts:1:1)"]],
  ["metadata", { metadata: { arbitrary: "metadata-sensitive-value" } }, "error_or_free_text", ["metadata-sensitive-value"]],
  ["free text", { message: "provider-raw-message-value" }, "error_or_free_text", ["provider-raw-message-value"]],
  ["provider reference", { provider_payment_id: "provider-sensitive-reference" }, "security", ["provider-sensitive-reference"]]
];

const forbiddenValueShapes: ReadonlyArray<
  readonly [string, string, AnalyticsPrivacyCategory]
> = [
  ["raw email", "student@example.test", "identity"],
  ["masked email", "s***@example.test", "identity"],
  ["digest", "a".repeat(64), "identity"],
  ["IP", "192.0.2.10", "identity"],
  ["user agent", "Mozilla/5.0 AppleWebKit/537.36 Chrome/120", "device_tracking"],
  ["bearer token", "Bearer abcdefghijklmnopqrstuvwxyz", "security"],
  ["raw URL", "https://example.test/callback?token=secret", "url"],
  ["stack trace", "Error: hidden\n at handler (app.ts:1:1)", "error_or_free_text"],
  ["oversized free text", "x".repeat(257), "error_or_free_text"]
];

const positiveControls: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["event_id UUID", { event_id: "019f66ee-09d4-7d3c-a0b6-f28a3947296e" }],
  ["checkout_flow_id UUID", { checkout_flow_id: "019f66ee-09d4-7d3c-a0b6-f28a3947296f" }],
  ["save_operation_id UUID", { save_operation_id: "019f66ee-09d4-7d3c-a0b6-f28a39472970" }],
  ["aid1 entity ID", { order_public_id_hash: `aid1.${"A".repeat(43)}` }],
  ["product_id", { product_id: "product-public-2026-001" }],
  ["test_id", { test_id: "test-public-2026-001" }],
  ["short numeric enum/code", { safe_code: "123456" }],
  ["closed enums and documented buckets", {
    event_name: "payment_confirmed",
    payment_status: "paid",
    verification_method: "status_api",
    device_class: "mobile",
    viewport_bucket: "390_429"
  }],
  ["UTC ISO timestamp", { occurred_at: "2026-07-15T12:00:00.000Z" }]
];

describe("analytics privacy scanner", () => {
  it.each(forbiddenAliasVariants)(
    "rejects normalized forbidden alias %s without echoing its value",
    (_name, key, category) => {
      const sensitiveValue = "sensitive-alias-value-never-echo";
      expectPrivacyRejection({ [key]: sensitiveValue }, category, [sensitiveValue]);
    }
  );

  it.each(existingForbiddenKeyCases)(
    "rejects %s with the expected category and no value echo",
    (_name, payload, category, sensitiveValues) => {
      expectPrivacyRejection(payload, category, sensitiveValues);
    }
  );

  it.each(forbiddenValueShapes)(
    "rejects forbidden value shape %s without echo",
    (_name, sensitiveValue, category) => {
      expectPrivacyRejection({ safe_code: sensitiveValue }, category, [sensitiveValue]);
    }
  );

  it("rejects a spaced PAN with the security category and no value echo", () => {
    const sensitiveValue = "4111 1111 1111 1111";
    expectPrivacyRejection({ pan: sensitiveValue }, "security", [sensitiveValue]);
  });

  it("rejects a Luhn-valid PAN under a neutral key", () => {
    const sensitiveValue = "4111-1111-1111-1111";
    expectPrivacyRejection({ safe_code: sensitiveValue }, "security", [sensitiveValue]);
  });

  it.each([
    ["nested token", { properties: { nested: [{ token: "nested-token-sensitive-value" }] } }, "nested-token-sensitive-value"],
    ["nested card payload", { properties: { nested: [{ safe_code: "5555 5555 5555 4444" }] } }, "5555 5555 5555 4444"]
  ] as const)("rejects %s without echoing nested security data", (_name, payload, sensitiveValue) => {
    expectPrivacyRejection(payload, "security", [sensitiveValue]);
  });

  it("rejects forbidden values nested inside otherwise structured input", () => {
    const sensitiveValue = "student@example.test";
    expectPrivacyRejection(
      { properties: { nested: [{ safe_code: sensitiveValue }] } },
      "identity",
      [sensitiveValue]
    );
  });

  it("rejects an email used as an object key without echoing it", () => {
    const sensitiveValue = "student@example.test";
    expectPrivacyRejection({ [sensitiveValue]: "value" }, "identity", [sensitiveValue]);
  });

  it.each(positiveControls)("accepts positive control %s", (_name, payload) => {
    expect(scanAnalyticsPrivacy(payload)).toEqual({ success: true });
  });
});
