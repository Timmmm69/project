import { describe, expect, it } from "vitest";
import { sanitizeProviderPayload, containsForbiddenKeys } from "@/lib/commercial/payload-sanitizer";

describe("sanitizeProviderPayload", () => {
  it("preserves primitive values unchanged", () => {
    expect(sanitizeProviderPayload("hello")).toBe("hello");
    expect(sanitizeProviderPayload(42)).toBe(42);
    expect(sanitizeProviderPayload(true)).toBe(true);
    expect(sanitizeProviderPayload(null)).toBeNull();
    expect(sanitizeProviderPayload(undefined)).toBeUndefined();
  });

  it("preserves safe nested objects with allowed fields", () => {
    const input = { status: "paid", merchant_reference: "order-1", amount: 1000, currency: "BYN" };
    expect(sanitizeProviderPayload(input)).toEqual(input);
  });

  it("strips forbidden top-level keys", () => {
    const input = { status: "paid", signature: "abc123", secret: "key" };
    expect(sanitizeProviderPayload(input)).toEqual({ status: "paid" });
  });

  it("strips forbidden keys case-insensitively and across delimiters", () => {
    const input = { Signature: "x", SECRET: "y", "private-key": "z", API_KEY: "w" };
    expect(sanitizeProviderPayload(input)).toEqual({});
  });

  it("strips forbidden payload fields at any nesting depth", () => {
    const input = {
      id: "1",
      nested: {
        PAN: "4111111111111111",
        data: "safe",
        deeper: {
          cvv: "123",
          expiry: "12/30",
          signature: "sig",
          safeField: "ok"
        }
      },
      items: [
        { name: "product", pan: "5555555555554444" },
        { name: "other", signature: "bad" }
      ]
    };
    expect(sanitizeProviderPayload(input)).toEqual({
      id: "1",
      nested: {
        data: "safe",
        deeper: {
          safeField: "ok"
        }
      },
      items: [
        { name: "product" },
        { name: "other" }
      ]
    });
  });

  it("strips all categories of forbidden payment fields", () => {
    const input = {
      pan: "4111111111111111",
      masked_pan: "4111********1111",
      card_number: "5555555555554444",
      cvv: "123",
      cvc: "456",
      cvv2: "789",
      expiry: "12/30",
      expiration: "2025-12",
      exp_date: "12/25",
      "3ds": "data",
      three_ds: "more",
      signature: "abc",
      secret: "key",
      private_key: "pk",
      api_key: "apikey",
      session_token: "st",
      session_id: "sid",
      raw_body: "raw",
      raw_request: "req",
      raw_response: "res",
      request_body: "rb",
      response_body: "rsb",
      raw_payload: "rp",
      payment_url: "https://pay.example.test",
      access_token: "at",
      refresh_token: "rt",
      credential: "creds",
      password: "pwd",
      pwd: "x",
      safe_field: "keep"
    };
    expect(sanitizeProviderPayload(input)).toEqual({ safe_field: "keep" });
  });

  it("handles arrays containing forbidden fields", () => {
    const input = [
      { id: 1, pan: "x" },
      { id: 2, signature: "y" },
      { id: 3, name: "clean" }
    ];
    expect(sanitizeProviderPayload(input)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3, name: "clean" }
    ]);
  });

  it("does not strip normalized payment identifier fields", () => {
    const input = {
      payment_id: "pay-1",
      transaction_id: "txn-1",
      order_id: "order-1",
      merchant_reference: "ref-1",
      amount: 1000,
      currency: "BYN",
      status: "paid",
      result_code: "1"
    };
    expect(sanitizeProviderPayload(input)).toEqual(input);
  });

  it("returns empty object when all keys are forbidden", () => {
    expect(sanitizeProviderPayload({ signature: "x", secret: "y", pan: "z" })).toEqual({});
  });

  it("preserves empty objects and arrays unchanged", () => {
    expect(sanitizeProviderPayload({})).toEqual({});
    expect(sanitizeProviderPayload([])).toEqual([]);
  });

  it("strips payment_url but preserves other URL-like fields", () => {
    const input = {
      payment_url: "https://danger.example.test",
      return_url: "https://return.example.test",
      cancel_url: "https://cancel.example.test",
      notification_url: "https://notify.example.test"
    };
    expect(sanitizeProviderPayload(input)).toEqual({
      return_url: "https://return.example.test",
      cancel_url: "https://cancel.example.test",
      notification_url: "https://notify.example.test"
    });
  });
});

describe("containsForbiddenKeys", () => {
  it("returns empty array for clean payload", () => {
    expect(containsForbiddenKeys({ status: "paid", amount: 1000 })).toEqual([]);
  });

  it("detects single forbidden key at root", () => {
    const result = containsForbiddenKeys({ status: "paid", pan: "4111" });
    expect(result.length).toBe(1);
    expect(result[0]).toBe("$.pan");
  });

  it("detects forbidden keys at any depth", () => {
    const input = {
      level1: "ok",
      nested: {
        cvv: "123",
        deep: {
          signature: "sig"
        }
      }
    };
    const result = containsForbiddenKeys(input);
    expect(result).toContain("$.nested.cvv");
    expect(result).toContain("$.nested.deep.signature");
    expect(result).toHaveLength(2);
  });

  it("detects forbidden keys in arrays", () => {
    const input = [{ id: 1 }, { pan: "4111" }];
    const result = containsForbiddenKeys(input);
    expect(result.length).toBe(1);
    expect(result[0]).toBe("$[1].pan");
  });

  it("handles null and primitive values in scan", () => {
    expect(containsForbiddenKeys(null)).toEqual([]);
    expect(containsForbiddenKeys("string")).toEqual([]);
    expect(containsForbiddenKeys(42)).toEqual([]);
  });
});
