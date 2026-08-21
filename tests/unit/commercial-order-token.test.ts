import { describe, expect, it } from "vitest";
import {
  commercialOrderTokenSecret,
  deriveCommercialOrderLookupToken,
  hashLookupToken,
  lookupTokenMatches
} from "@/lib/commercial/security";

const secret = "synthetic-commercial-order-token-secret-32-bytes";
const context = {
  orderId: "11111111-1111-4111-8111-111111111111",
  checkoutFlowId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "idempotency-key-0001"
};

describe("commercial order lookup token", () => {
  it("is deterministic for the same immutable context and secret", () => {
    expect(deriveCommercialOrderLookupToken(context, secret))
      .toBe(deriveCommercialOrderLookupToken(context, secret));
  });

  it("changes with the order ID", () => {
    expect(deriveCommercialOrderLookupToken(context, secret)).not.toBe(deriveCommercialOrderLookupToken({
      ...context,
      orderId: "33333333-3333-4333-8333-333333333333"
    }, secret));
  });

  it("changes with the checkout flow ID", () => {
    expect(deriveCommercialOrderLookupToken(context, secret)).not.toBe(deriveCommercialOrderLookupToken({
      ...context,
      checkoutFlowId: "44444444-4444-4444-8444-444444444444"
    }, secret));
  });

  it("changes with the idempotency key", () => {
    expect(deriveCommercialOrderLookupToken(context, secret)).not.toBe(deriveCommercialOrderLookupToken({
      ...context,
      idempotencyKey: "idempotency-key-0002"
    }, secret));
  });

  it("changes with the dedicated secret", () => {
    expect(deriveCommercialOrderLookupToken(context, secret)).not.toBe(deriveCommercialOrderLookupToken(
      context,
      "different-commercial-order-token-secret-32-bytes"
    ));
  });

  it("uses a versioned 256-bit base64url format", () => {
    expect(deriveCommercialOrderLookupToken(context, secret)).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
  });

  it("stores and verifies only the SHA-256 token hash", () => {
    const token = deriveCommercialOrderLookupToken(context, secret);
    const storedHash = hashLookupToken(token);
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toContain(token);
    expect(lookupTokenMatches(token, storedHash)).toBe(true);
  });

  it.each(["email", "ip", "userAgent"])("rejects forbidden context field %s", (field) => {
    expect(() => deriveCommercialOrderLookupToken({
      ...context,
      [field]: "forbidden"
    }, secret)).toThrow("COMMERCIAL_ORDER_TOKEN_CONTEXT_INVALID");
  });

  it("requires a dedicated secret of at least 32 bytes", () => {
    expect(() => commercialOrderTokenSecret({ COMMERCIAL_ORDER_TOKEN_HMAC_KEY: "short" }))
      .toThrow("COMMERCIAL_ORDER_TOKEN_CONFIGURATION_INVALID");
    expect(commercialOrderTokenSecret({ COMMERCIAL_ORDER_TOKEN_HMAC_KEY: secret })).toBe(secret);
  });
});
