import { describe, expect, it } from "vitest";
import { scanAnalyticsPrivacy } from "@/lib/analytics/privacy-scan";

const forbiddenKeyCases: Array<[string, Record<string, unknown>]> = [
  ["raw email", { email: "student@example.test" }],
  ["masked email", { masked_email: "s***@example.test" }],
  ["IP", { ip_address: "192.0.2.10" }],
  ["user agent", { user_agent: "Mozilla/5.0 Chrome/120" }],
  ["selected answer", { selected_answer: "selected-sensitive-value" }],
  ["question text", { question_text: "confidential question" }],
  ["correct answer", { correct_answer: "correct-sensitive-value" }],
  ["accepted answers", { accepted_answers: ["token"] }],
  ["explanation", { explanation: "confidential explanation" }],
  ["raw score", { raw_score: 40 }],
  ["primary score", { primary_score: 40 }],
  ["scaled score", { scaled_score: 90 }],
  ["lookup value", { lookup_value: 90 }],
  ["OTP", { otp: "123456" }],
  ["session token", { session_token: "secret-session" }],
  ["recovery token", { recovery_token: "secret-recovery" }],
  ["cookie", { cookie: "session=secret" }],
  ["authorization", { authorization: "Bearer secret" }],
  ["provider signature", { signature: "signed-secret" }],
  ["raw URL", { raw_url: "https://example.test/result?token=secret" }],
  ["stack trace", { stack_trace: "Error: secret\n at handler (app.ts:1:1)" }],
  ["metadata", { metadata: { arbitrary: "value" } }],
  ["free text", { message: "provider raw message" }],
  ["provider reference", { provider_payment_id: "provider-123" }]
];

describe("analytics privacy scanner", () => {
  it.each(forbiddenKeyCases)("rejects %s without echoing its value", (_name, payload) => {
    const result = scanAnalyticsPrivacy(payload);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("EXPECTED_PRIVACY_FAILURE");
    const output = JSON.stringify(result.error);
    for (const value of Object.values(payload)) {
      if (typeof value === "string") expect(output).not.toContain(value);
    }
    expect(result.error.path).toMatch(/^\$/);
  });

  it.each([
    "student@example.test",
    "s***@example.test",
    "a".repeat(64),
    "192.0.2.10",
    "Mozilla/5.0 AppleWebKit/537.36 Chrome/120",
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "https://example.test/callback?token=secret",
    "Error: hidden\n at handler (app.ts:1:1)",
    "x".repeat(257)
  ])("rejects forbidden value shape without echo: %s", (sensitive) => {
    const result = scanAnalyticsPrivacy({ safe_code: sensitive });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sensitive);
  });

  it("rejects forbidden values nested inside otherwise structured input", () => {
    const sensitive = "student@example.test";
    const result = scanAnalyticsPrivacy({ properties: { nested: [{ safe_code: sensitive }] } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sensitive);
  });

  it("rejects an email used as an object key without echoing it", () => {
    const sensitive = "student@example.test";
    const result = scanAnalyticsPrivacy({ [sensitive]: "value" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sensitive);
  });

  it("accepts closed enums, buckets and opaque entity analytics IDs", () => {
    expect(scanAnalyticsPrivacy({
      event_name: "payment_confirmed",
      payment_status: "paid",
      verification_method: "status_api",
      device_class: "mobile",
      viewport_bucket: "390_429",
      order_public_id_hash: `aid1.${"A".repeat(43)}`
    })).toEqual({ success: true });
  });
});
