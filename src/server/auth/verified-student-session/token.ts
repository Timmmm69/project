import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";

export const VERIFIED_STUDENT_SESSION_TOKEN_BYTES = 32;
export const VERIFIED_STUDENT_SESSION_DOMAIN_SEPARATOR = "verified-student-session:v1";

const tokenPrefix = "vs1";
const keyVersionPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const digestPattern = /^[a-f0-9]{64}$/;

export type VerifiedStudentSessionTokenErrorCode = "MALFORMED" | "UNKNOWN_KEY_VERSION";

export class VerifiedStudentSessionTokenError extends Error {
  constructor(readonly code: VerifiedStudentSessionTokenErrorCode) {
    super(`VERIFIED_STUDENT_SESSION_TOKEN_INVALID:${code}`);
    this.name = "VerifiedStudentSessionTokenError";
  }
}

export type ParsedVerifiedStudentSessionToken = Readonly<{
  keyVersion: string;
  secret: Buffer;
}>;

export function createVerifiedStudentSessionToken(keyVersion: string) {
  if (!keyVersionPattern.test(keyVersion)) {
    throw new VerifiedStudentSessionTokenError("MALFORMED");
  }
  return `${tokenPrefix}.${keyVersion}.${randomBytes(VERIFIED_STUDENT_SESSION_TOKEN_BYTES).toString("base64url")}`;
}

export function parseVerifiedStudentSessionToken(
  rawToken: string,
  keys: ReadonlyMap<string, Buffer>
): ParsedVerifiedStudentSessionToken {
  const parts = rawToken.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== tokenPrefix ||
    !keyVersionPattern.test(parts[1] ?? "") ||
    !secretPattern.test(parts[2] ?? "")
  ) {
    throw new VerifiedStudentSessionTokenError("MALFORMED");
  }

  const keyVersion = parts[1];
  const secretText = parts[2];
  const secret = Buffer.from(secretText, "base64url");
  if (
    secret.length !== VERIFIED_STUDENT_SESSION_TOKEN_BYTES ||
    secret.toString("base64url") !== secretText
  ) {
    throw new VerifiedStudentSessionTokenError("MALFORMED");
  }
  if (!keys.has(keyVersion)) {
    throw new VerifiedStudentSessionTokenError("UNKNOWN_KEY_VERSION");
  }

  return { keyVersion, secret };
}

export function digestVerifiedStudentSessionToken(
  rawToken: string,
  config: Pick<VerifiedStudentSessionConfig, "keys">
) {
  const parsed = parseVerifiedStudentSessionToken(rawToken, config.keys);
  const key = config.keys.get(parsed.keyVersion);
  if (!key) {
    throw new VerifiedStudentSessionTokenError("UNKNOWN_KEY_VERSION");
  }
  return createHmac("sha256", key)
    .update(VERIFIED_STUDENT_SESSION_DOMAIN_SEPARATOR, "utf8")
    .update(rawToken, "utf8")
    .digest("hex");
}

export function verifiedStudentSessionDigestsEqual(actual: string, expected: string) {
  if (!digestPattern.test(actual) || !digestPattern.test(expected)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
