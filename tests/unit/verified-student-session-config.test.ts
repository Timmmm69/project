import { describe, expect, it } from "vitest";
import {
  parseVerifiedStudentSessionConfig,
  VerifiedStudentSessionConfigError
} from "@/server/auth/verified-student-session/config";

function encodedKey(fill: string) {
  return Buffer.from(fill.repeat(32), "utf8").toString("base64url");
}

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v1",
    VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${encodedKey("a")}`,
    ...overrides
  };
}

function expectConfigError(env: Record<string, string | undefined>, code: string) {
  try {
    parseVerifiedStudentSessionConfig(env);
    throw new Error("EXPECTED_CONFIG_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(VerifiedStudentSessionConfigError);
    expect((error as VerifiedStudentSessionConfigError).code).toBe(code);
    expect(String(error)).not.toContain(env.VERIFIED_STUDENT_SESSION_HMAC_KEY_RING ?? "not-present");
  }
}

describe("verified student session configuration", () => {
  it("defaults the disconnected mode to off", () => {
    expect(parseVerifiedStudentSessionConfig(validEnv()).mode).toBe("off");
  });

  it.each(["off", "shadow", "enforce"] as const)("accepts the %s mode", (mode) => {
    expect(parseVerifiedStudentSessionConfig(validEnv({ VERIFIED_COMMERCIAL_SESSION_MODE: mode })).mode).toBe(mode);
  });

  it("rejects an unknown mode", () => {
    expectConfigError(validEnv({ VERIFIED_COMMERCIAL_SESSION_MODE: "enabled" }), "MODE_INVALID");
  });

  it("rejects a missing key ring", () => {
    expectConfigError(validEnv({ VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: undefined }), "KEY_RING_MISSING");
  });

  it("rejects malformed and non-canonical key values", () => {
    expectConfigError(validEnv({ VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: "v1:not+base64" }), "KEY_RING_MALFORMED");
  });

  it("rejects key values shorter than 32 bytes", () => {
    const short = Buffer.from("too-short", "utf8").toString("base64url");
    expectConfigError(validEnv({ VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${short}` }), "KEY_VALUE_TOO_SHORT");
  });

  it("rejects duplicate key versions", () => {
    expectConfigError(validEnv({
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${encodedKey("a")},v1:${encodedKey("b")}`
    }), "KEY_VERSION_DUPLICATE");
  });

  it("rejects duplicate key values across versions", () => {
    expectConfigError(validEnv({
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${encodedKey("a")},v2:${encodedKey("a")}`
    }), "KEY_VALUE_DUPLICATE");
  });

  it("requires an explicitly selected known active version", () => {
    expectConfigError(validEnv({ VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: undefined }), "ACTIVE_KEY_MISSING");
    expectConfigError(validEnv({ VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v2" }), "ACTIVE_KEY_UNKNOWN");
  });

  it.each([
    "SESSION_SECRET",
    "ACCESS_CODE_HASH_PEPPER",
    "COMMERCIAL_ORDER_TOKEN_HMAC_KEY",
    "ANALYTICS_ID_HMAC_KEY",
    "RECOVERY_OTP_HMAC_KEY"
  ])("rejects reuse of %s", (name) => {
    expectConfigError(validEnv({ [name]: "a".repeat(32) }), "KEY_VALUE_REUSED");
  });

  it("rejects placeholder or test key material in a production-like environment", () => {
    const placeholder = Buffer.from("synthetic-test-placeholder-secret-value", "utf8").toString("base64url");
    expectConfigError(validEnv({
      NODE_ENV: "production",
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${placeholder}`
    }), "PRODUCTION_PLACEHOLDER");
  });
});
