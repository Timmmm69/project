import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderTokenContextKeys = new Set(["orderId", "checkoutFlowId", "idempotencyKey"]);

export type CommercialOrderTokenContext = Readonly<{
  orderId: string;
  checkoutFlowId: string;
  idempotencyKey: string;
}>;

export function normalizeCommercialEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createLookupToken() {
  return randomBytes(32).toString("base64url");
}

export function commercialOrderTokenSecret(env: Record<string, string | undefined> = process.env) {
  const secret = env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("COMMERCIAL_ORDER_TOKEN_CONFIGURATION_INVALID");
  }
  return secret;
}

export function deriveCommercialOrderLookupToken(
  context: CommercialOrderTokenContext,
  secret = commercialOrderTokenSecret()
) {
  if (Object.keys(context).length !== orderTokenContextKeys.size ||
      Object.keys(context).some((key) => !orderTokenContextKeys.has(key)) ||
      !uuidV4.test(context.orderId) ||
      !uuidV4.test(context.checkoutFlowId) ||
      context.idempotencyKey.length < 16 || context.idempotencyKey.length > 200) {
    throw new Error("COMMERCIAL_ORDER_TOKEN_CONTEXT_INVALID");
  }
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("COMMERCIAL_ORDER_TOKEN_CONFIGURATION_INVALID");
  }
  const payload = JSON.stringify([
    "commercial-order-token:v1",
    context.orderId,
    context.checkoutFlowId,
    context.idempotencyKey
  ]);
  return `v1.${createHmac("sha256", secret).update(payload, "utf8").digest("base64url")}`;
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
