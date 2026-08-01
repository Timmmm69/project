import { describe, expect, it } from "vitest";
import { assertNoForbiddenAnalyticsPayload } from "@/lib/analytics/forbidden-payload";
import { checkoutStartedPropertiesSchema, orderCreatedPropertiesSchema } from "@/lib/analytics/schemas";
import { checkoutStartedProperties, createCheckoutFlowId, orderCreatedProperties } from "@/lib/commercial/checkout-flow";
import {
  commercialCheckoutFlowIdSchema,
  commercialOrderSchema,
  commercialVerifiedOrderSchema
} from "@/lib/commercial/schemas";

describe("commercial checkout flow", () => {
  it("creates distinct opaque UUIDs on the server", () => {
    const first = createCheckoutFlowId();
    const second = createCheckoutFlowId();
    expect(commercialCheckoutFlowIdSchema.parse(first)).toBe(first);
    expect(commercialCheckoutFlowIdSchema.parse(second)).toBe(second);
    expect(first).not.toBe(second);
  });

  it("rejects invalid checkout flow identifiers", () => {
    expect(commercialCheckoutFlowIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("builds PII-free checkout_started properties", () => {
    const properties = checkoutStartedProperties({
      checkoutFlowId: "33333333-3333-4333-8333-333333333333",
      productId: "russian-training-variant-01",
      testId: "russian-training-1",
      examMode: "RIKZ_RUSSIAN_2026"
    });
    expect(checkoutStartedPropertiesSchema.parse(properties)).toEqual(properties);
    expect(() => assertNoForbiddenAnalyticsPayload(properties)).not.toThrow();
    expect(properties).not.toHaveProperty("email");
  });

  it("builds PII-free order_created properties from an authoritative snapshot", () => {
    const properties = orderCreatedProperties({
      checkoutFlowId: "33333333-3333-4333-8333-333333333333",
      orderPublicIdHash: "a".repeat(64),
      productId: "russian-training-variant-01",
      testId: "russian-training-1",
      amount: 1000,
      currency: "BYN"
    });
    expect(orderCreatedPropertiesSchema.parse(properties)).toEqual(properties);
    expect(() => assertNoForbiddenAnalyticsPayload(properties)).not.toThrow();
    expect(properties).not.toHaveProperty("email");
  });

  it("does not accept client amount or currency in the order command", () => {
    const base = {
      productCode: "russian-training-variant-01",
      checkout_flow_id: "33333333-3333-4333-8333-333333333333",
      email: "student@example.test",
      adultBuyerConfirmed: true,
      legalBundleVersion: "v1"
    };
    expect(commercialOrderSchema.safeParse(base).success).toBe(true);
    expect(commercialOrderSchema.safeParse({ ...base, amount: 1 }).success).toBe(false);
    expect(commercialOrderSchema.safeParse({ ...base, currency: "USD" }).success).toBe(false);
  });

  it("keeps email out of the verified Order HTTP command", () => {
    const command = {
      productCode: "russian-training-variant-01",
      checkout_flow_id: "33333333-3333-4333-8333-333333333333",
      adultBuyerConfirmed: true,
      legalBundleVersion: "v1"
    };
    expect(commercialVerifiedOrderSchema.safeParse(command).success).toBe(true);
    expect(commercialVerifiedOrderSchema.safeParse({
      ...command,
      email: "client@example.test"
    }).success).toBe(false);
  });
});
