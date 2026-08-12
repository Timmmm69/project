import { describe, expect, it } from "vitest";
import {
  commercialOrderStatusDtoSchema,
  serializeCommercialOrderStatus
} from "@/lib/commercial/status-dto";

const baseTime = new Date("2026-08-02T10:00:00.000Z");

function source(overrides: Record<string, unknown> = {}) {
  return {
    publicId: "cm_public_order_reference",
    status: "PENDING" as const,
    paidAt: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    paymentAttempts: [{
      status: "PENDING" as const,
      paidAt: null,
      updatedAt: baseTime,
      id: "internal-payment-attempt-id",
      merchantReference: "merchant-reference-secret",
      providerPaymentId: "provider-payment-secret",
      providerFields: { signature: "provider-signature-secret" },
      failureCode: "RAW_TECHNICAL_FAILURE"
    }],
    access: null,
    id: "internal-order-uuid",
    emailNormalized: "student@example.test",
    lookupTokenHash: "secret-token-hash",
    paymentUrl: "https://provider.example/pay?token=secret",
    ...overrides
  };
}

describe("safe commercial status/support DTO", () => {
  it("serializes only the strict public allowlist", () => {
    const dto = serializeCommercialOrderStatus(source(), undefined, baseTime);
    const serialized = JSON.stringify(dto);

    expect(commercialOrderStatusDtoSchema.parse(dto)).toEqual(dto);
    expect(Object.keys(dto).sort()).toEqual([
      "allowedActions",
      "category",
      "cooldown",
      "orderReference",
      "timestamps"
    ]);
    for (const forbidden of [
      "internal-order-uuid",
      "internal-payment-attempt-id",
      "merchant-reference-secret",
      "provider-payment-secret",
      "provider-signature-secret",
      "student@example.test",
      "secret-token-hash",
      "RAW_TECHNICAL_FAILURE",
      "https://provider.example"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const forbiddenKey of [
      "email",
      "merchantReference",
      "providerPaymentId",
      "providerFields",
      "failureCode",
      "paymentUrl",
      "nextUrl",
      "id"
    ]) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }
  });

  it("keeps pending and unknown refresh-only before the support threshold", () => {
    const pending = serializeCommercialOrderStatus(source(), undefined, baseTime);
    const unknown = serializeCommercialOrderStatus(source(), "payment_status_unknown", baseTime);

    expect(pending).toMatchObject({
      category: "payment_pending",
      cooldown: {
        refreshAfterSeconds: 10,
        supportAvailableAt: "2026-08-02T10:05:00.000Z"
      },
      allowedActions: ["refresh_status"]
    });
    expect(unknown).toMatchObject({
      category: "payment_status_unknown",
      allowedActions: ["refresh_status"]
    });
    expect(unknown.allowedActions).not.toContain("retry_payment");
  });

  it("allowlists support only after the deterministic pending/unknown threshold", () => {
    const afterFiveMinutes = new Date("2026-08-02T10:05:01.000Z");

    expect(serializeCommercialOrderStatus(source(), undefined, afterFiveMinutes).allowedActions)
      .toEqual(["refresh_status", "contact_support"]);
    expect(serializeCommercialOrderStatus(source(), "payment_status_unknown", afterFiveMinutes).allowedActions)
      .toEqual(["refresh_status", "contact_support"]);
  });

  it("uses a 60-second support threshold for paid_without_access and never offers payment", () => {
    const paidAt = baseTime;
    const paidWithoutAccess = source({
      status: "PAID",
      paidAt,
      paymentAttempts: [{ status: "PAID", paidAt, updatedAt: paidAt }]
    });

    const reconciling = serializeCommercialOrderStatus(
      paidWithoutAccess,
      undefined,
      new Date("2026-08-02T10:00:59.000Z")
    );
    const escalated = serializeCommercialOrderStatus(
      paidWithoutAccess,
      undefined,
      new Date("2026-08-02T10:01:00.000Z")
    );

    expect(reconciling.category).toBe("paid_without_access");
    expect(reconciling.allowedActions).toEqual(["refresh_status"]);
    expect(escalated.allowedActions).toEqual(["refresh_status", "contact_support"]);
    expect(JSON.stringify(escalated)).not.toContain("payment_session");
  });

  it("exposes only allowlisted actions for created, terminal and paid states", () => {
    const created = serializeCommercialOrderStatus(source({
      status: "CREATED",
      paymentAttempts: []
    }), undefined, baseTime);
    const failed = serializeCommercialOrderStatus(source({
      status: "FAILED",
      paymentAttempts: [{ status: "FAILED", paidAt: null, updatedAt: baseTime }]
    }), undefined, baseTime);
    const paid = serializeCommercialOrderStatus(source({
      status: "PAID",
      paidAt: baseTime,
      access: { internalId: "never-serialized" },
      paymentAttempts: [{ status: "PAID", paidAt: baseTime, updatedAt: baseTime }]
    }), undefined, baseTime);

    expect(created.allowedActions).toEqual(["create_payment_session"]);
    expect(failed).toMatchObject({
      category: "payment_failed",
      allowedActions: ["retry_payment", "contact_support"]
    });
    expect(paid).toMatchObject({
      category: "payment_paid",
      allowedActions: ["continue_access"]
    });
  });

  it("rejects DTO extension with internal or provider fields", () => {
    const dto = serializeCommercialOrderStatus(source(), undefined, baseTime);

    expect(commercialOrderStatusDtoSchema.safeParse({ ...dto, email: "student@example.test" }).success).toBe(false);
    expect(commercialOrderStatusDtoSchema.safeParse({ ...dto, merchantReference: "merchant" }).success).toBe(false);
    expect(commercialOrderStatusDtoSchema.safeParse({ ...dto, technicalError: "stack" }).success).toBe(false);
  });
});
