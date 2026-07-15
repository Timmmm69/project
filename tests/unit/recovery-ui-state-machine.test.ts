import { describe, expect, it } from "vitest";
import {
  initialRecoveryUiState,
  isAllowedRecoveryNextUrl,
  parseChallengeResponse,
  parseContinuationResponse,
  parseRecoveryStateResponse,
  parseVerificationResponse,
  recoveryUiReducer,
  reuseLogicalOperationId,
  safeRecoveryErrorText,
  type RecoveryBusinessState
} from "@/app/(public)/tests/[slug]/recovery-access-machine";
import { resolveRecoveryUiAvailability } from "@/server/recovery/ui-availability";

function encoded(byte: number) {
  return Buffer.alloc(32, byte).toString("base64url");
}

function enabledEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    ACC_01A_RECOVERY_ENABLED: "true",
    RECOVERY_MAILER_MODE: "test",
    RECOVERY_COMMERCIAL_PRODUCT_CODE: "russian-training-variant-01",
    RECOVERY_EMAIL_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING: `v1:${encoded(111)}`,
    RECOVERY_CHALLENGE_TOKEN_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_CHALLENGE_TOKEN_HMAC_KEY_RING: `v1:${encoded(112)}`,
    RECOVERY_OTP_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_OTP_HMAC_KEY_RING: `v1:${encoded(113)}`,
    RECOVERY_SESSION_TOKEN_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_SESSION_TOKEN_HMAC_KEY_RING: `v1:${encoded(114)}`,
    VERIFIED_COMMERCIAL_SESSION_MODE: "enforce",
    VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v1",
    VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${encoded(115)}`,
    APP_URL: "http://localhost:3000",
    ...overrides
  };
}

describe("recovery access UI state machine", () => {
  it("starts closed without sensitive values", () => {
    expect(initialRecoveryUiState).toEqual(expect.objectContaining({
      phase: "closed",
      requestOperationId: null,
      verificationOperationId: null,
      continuationOperationId: null
    }));
  });

  it("opens at the email step", () => {
    expect(recoveryUiReducer(initialRecoveryUiState, { type: "OPEN" }).phase)
      .toBe("enter_email");
  });

  it("records one request UUID for a logical submit", () => {
    const state = recoveryUiReducer(initialRecoveryUiState, {
      type: "REQUEST_STARTED",
      operationId: "request-1"
    });
    expect(state).toMatchObject({ phase: "requesting_code", requestOperationId: "request-1" });
  });

  it("reuses an existing UUID on a duplicate submit", () => {
    let calls = 0;
    const value = reuseLogicalOperationId("request-1", () => {
      calls += 1;
      return "request-2";
    });
    expect(value).toBe("request-1");
    expect(calls).toBe(0);
  });

  it("creates a UUID only when an operation has none", () => {
    expect(reuseLogicalOperationId(null, () => "request-2")).toBe("request-2");
  });

  it("changing email clears request and verification operations", () => {
    const pending = {
      ...initialRecoveryUiState,
      requestOperationId: "request-1",
      verificationOperationId: "verify-1"
    };
    expect(recoveryUiReducer(pending, { type: "EMAIL_CHANGED" })).toMatchObject({
      phase: "enter_email",
      requestOperationId: null,
      verificationOperationId: null
    });
  });

  it("accepts only the neutral challenge success contract", () => {
    expect(parseChallengeResponse({
      state: "code_sent",
      messageKey: "email.sent_neutral",
      emailMasked: "b***r@example.test",
      resendAfterSeconds: 60
    })).toEqual({ maskedEmail: "b***r@example.test", resendAfterSeconds: 60 });
    expect(parseChallengeResponse({ state: "access_exists", resendAfterSeconds: 60 })).toBeNull();
  });

  it("moves a neutral 202 result to code_sent and completes the request operation", () => {
    const state = recoveryUiReducer(
      { ...initialRecoveryUiState, requestOperationId: "request-1" },
      {
        type: "REQUEST_SUCCEEDED",
        maskedEmail: "b***r@example.test",
        resendAfterSeconds: 60,
        now: 1_000
      }
    );
    expect(state).toMatchObject({
      phase: "code_sent",
      maskedEmail: "b***r@example.test",
      resendAvailableAt: 61_000,
      requestOperationId: null
    });
  });

  it("keeps resend blocked until the backend-provided cooldown elapses", () => {
    const state = recoveryUiReducer(initialRecoveryUiState, {
      type: "REQUEST_SUCCEEDED",
      maskedEmail: null,
      resendAfterSeconds: 60,
      now: 5_000
    });
    expect(state.resendAvailableAt).toBe(65_000);
    expect(state.resendAvailableAt! - 64_999).toBeGreaterThan(0);
  });

  it("a resend can create a new logical UUID after the prior operation completed", () => {
    expect(reuseLogicalOperationId(null, () => "resend-2")).toBe("resend-2");
  });

  it("invalid OTP stays on the code form", () => {
    expect(recoveryUiReducer(initialRecoveryUiState, { type: "CODE_INVALID" }))
      .toMatchObject({ phase: "code_sent", errorCode: "CODE_INVALID" });
  });

  it("expired OTP returns to an immediately available resend path", () => {
    expect(recoveryUiReducer(initialRecoveryUiState, { type: "CODE_EXPIRED", now: 7_000 }))
      .toMatchObject({ phase: "code_sent", resendAvailableAt: 7_000 });
  });

  it("verification retry reuses its operation UUID", () => {
    expect(reuseLogicalOperationId("verify-1", () => "verify-2")).toBe("verify-1");
  });

  it("editing the verification input clears the old operation UUID", () => {
    const state = recoveryUiReducer(
      { ...initialRecoveryUiState, verificationOperationId: "verify-1" },
      { type: "VERIFICATION_INPUT_CHANGED" }
    );
    expect(state.verificationOperationId).toBeNull();
  });

  it("accepts only the exact verification success contract", () => {
    expect(parseVerificationResponse({
      state: "verified",
      messageKey: "email.code.verified",
      nextAction: "RESOLVE"
    })).toBe(true);
    expect(parseVerificationResponse({ state: "verified", nextAction: "CONTINUE" })).toBe(false);
  });

  it("successful verification triggers resolving", () => {
    expect(recoveryUiReducer(initialRecoveryUiState, { type: "VERIFICATION_SUCCEEDED" }).phase)
      .toBe("resolving");
  });

  it.each([
    ["access_unstarted", "CONTINUE"],
    ["attempt_active", "CONTINUE"],
    ["result_available", "CONTINUE"],
    ["start_window_expired", null],
    ["no_access", null],
    ["support_required", null]
  ] as const)("maps the %s resolver state", (state, nextAction) => {
    expect(parseRecoveryStateResponse({ state, screen: "REC-01", nextAction })).toBe(state);
    expect(recoveryUiReducer(initialRecoveryUiState, {
      type: "RESOLVE_SUCCEEDED",
      state: state as RecoveryBusinessState
    }).phase).toBe(state);
  });

  it("rejects a resolver response with a mismatched nextAction", () => {
    expect(parseRecoveryStateResponse({
      state: "no_access",
      screen: "REC-01",
      nextAction: "CONTINUE"
    })).toBeNull();
  });

  it("continuation double click reuses one UUID", () => {
    expect(reuseLogicalOperationId("continue-1", () => "continue-2")).toBe("continue-1");
  });

  it("state-changed clears continuation identity before re-resolve", () => {
    const state = recoveryUiReducer(
      { ...initialRecoveryUiState, continuationOperationId: "continue-1" },
      { type: "STATE_CHANGED" }
    );
    expect(state).toMatchObject({ phase: "resolving", continuationOperationId: null });
  });

  it("continuation conflict fails closed into support", () => {
    expect(recoveryUiReducer(initialRecoveryUiState, { type: "CONTINUATION_CONFLICT" }))
      .toMatchObject({
        phase: "support_required",
        errorCode: "CONTINUATION_OPERATION_CONFLICT"
      });
  });

  it.each([
    ["OPEN_PRE", "https://evil.test/tests/example"],
    ["OPEN_PRE", "//evil.test/tests/example"],
    ["OPEN_ATTEMPT", "/results/11111111-1111-4111-8111-111111111111"],
    ["OPEN_RESULT", "/results/not-a-uuid"],
    ["OPEN_PRE", "/tests/example?email=user@example.test"]
  ] as const)("rejects unsafe or mismatched destination %s %s", (action, url) => {
    expect(isAllowedRecoveryNextUrl(action, url)).toBe(false);
  });

  it.each([
    ["OPEN_PRE", "/tests/russian-training-variant-01"],
    ["OPEN_ATTEMPT", "/attempts/11111111-1111-4111-8111-111111111111"],
    ["OPEN_RESULT", "/results/11111111-1111-4111-8111-111111111111"]
  ] as const)("accepts an expected internal destination %s %s", (action, url) => {
    expect(isAllowedRecoveryNextUrl(action, url)).toBe(true);
    expect(parseContinuationResponse({ nextAction: action, nextUrl: url })).toEqual({
      nextAction: action,
      nextUrl: url
    });
  });

  it("feature unavailable hides the flow", () => {
    expect(recoveryUiReducer(initialRecoveryUiState, { type: "FEATURE_UNAVAILABLE" }).phase)
      .toBe("feature_unavailable");
  });

  it("cancel resets all local state", () => {
    const dirty = {
      ...initialRecoveryUiState,
      phase: "attempt_active" as const,
      maskedEmail: "b***r@example.test",
      continuationOperationId: "continue-1"
    };
    expect(recoveryUiReducer(dirty, { type: "CANCEL" })).toEqual(initialRecoveryUiState);
  });

  it("state contains no raw OTP or recovery/session token", () => {
    const serialized = JSON.stringify(initialRecoveryUiState);
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toMatch(/recoveryToken|sessionToken|rawToken/i);
  });

  it("malformed success payloads fail validation", () => {
    expect(parseChallengeResponse({ state: "code_sent", resendAfterSeconds: "60" })).toBeNull();
    expect(parseChallengeResponse({
      state: "code_sent",
      messageKey: "email.sent_neutral",
      resendAfterSeconds: 60,
      accessExists: true
    })).toBeNull();
    expect(parseRecoveryStateResponse({ state: "attempt_active", screen: "REC-02", nextAction: "CONTINUE" })).toBeNull();
    expect(parseRecoveryStateResponse({
      state: "attempt_active",
      screen: "REC-01",
      nextAction: "CONTINUE",
      rawRecoveryToken: "forbidden"
    })).toBeNull();
    expect(parseContinuationResponse({ nextAction: "OPEN_RESULT", nextUrl: "javascript:alert(1)" })).toBeNull();
  });

  it("uses allowlisted copy and a generic fallback", () => {
    expect(safeRecoveryErrorText("CODE_INVALID")).toContain("Код не подошёл");
    expect(safeRecoveryErrorText("INTERNAL_DATABASE_IDENTIFIER_123"))
      .toBe("Восстановление временно недоступно. Попробуйте ещё раз.");
  });
});

describe("recovery UI server availability", () => {
  it("is off by default", () => {
    expect(resolveRecoveryUiAvailability({})).toEqual({ available: false });
  });

  it("exposes only the server product code for a valid test configuration", () => {
    expect(resolveRecoveryUiAvailability(enabledEnvironment())).toEqual({
      available: true,
      productCode: "russian-training-variant-01"
    });
  });

  it.each([
    ["missing APP_URL", undefined],
    ["a malformed APP_URL", "not-a-url"],
    ["an unsupported protocol", "ftp://localhost:3000"],
    ["a username", "http://user@localhost:3000"],
    ["a password", "http://user:secret@localhost:3000"],
    ["a non-root path", "http://localhost:3000/recovery"],
    ["a query", "http://localhost:3000/?mode=recovery"],
    ["a hash", "http://localhost:3000/#recovery"]
  ])("fails closed for %s", (_case, appUrl) => {
    expect(resolveRecoveryUiAvailability(enabledEnvironment({
      APP_URL: appUrl
    }))).toEqual({ available: false });
  });

  it.each([
    "http://localhost:3000",
    "http://localhost:3000/",
    "https://tests.example.com"
  ])("accepts a canonicalizable trusted origin: %s", (appUrl) => {
    expect(resolveRecoveryUiAvailability(enabledEnvironment({
      APP_URL: appUrl
    }))).toEqual({
      available: true,
      productCode: "russian-training-variant-01"
    });
  });

  it.each(["off", "shadow"])("requires verified commercial enforce mode: %s", (mode) => {
    expect(resolveRecoveryUiAvailability(enabledEnvironment({
      VERIFIED_COMMERCIAL_SESSION_MODE: mode
    }))).toEqual({ available: false });
  });

  it.each(["production", "preview", "staging"])("fails closed in %s", (environment) => {
    expect(resolveRecoveryUiAvailability(enabledEnvironment({
      NODE_ENV: "test",
      APP_ENV: environment
    }))).toEqual({ available: false });
  });

  it("fails closed on invalid recovery config", () => {
    expect(resolveRecoveryUiAvailability(enabledEnvironment({
      RECOVERY_OTP_HMAC_KEY_RING: "invalid"
    }))).toEqual({ available: false });
  });
});
