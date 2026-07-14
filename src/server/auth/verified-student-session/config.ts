import { timingSafeEqual } from "node:crypto";

export type VerifiedCommercialSessionMode = "off" | "shadow" | "enforce";

export type VerifiedStudentSessionConfig = Readonly<{
  mode: VerifiedCommercialSessionMode;
  activeKeyVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}>;

export type VerifiedStudentSessionConfigErrorCode =
  | "MODE_INVALID"
  | "KEY_RING_MISSING"
  | "KEY_RING_MALFORMED"
  | "KEY_VERSION_DUPLICATE"
  | "KEY_VALUE_DUPLICATE"
  | "KEY_VALUE_TOO_SHORT"
  | "KEY_VALUE_REUSED"
  | "ACTIVE_KEY_MISSING"
  | "ACTIVE_KEY_UNKNOWN"
  | "PRODUCTION_PLACEHOLDER";

export class VerifiedStudentSessionConfigError extends Error {
  constructor(readonly code: VerifiedStudentSessionConfigErrorCode) {
    super(`VERIFIED_STUDENT_SESSION_CONFIGURATION_INVALID:${code}`);
    this.name = "VerifiedStudentSessionConfigError";
  }
}

const keyVersionPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const productionLikeValues = new Set(["production", "prod", "preview", "staging", "stage"]);
const placeholderPattern = /(change.?me|dev.?only|example|placeholder|replace|synthetic|test.?only|test.?secret)/i;
const forbiddenSecretNames = [
  "SESSION_SECRET",
  "ACCESS_CODE_HASH_PEPPER",
  "COMMERCIAL_ORDER_TOKEN_HMAC_KEY",
  "ORDER_TOKEN_HMAC_KEY",
  "ANALYTICS_ID_HMAC_KEY",
  "RECOVERY_OTP_HMAC_KEY",
  "RECOVERY_OTP_HMAC_KEY_RING",
  "RECOVERY_CHALLENGE_TOKEN_HMAC_KEY",
  "RECOVERY_CHALLENGE_TOKEN_HMAC_KEY_RING",
  "RECOVERY_SESSION_TOKEN_HMAC_KEY",
  "RECOVERY_SESSION_TOKEN_HMAC_KEY_RING",
  "RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY",
  "RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING"
] as const;

function buffersEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodeCanonicalBase64Url(value: string) {
  if (!base64UrlPattern.test(value)) {
    throw new VerifiedStudentSessionConfigError("KEY_RING_MALFORMED");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new VerifiedStudentSessionConfigError("KEY_RING_MALFORMED");
  }
  return decoded;
}

function productionLike(env: Record<string, string | undefined>) {
  return [env.NODE_ENV, env.VERCEL_ENV, env.DEPLOYMENT_ENV, env.APP_ENV]
    .some((value) => value !== undefined && productionLikeValues.has(value.trim().toLowerCase()));
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

export function parseVerifiedCommercialSessionMode(
  value: string | undefined
): VerifiedCommercialSessionMode {
  const mode = value?.trim() || "off";
  if (mode !== "off" && mode !== "shadow" && mode !== "enforce") {
    throw new VerifiedStudentSessionConfigError("MODE_INVALID");
  }
  return mode;
}

export function parseVerifiedStudentSessionConfig(
  env: Record<string, string | undefined> = process.env
): VerifiedStudentSessionConfig {
  const mode = parseVerifiedCommercialSessionMode(env.VERIFIED_COMMERCIAL_SESSION_MODE);
  const rawKeyRing = env.VERIFIED_STUDENT_SESSION_HMAC_KEY_RING?.trim();
  if (!rawKeyRing) {
    throw new VerifiedStudentSessionConfigError("KEY_RING_MISSING");
  }

  const entries = rawKeyRing.split(",");
  if (entries.some((entry) => entry.trim().length === 0)) {
    throw new VerifiedStudentSessionConfigError("KEY_RING_MALFORMED");
  }

  const keys = new Map<string, Buffer>();
  const keyValues: Buffer[] = [];
  const isProductionLike = productionLike(env);
  const externalSecrets = forbiddenSecretNames.flatMap((name) => {
    const value = env[name];
    return value ? externalSecretCandidates(value) : [];
  });

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator !== entry.lastIndexOf(":")) {
      throw new VerifiedStudentSessionConfigError("KEY_RING_MALFORMED");
    }

    const version = entry.slice(0, separator);
    const encodedKey = entry.slice(separator + 1);
    if (!keyVersionPattern.test(version) || !encodedKey) {
      throw new VerifiedStudentSessionConfigError("KEY_RING_MALFORMED");
    }
    if (keys.has(version)) {
      throw new VerifiedStudentSessionConfigError("KEY_VERSION_DUPLICATE");
    }

    const key = decodeCanonicalBase64Url(encodedKey);
    if (key.length < 32 || key.length > 128) {
      throw new VerifiedStudentSessionConfigError("KEY_VALUE_TOO_SHORT");
    }
    if (keyValues.some((value) => buffersEqual(value, key))) {
      throw new VerifiedStudentSessionConfigError("KEY_VALUE_DUPLICATE");
    }
    if (externalSecrets.some((value) => buffersEqual(value, key) || value.toString("utf8") === encodedKey)) {
      throw new VerifiedStudentSessionConfigError("KEY_VALUE_REUSED");
    }
    if (isProductionLike && (placeholderPattern.test(encodedKey) || placeholderPattern.test(key.toString("utf8")))) {
      throw new VerifiedStudentSessionConfigError("PRODUCTION_PLACEHOLDER");
    }

    keys.set(version, key);
    keyValues.push(key);
  }

  const activeKeyVersion = env.VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION?.trim();
  if (!activeKeyVersion) {
    throw new VerifiedStudentSessionConfigError("ACTIVE_KEY_MISSING");
  }
  if (!keyVersionPattern.test(activeKeyVersion) || !keys.has(activeKeyVersion)) {
    throw new VerifiedStudentSessionConfigError("ACTIVE_KEY_UNKNOWN");
  }

  return {
    mode,
    activeKeyVersion,
    keys
  };
}
