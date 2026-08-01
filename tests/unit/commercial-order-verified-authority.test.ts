import { describe, expect, it, vi } from "vitest";
import { createCommercialOrderPostHandler } from "@/app/api/commercial/orders/route";
import { CommercialError, type createCommercialOrder } from "@/lib/commercial/commercial-service";
import type { createRecoveryHttpRuntime } from "@/server/recovery/http-runtime";

const productCode = "russian-training-variant-01";
const checkoutFlowId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "verified-order-idempotency-key";

function request(input: { email?: string; cookie?: string } = {}) {
  return new Request("http://checkout.test/api/commercial/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...(input.cookie ? { cookie: input.cookie } : {})
    },
    body: JSON.stringify({
      productCode,
      checkout_flow_id: checkoutFlowId,
      ...(input.email ? { email: input.email } : {}),
      adultBuyerConfirmed: true,
      legalBundleVersion: "verified-v1"
    })
  });
}

function successfulCreateOrder() {
  return vi.fn().mockResolvedValue({
    order: { publicId: "order-public-id", status: "CREATED" },
    lookupToken: "opaque-order-token",
    idempotent: false
  }) as unknown as typeof createCommercialOrder;
}

function recoveryRuntime(
  mode: "off" | "shadow" | "enforce",
  validate = vi.fn()
) {
  return (() => mode === "off"
    ? { config: { enabled: false } }
    : mode === "shadow"
      ? { config: { enabled: true }, available: false }
      : {
          config: { enabled: true },
          service: { validateRecoverySession: validate }
        }) as unknown as typeof createRecoveryHttpRuntime;
}

function handler(input: {
  mode: "off" | "shadow" | "enforce";
  createOrder?: ReturnType<typeof successfulCreateOrder>;
  validate?: ReturnType<typeof vi.fn>;
}) {
  const createOrder = input.createOrder ?? successfulCreateOrder();
  const validate = input.validate ?? vi.fn();
  const setOrderToken = vi.fn().mockResolvedValue(undefined);
  return {
    createOrder,
    setOrderToken,
    validate,
    post: createCommercialOrderPostHandler({
      environment: { VERIFIED_COMMERCIAL_SESSION_MODE: input.mode },
      allowAction: () => true,
      unavailableReason: () => null,
      createOrder,
      setOrderToken,
      createRecoveryRuntime: recoveryRuntime(input.mode, validate)
    })
  };
}

describe("commercial Order verified-email HTTP authority", () => {
  it("rejects enforce mode before Order work when the verified cookie is absent", async () => {
    const test = handler({ mode: "enforce" });
    const response = await test.post(request());

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("VERIFIED_EMAIL_REQUIRED");
    expect(test.createOrder).not.toHaveBeenCalled();
  });

  it("accepts no body email and forwards only opaque server authority in enforce mode", async () => {
    const test = handler({ mode: "enforce" });
    const response = await test.post(request({
      cookie: "acc01a_recovery=rs1.v1.verified-email-token"
    }));

    expect(response.status).toBe(201);
    expect(test.createOrder).toHaveBeenCalledOnce();
    expect(test.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      productCode,
      checkoutFlowId,
      email: undefined,
      verifiedEmailAuthority: {
        rawToken: "rs1.v1.verified-email-token",
        validate: test.validate
      }
    }));
  });

  it("rejects a client-supplied email field instead of trusting or comparing it", async () => {
    const test = handler({ mode: "enforce" });
    const response = await test.post(request({
      email: "attacker-supplied@example.test",
      cookie: "acc01a_recovery=rs1.v1.verified-email-token"
    }));

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(test.createOrder).not.toHaveBeenCalled();
  });

  it("fails closed in off mode instead of accepting body email", async () => {
    const test = handler({ mode: "off" });
    const response = await test.post(request());

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("VERIFIED_EMAIL_REQUIRED");
    expect(test.createOrder).not.toHaveBeenCalled();
  });

  it("returns a safe pending-order action without issuing or rotating an order token", async () => {
    const createOrder = vi.fn().mockRejectedValue(new CommercialError(
      "ORDER_ALREADY_PENDING",
      "Order already pending",
      "WAIT_FOR_PAYMENT",
      "safe-public-order-reference"
    )) as unknown as ReturnType<typeof successfulCreateOrder>;
    const test = handler({ mode: "enforce", createOrder });
    const response = await test.post(request({
      cookie: "acc01a_recovery=rs1.v1.verified-email-token"
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        code: "ORDER_ALREADY_PENDING",
        details: {
          nextAction: "WAIT_FOR_PAYMENT",
          orderReference: "safe-public-order-reference"
        }
      }
    });
    expect(test.setOrderToken).not.toHaveBeenCalled();
  });
});
