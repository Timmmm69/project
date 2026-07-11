import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function normalizeCommercialEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createLookupToken() {
  return randomBytes(32).toString("base64url");
}

export function hashLookupToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function lookupTokenMatches(token: string | undefined, expectedHash: string) {
  if (!token) {
    return false;
  }
  const actual = Buffer.from(hashLookupToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function payloadHash(rawBody: string) {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function redactProviderPayload(payload: Record<string, string>) {
  const allowed = ["wsb_order_num", "wsb_transaction_id", "wsb_result_code", "wsb_total", "wsb_currency_id", "wsb_test"];
  return Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
}
