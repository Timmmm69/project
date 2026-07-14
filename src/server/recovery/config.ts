import { timingSafeEqual } from "node:crypto";

export type RecoveryMailerMode = "fake" | "test";
export type RecoveryKeyPurpose = "emailFingerprint" | "challengeToken" | "otpMac" | "sessionToken";

export type RecoveryKeyRing = Readonly<{
  activeKeyVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}>;

export type DisabledRecoveryConfig = Readonly<{ enabled: false }>;

export type EnabledRecoveryConfig = Readonly<{
  enabled: true;
  mailerMode: RecoveryMailerMode;
  productCode: string;
  keyRings: Readonly<Record<RecoveryKeyPurpose, RecoveryKeyRing>>;
}>;

export type RecoveryConfig = DisabledRecoveryConfig | EnabledRecoveryConfig;

export type RecoveryConfigErrorCode =
  | "FEATURE_FLAG_INVALID"
  | "PRODUCTION_LIKE_FORBIDDEN"
  | "MAILER_MODE_MISSING"
  | "MAILER_MODE_INVALID"
  | "VERIFIED_SESSION_ENFORCEMENT_REQUIRED"
  | "PRODUCT_CODE_MISSING"
  | "PRODUCT_CODE_INVALID"
  | "KEY_RING_MISSING"
  | "KEY_RING_MALFORMED"
  | "KEY_VERSION_DUPLICATE"
  | "KEY_VALUE_DUPLICATE"
  | "KEY_VALUE_TOO_SHORT"
  | "ACTIVE_KEY_MISSING"
  | "ACTIVE_KEY_UNKNOWN"
  | "KEY_VALUE_REUSED";

export class RecoveryConfigError extends Error {
  constructor(readonly code: RecoveryConfigErrorCode) {
    super(`RECOVERY_CONFIGURATION_INVALID:${code}`);
    this.name = "RecoveryConfigError";
  }
}

const keyVersionPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const productCodePattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const productionLikeValues = new Set(["production", "prod", "preview", "staging", "stage"]);

const ringEnvironment = {
  emailFingerprint: {
    ring: "RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING",
    active: "RECOVERY_EMAIL_FINGERPRINT_ACTIVE_KEY_VERSION"
  },
  challengeToken: {
    ring: "RECOVERY_CHALLENGE_TOKEN_HMAC_KEY_RING",
    active: "RECOVERY_CHALLENGE_TOKEN_ACTIVE_KEY_VERSION"
  },
  otpMac: {
    ring: "RECOVERY_OTP_HMAC_KEY_RING",
    active: "RECOVERY_OTP_ACTIVE_KEY_VERSION"
  },
  sessionToken: {
    ring: "RECOVERY_SESSION_TOKEN_HMAC_KEY_RING",
    active: "RECOVERY_SESSION_TOKEN_ACTIVE_KEY_VERSION"
  }
} as const satisfies Record<RecoveryKeyPurpose, { ring: string; active: string }>;

const knownSecretNames = [
  "ADMIN_PASSWORD",
  "ADMIN_PASSWORD_HASH",
  "SESSION_SECRET",
  "ACCESS_CODE_HASH_PEPPER",
  "COMMERCIAL_ORDER_TOKEN_HMAC_KEY",
  "ORDER_TOKEN_HMAC_KEY",
  "ANALYTICS_ID_HMAC_KEY",
  "PAYMENT_WEBHOOK_SECRET",
  "EXPRESSPAY_SECRET",
  "EXPRESSPAY_NOTIFICATION_SECRET",
  "BEPAID_SECRET_KEY",
  "WEBPAY_SECRET_KEY",
  "WEBPAY_SANDBOX_SECRET_KEY",
  "SMTP_PASSWORD",
  "VERIFIED_STUDENT_SESSION_HMAC_KEY_RING",
  "RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY",
  "RECOVERY_CHALLENGE_TOKEN_HMAC_KEY",
  "RECOVERY_OTP_HMAC_KEY",
  "RECOVERY_SESSION_TOKEN_HMAC_KEY"
] as const;

function buffersEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isRecoveryProductionLikeEnvironment(env: Record<string, string | undefined>) {
  return [env.NODE_ENV, env.VERCEL_ENV, env.DEPLOYMENT_ENV, env.APP_ENV]
    .some((value) => value !== undefined && productionLikeValues.has(value.trim().toLowerCase()));
}

function parseEnabled(value: string | undefined) {
  if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "false") {
    return false;
  }
  if (value.trim().toLowerCase() === "true") {
    return true;
  }
  throw new RecoveryConfigError("FEATURE_FLAG_INVALID");
}

function decodeCanonicalBase64Url(value: string) {
  if (!base64UrlPattern.test(value)) {
    throw new RecoveryConfigError("KEY_RING_MALFORMED");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new RecoveryConfigError("KEY_RING_MALFORMED");
  }
  return decoded;
}

function externalSecretCandidates(value: string) {
  const candidates = [Buffer.from(value, "utf8")];
  for (const entry of value.split(",")) {
    const separator = entry.indexOf(":");
    const encoded = separator === -1 ? entry.trim() : entry.slice(separator + 1).trim();
    if (!encoded || !base64UrlPattern.test(encoded)) {
      continue;
    }
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") === encoded) {
      candidates.push(decoded);
    }
  }
  return candidates;
}

function parseKeyRing(
  env: Record<string, string | undefined>,
  purpose: RecoveryKeyPurpose,
  allKeyValues: Buffer[],
  externalSecrets: Buffer[]
): RecoveryKeyRing {
  const names = ringEnvironment[purpose];
  const rawRing = env[names.ring]?.trim();
  if (!rawRing) {
    throw new RecoveryConfigError("KEY_RING_MISSING");
  }
  const entries = rawRing.split(",");
  if (entries.some((entry) => entry.trim().length === 0)) {
    throw new RecoveryConfigError("KEY_RING_MALFORMED");
  }

  const keys = new Map<string, Buffer>();
  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator !== entry.lastIndexOf(":")) {
      throw new RecoveryConfigError("KEY_RING_MALFORMED");
    }
    const version = entry.slice(0, separator);
    const encodedKey = entry.slice(separator + 1);
    if (!keyVersionPattern.test(version) || !encodedKey) {
      throw new RecoveryConfigError("KEY_RING_MALFORMED");
    }
    if (keys.has(version)) {
      throw new RecoveryConfigError("KEY_VERSION_DUPLICATE");
    }

    const key = decodeCanonicalBase64Url(encodedKey);
    if (key.length < 32 || key.length > 128) {
      throw new RecoveryConfigError("KEY_VALUE_TOO_SHORT");
    }
    if (allKeyValues.some((candidate) => buffersEqual(candidate, key))) {
      throw new RecoveryConfigError("KEY_VALUE_DUPLICATE");
    }
    if (externalSecrets.some((candidate) => buffersEqual(candidate, key))) {
      throw new RecoveryConfigError("KEY_VALUE_REUSED");
    }
    keys.set(version, key);
    allKeyValues.push(key);
  }

  const activeKeyVersion = env[names.active]?.trim();
  if (!activeKeyVersion) {
    throw new RecoveryConfigError("ACTIVE_KEY_MISSING");
  }
  if (!keyVersionPattern.test(activeKeyVersion) || !keys.has(activeKeyVersion)) {
    throw new RecoveryConfigError("ACTIVE_KEY_UNKNOWN");
  }
  return { activeKeyVersion, keys };
}

export function parseRecoveryConfig(
  env: Record<string, string | undefined> = process.env
): RecoveryConfig {
  if (!parseEnabled(env.ACC_01A_RECOVERY_ENABLED)) {
    return { enabled: false };
  }
  if (isRecoveryProductionLikeEnvironment(env)) {
    throw new RecoveryConfigError("PRODUCTION_LIKE_FORBIDDEN");
  }

  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase();
  const rawMailerMode = env.RECOVERY_MAILER_MODE?.trim().toLowerCase();
  if (!rawMailerMode) {
    throw new RecoveryConfigError("MAILER_MODE_MISSING");
  }
  const mailerMode = rawMailerMode === "fake" || rawMailerMode === "test" ? rawMailerMode : null;
  if (!mailerMode || (nodeEnvironment === "development" && mailerMode !== "fake") ||
    (nodeEnvironment === "test" && mailerMode !== "test") ||
    (nodeEnvironment !== "development" && nodeEnvironment !== "test")) {
    throw new RecoveryConfigError("MAILER_MODE_INVALID");
  }
  if (env.VERIFIED_COMMERCIAL_SESSION_MODE?.trim() !== "enforce") {
    throw new RecoveryConfigError("VERIFIED_SESSION_ENFORCEMENT_REQUIRED");
  }

  const productCode = env.RECOVERY_COMMERCIAL_PRODUCT_CODE?.trim();
  if (!productCode) {
    throw new RecoveryConfigError("PRODUCT_CODE_MISSING");
  }
  if (!productCodePattern.test(productCode)) {
    throw new RecoveryConfigError("PRODUCT_CODE_INVALID");
  }

  const externalSecrets = knownSecretNames.flatMap((name) => {
    const value = env[name];
    return value ? externalSecretCandidates(value) : [];
  });
  const allKeyValues: Buffer[] = [];
  const keyRings = {
    emailFingerprint: parseKeyRing(env, "emailFingerprint", allKeyValues, externalSecrets),
    challengeToken: parseKeyRing(env, "challengeToken", allKeyValues, externalSecrets),
    otpMac: parseKeyRing(env, "otpMac", allKeyValues, externalSecrets),
    sessionToken: parseKeyRing(env, "sessionToken", allKeyValues, externalSecrets)
  } satisfies Record<RecoveryKeyPurpose, RecoveryKeyRing>;

  return { enabled: true, mailerMode, productCode, keyRings };
}
