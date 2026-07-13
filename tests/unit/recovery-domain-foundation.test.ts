import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { normalizeEmail, normalizedEmailSchema } from "@/lib/validation/email";
import {
  parseRecoveryConfig,
  RecoveryConfigError,
  type RecoveryKeyRing
} from "@/server/recovery/config";
import {
  createEmailFingerprint,
  createRecoveryChallengeToken,
  createRecoveryOtpMac,
  createRecoverySessionToken,
  createRecoverySourceDigest,
  digestRecoveryChallengeToken,
  digestRecoverySessionToken,
  generateRecoveryOtp,
  parseRecoveryChallengeToken,
  parseRecoverySessionToken,
  RecoveryCryptoError
} from "@/server/recovery/crypto";
import {
  createFakeDevelopmentRecoveryMailer,
  createTestRecoveryMailbox,
  RecoveryMailerEnvironmentError
} from "@/server/recovery/mailer";
import {
  isBeforeRecoveryExpiry,
  RECOVERY_FAILED_VERIFY_LIMIT,
  RECOVERY_OTP_TTL_MS,
  RECOVERY_RESEND_COOLDOWN_MS,
  RECOVERY_SESSION_ABSOLUTE_TTL_MS,
  createRecoveryDomainService,
  recoveryOtpExpiresAt,
  recoveryResendAvailableAt,
  recoverySessionExpiresAt
} from "@/server/recovery/service";
import {
  normalizeRecoveryTiming,
  RECOVERY_MAXIMUM_JITTER_MS,
  RECOVERY_MINIMUM_ELAPSED_MS,
  RecoveryTimingError
} from "@/server/recovery/timing";

function encoded(byte: number) {
  return Buffer.alloc(32, byte).toString("base64url");
}

function enabledEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    ACC_01A_RECOVERY_ENABLED: "true",
    RECOVERY_MAILER_MODE: "test",
    VERIFIED_COMMERCIAL_SESSION_MODE: "enforce",
    RECOVERY_COMMERCIAL_PRODUCT_CODE: "russian-training-variant-01",
    RECOVERY_EMAIL_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING: `v1:${encoded(1)}`,
    RECOVERY_CHALLENGE_TOKEN_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_CHALLENGE_TOKEN_HMAC_KEY_RING: `v1:${encoded(2)}`,
    RECOVERY_OTP_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_OTP_HMAC_KEY_RING: `v1:${encoded(3)}`,
    RECOVERY_SESSION_TOKEN_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_SESSION_TOKEN_HMAC_KEY_RING: `v1:${encoded(4)}`,
    ...overrides
  };
}

function ring(byte = 9, version = "v1"): RecoveryKeyRing {
  return {
    activeKeyVersion: version,
    keys: new Map([[version, Buffer.alloc(32, byte)]])
  };
}

describe("ACC-01A recovery foundation", () => {
  it("normalizes email through trim and lowercase", () => {
    expect(normalizeEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
    expect(normalizedEmailSchema.parse("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });

  it("rejects malformed email", () => {
    expect(normalizedEmailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("generates exactly six numeric OTP digits with the OS CSPRNG path", () => {
    const codes = Array.from({ length: 200 }, () => generateRecoveryOtp());
    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1);
  });

  it("keeps OTP MAC bound to challenge, product, test, email and OTP", () => {
    const keyRing = ring();
    const base = {
      challengeId: "11111111-1111-4111-8111-111111111111",
      commercialProductId: "22222222-2222-4222-8222-222222222222",
      testId: "33333333-3333-4333-8333-333333333333",
      normalizedEmail: "buyer@example.test",
      otp: "123456"
    };
    const expected = createRecoveryOtpMac(base, "v1", keyRing);
    expect(createRecoveryOtpMac({ ...base, challengeId: "44444444-4444-4444-8444-444444444444" }, "v1", keyRing))
      .not.toBe(expected);
    expect(createRecoveryOtpMac({ ...base, otp: "123457" }, "v1", keyRing)).not.toBe(expected);
  });

  it("uses distinct domains for email, source, challenge, OTP and session material", () => {
    const keyRing = ring();
    const challenge = createRecoveryChallengeToken("v1");
    const session = createRecoverySessionToken("v1");
    const values = [
      createEmailFingerprint("buyer@example.test", keyRing),
      createRecoverySourceDigest("buyer@example.test", keyRing, "request"),
      createRecoverySourceDigest("buyer@example.test", keyRing, "verify"),
      digestRecoveryChallengeToken(challenge, keyRing).digest,
      digestRecoverySessionToken(session, keyRing).digest,
      createRecoveryOtpMac({
        challengeId: "11111111-1111-4111-8111-111111111111",
        commercialProductId: "22222222-2222-4222-8222-222222222222",
        testId: "33333333-3333-4333-8333-333333333333",
        normalizedEmail: "buyer@example.test",
        otp: "123456"
      }, "v1", keyRing)
    ];
    expect(new Set(values).size).toBe(values.length);
  });

  it("parses four independent dedicated key rings", () => {
    const config = parseRecoveryConfig(enabledEnvironment());
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("expected enabled config");
    const keyValues = Object.values(config.keyRings).map((keyRing) => (
      keyRing.keys.get(keyRing.activeKeyVersion)?.toString("hex")
    ));
    expect(new Set(keyValues).size).toBe(4);
  });

  it("fails closed when recovery key material is reused between rings", () => {
    expect(() => parseRecoveryConfig(enabledEnvironment({
      RECOVERY_SESSION_TOKEN_HMAC_KEY_RING: `v1:${encoded(1)}`
    }))).toThrowError(expect.objectContaining<Partial<RecoveryConfigError>>({ code: "KEY_VALUE_DUPLICATE" }));
  });

  it("fails closed when recovery key material reuses the verified-session ring", () => {
    expect(() => parseRecoveryConfig(enabledEnvironment({
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v9:${encoded(2)}`
    }))).toThrowError(expect.objectContaining<Partial<RecoveryConfigError>>({ code: "KEY_VALUE_REUSED" }));
  });

  it("strictly parses challenge token prefix, shape and length", () => {
    const keyRing = ring();
    const token = createRecoveryChallengeToken("v1");
    expect(token).toMatch(/^rc1\.v1\.[A-Za-z0-9_-]{43}$/);
    expect(parseRecoveryChallengeToken(token, keyRing).secret).toHaveLength(32);
    expect(() => parseRecoveryChallengeToken(token.replace("rc1", "rs1"), keyRing))
      .toThrowError(expect.objectContaining<Partial<RecoveryCryptoError>>({ code: "TOKEN_MALFORMED" }));
  });

  it("strictly parses recovery-session token prefix, shape and length", () => {
    const keyRing = ring();
    const token = createRecoverySessionToken("v1");
    expect(token).toMatch(/^rs1\.v1\.[A-Za-z0-9_-]{43}$/);
    expect(parseRecoverySessionToken(token, keyRing).secret).toHaveLength(32);
    expect(() => parseRecoverySessionToken(`${token}x`, keyRing))
      .toThrowError(expect.objectContaining<Partial<RecoveryCryptoError>>({ code: "TOKEN_MALFORMED" }));
  });

  it("rejects unknown token key versions", () => {
    const token = createRecoverySessionToken("v2");
    expect(() => parseRecoverySessionToken(token, ring()))
      .toThrowError(expect.objectContaining<Partial<RecoveryCryptoError>>({ code: "TOKEN_UNKNOWN_KEY" }));
  });

  it("uses a ten-minute inclusive expiry boundary", () => {
    const issuedAt = new Date("2026-07-13T12:00:00.000Z");
    const expiresAt = recoveryOtpExpiresAt(issuedAt);
    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(RECOVERY_OTP_TTL_MS);
    expect(isBeforeRecoveryExpiry(new Date(expiresAt.getTime() - 1), expiresAt)).toBe(true);
    expect(isBeforeRecoveryExpiry(expiresAt, expiresAt)).toBe(false);
  });

  it("uses an exact sixty-second resend boundary", () => {
    const issuedAt = new Date("2026-07-13T12:00:00.000Z");
    const availableAt = recoveryResendAvailableAt(issuedAt);
    expect(availableAt.getTime() - issuedAt.getTime()).toBe(RECOVERY_RESEND_COOLDOWN_MS);
    expect(isBeforeRecoveryExpiry(new Date(availableAt.getTime() - 1), availableAt)).toBe(true);
    expect(isBeforeRecoveryExpiry(availableAt, availableAt)).toBe(false);
  });

  it("fixes failed verification limit at five", () => {
    expect(RECOVERY_FAILED_VERIFY_LIMIT).toBe(5);
  });

  it("uses a thirty-minute absolute recovery-session TTL without sliding", () => {
    const issuedAt = new Date("2026-07-13T12:00:00.000Z");
    const first = recoverySessionExpiresAt(issuedAt);
    const laterRead = recoverySessionExpiresAt(issuedAt);
    expect(first.getTime() - issuedAt.getTime()).toBe(RECOVERY_SESSION_ABSOLUTE_TTL_MS);
    expect(laterRead).toEqual(first);
    expect(isBeforeRecoveryExpiry(first, first)).toBe(false);
  });

  it("normalizes timing to 300ms plus bounded injected jitter", async () => {
    const startedAt = new Date("2026-07-13T12:00:00.000Z");
    const sleeps: number[] = [];
    const result = await normalizeRecoveryTiming(startedAt, {
      clock: () => new Date(startedAt.getTime() + 100),
      randomJitterMs: () => RECOVERY_MAXIMUM_JITTER_MS,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); }
    });
    expect(result.targetElapsedMs).toBe(RECOVERY_MINIMUM_ELAPSED_MS + RECOVERY_MAXIMUM_JITTER_MS);
    expect(sleeps).toEqual([400]);
  });

  it("rejects timing jitter outside 0-200ms", async () => {
    await expect(normalizeRecoveryTiming(new Date(), { randomJitterMs: () => 201 }))
      .rejects.toBeInstanceOf(RecoveryTimingError);
  });

  it("keeps the feature default-off without requiring recovery secrets", () => {
    expect(parseRecoveryConfig({})).toEqual({ enabled: false });
    expect(parseRecoveryConfig({ ACC_01A_RECOVERY_ENABLED: "false", RECOVERY_MAILER_MODE: "smtp" }))
      .toEqual({ enabled: false });
  });

  it("makes recovery service writes fail closed while the feature is disabled", async () => {
    const service = createRecoveryDomainService({
      client: {} as PrismaClient,
      config: { enabled: false },
      mailer: { async sendVerificationCode() { return { status: "accepted" }; } }
    });
    await expect(service.requestChallenge({
      email: "buyer@example.test",
      productCode: "russian-training-variant-01",
      requestOperationId: "11111111-1111-4111-8111-111111111111",
      source: "unit-source"
    })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });

  it("fails closed for production-like fake/test activation", () => {
    expect(() => parseRecoveryConfig(enabledEnvironment({ NODE_ENV: "production" })))
      .toThrowError(expect.objectContaining<Partial<RecoveryConfigError>>({
        code: "PRODUCTION_LIKE_FORBIDDEN"
      }));
  });

  it("requires verified commercial session enforcement before enabling recovery", () => {
    expect(() => parseRecoveryConfig(enabledEnvironment({ VERIFIED_COMMERCIAL_SESSION_MODE: "shadow" })))
      .toThrowError(expect.objectContaining<Partial<RecoveryConfigError>>({
        code: "VERIFIED_SESSION_ENFORCEMENT_REQUIRED"
      }));
  });

  it("pops test mailbox messages once in deterministic order", async () => {
    const mailbox = createTestRecoveryMailbox({ environment: "test" });
    const message = {
      recipient: "buyer@example.test",
      code: "123456",
      expiresAt: new Date(Date.now() + 60_000),
      correlationId: "11111111-1111-4111-8111-111111111111"
    };
    await mailbox.mailer.sendVerificationCode(message);
    expect(mailbox.pop(message.correlationId)).toEqual(message);
    expect(mailbox.pop(message.correlationId)).toBeNull();
    expect(mailbox.size()).toBe(0);
  });

  it("expires and cleans test mailbox messages with the injected clock", async () => {
    let now = new Date("2026-07-13T12:00:00.000Z");
    const mailbox = createTestRecoveryMailbox({
      environment: "test",
      clock: () => new Date(now),
      ttlMs: 1_000
    });
    await mailbox.mailer.sendVerificationCode({
      recipient: "buyer@example.test",
      code: "123456",
      expiresAt: new Date(now.getTime() + 60_000),
      correlationId: "11111111-1111-4111-8111-111111111111"
    });
    now = new Date(now.getTime() + 1_000);
    expect(mailbox.cleanup()).toBe(1);
    expect(mailbox.size()).toBe(0);
  });

  it("fails closed when fake or test adapters are constructed in the wrong environment", () => {
    expect(() => createTestRecoveryMailbox({ environment: "development" }))
      .toThrowError(expect.objectContaining<Partial<RecoveryMailerEnvironmentError>>({
        code: "TEST_MAILER_FORBIDDEN"
      }));
    expect(() => createFakeDevelopmentRecoveryMailer({ environment: "production" }))
      .toThrowError(expect.objectContaining<Partial<RecoveryMailerEnvironmentError>>({
        code: "FAKE_MAILER_FORBIDDEN"
      }));
  });
});
