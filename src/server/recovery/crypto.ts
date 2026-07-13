import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { RecoveryKeyRing } from "@/server/recovery/config";

export const RECOVERY_TOKEN_BYTES = 32;
export const RECOVERY_OTP_PATTERN = /^\d{6}$/;

export const RECOVERY_DOMAIN_SEPARATORS = {
  emailFingerprint: "acc01a-recovery-email-fingerprint:v1",
  requestSource: "acc01a-recovery-request-source:v1",
  verifySource: "acc01a-recovery-verify-source:v1",
  challengeToken: "acc01a-recovery-challenge-token:v1",
  otpMac: "acc01a-recovery-otp-mac:v1",
  sessionToken: "acc01a-recovery-session-token:v1"
} as const;

type RecoveryOpaqueTokenPrefix = "rc1" | "rs1";

export type RecoveryCryptoErrorCode =
  | "TOKEN_MALFORMED"
  | "TOKEN_UNKNOWN_KEY"
  | "OTP_MALFORMED"
  | "FIELD_TOO_LARGE";

export class RecoveryCryptoError extends Error {
  constructor(readonly code: RecoveryCryptoErrorCode) {
    super(`RECOVERY_CRYPTO_OPERATION_REJECTED:${code}`);
    this.name = "RecoveryCryptoError";
  }
}

const keyVersionPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const tokenSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const digestPattern = /^[a-f0-9]{64}$/;

export function encodeLengthDelimited(fields: readonly string[]) {
  const encoded = fields.map((field) => Buffer.from(field, "utf8"));
  const chunks: Buffer[] = [];
  for (const field of encoded) {
    if (field.length > 0xffffffff) {
      throw new RecoveryCryptoError("FIELD_TOO_LARGE");
    }
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(field.length, 0);
    chunks.push(length, field);
  }
  return Buffer.concat(chunks);
}

function hmacHex(key: Buffer, fields: readonly string[]) {
  return createHmac("sha256", key).update(encodeLengthDelimited(fields)).digest("hex");
}

function getKey(ring: RecoveryKeyRing, version: string) {
  const key = ring.keys.get(version);
  if (!key) {
    throw new RecoveryCryptoError("TOKEN_UNKNOWN_KEY");
  }
  return key;
}

export function createEmailFingerprint(normalizedEmail: string, ring: RecoveryKeyRing) {
  return hmacHex(getKey(ring, ring.activeKeyVersion), [
    RECOVERY_DOMAIN_SEPARATORS.emailFingerprint,
    normalizedEmail
  ]);
}

export function createRecoverySourceDigest(
  rawSource: string,
  ring: RecoveryKeyRing,
  purpose: "request" | "verify"
) {
  return hmacHex(getKey(ring, ring.activeKeyVersion), [
    purpose === "request" ? RECOVERY_DOMAIN_SEPARATORS.requestSource : RECOVERY_DOMAIN_SEPARATORS.verifySource,
    rawSource
  ]);
}

export function generateRecoveryOtp(randomInteger: (max: number) => number = randomInt) {
  return randomInteger(1_000_000).toString().padStart(6, "0");
}

export type RecoveryOtpMacInput = Readonly<{
  challengeId: string;
  commercialProductId: string;
  testId: string;
  normalizedEmail: string;
  otp: string;
}>;

export function createRecoveryOtpMac(
  otpInput: RecoveryOtpMacInput,
  keyVersion: string,
  ring: RecoveryKeyRing
) {
  if (!RECOVERY_OTP_PATTERN.test(otpInput.otp)) {
    throw new RecoveryCryptoError("OTP_MALFORMED");
  }
  return hmacHex(getKey(ring, keyVersion), [
    RECOVERY_DOMAIN_SEPARATORS.otpMac,
    otpInput.challengeId,
    otpInput.commercialProductId,
    otpInput.testId,
    otpInput.normalizedEmail,
    otpInput.otp
  ]);
}

export function secretDigestsEqual(actual: string, expected: string) {
  if (!digestPattern.test(actual) || !digestPattern.test(expected)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function createOpaqueToken(prefix: RecoveryOpaqueTokenPrefix, keyVersion: string) {
  if (!keyVersionPattern.test(keyVersion)) {
    throw new RecoveryCryptoError("TOKEN_MALFORMED");
  }
  return `${prefix}.${keyVersion}.${randomBytes(RECOVERY_TOKEN_BYTES).toString("base64url")}`;
}

function parseOpaqueToken(
  rawToken: string,
  expectedPrefix: RecoveryOpaqueTokenPrefix,
  ring: RecoveryKeyRing
) {
  const parts = rawToken.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== expectedPrefix ||
    !keyVersionPattern.test(parts[1] ?? "") ||
    !tokenSecretPattern.test(parts[2] ?? "")
  ) {
    throw new RecoveryCryptoError("TOKEN_MALFORMED");
  }
  const keyVersion = parts[1];
  const secretText = parts[2];
  const secret = Buffer.from(secretText, "base64url");
  if (secret.length !== RECOVERY_TOKEN_BYTES || secret.toString("base64url") !== secretText) {
    throw new RecoveryCryptoError("TOKEN_MALFORMED");
  }
  getKey(ring, keyVersion);
  return { keyVersion, secret } as const;
}

function digestOpaqueToken(
  rawToken: string,
  prefix: RecoveryOpaqueTokenPrefix,
  domainSeparator: string,
  ring: RecoveryKeyRing
) {
  const parsed = parseOpaqueToken(rawToken, prefix, ring);
  return {
    keyVersion: parsed.keyVersion,
    digest: hmacHex(getKey(ring, parsed.keyVersion), [domainSeparator, rawToken])
  } as const;
}

export function createRecoveryChallengeToken(keyVersion: string) {
  return createOpaqueToken("rc1", keyVersion);
}

export function parseRecoveryChallengeToken(rawToken: string, ring: RecoveryKeyRing) {
  return parseOpaqueToken(rawToken, "rc1", ring);
}

export function digestRecoveryChallengeToken(rawToken: string, ring: RecoveryKeyRing) {
  return digestOpaqueToken(rawToken, "rc1", RECOVERY_DOMAIN_SEPARATORS.challengeToken, ring);
}

export function createRecoverySessionToken(keyVersion: string) {
  return createOpaqueToken("rs1", keyVersion);
}

export function parseRecoverySessionToken(rawToken: string, ring: RecoveryKeyRing) {
  return parseOpaqueToken(rawToken, "rs1", ring);
}

export function digestRecoverySessionToken(rawToken: string, ring: RecoveryKeyRing) {
  return digestOpaqueToken(rawToken, "rs1", RECOVERY_DOMAIN_SEPARATORS.sessionToken, ring);
}
