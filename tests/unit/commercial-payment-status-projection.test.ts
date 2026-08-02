import { describe, expect, it, vi } from "vitest";
import type { CommercialPaymentProviderAdapter, ProviderNotification } from "@/lib/commercial/providers/types";
import { createCommercialRefreshStatusPostHandler } from "@/app/api/commercial/orders/[publicId]/refresh-status/route";

const publicId = "ord_public_opaque";

function pendingOrder() {
  return {
    id: "internal-order-id",
    status: "PENDING",
    paymentAttempts: [{
      id: "internal-attempt-id",
      status: "PENDING",
      provider: "LOCAL_FAKE",
      merchantReference: "merchant-internal-reference",
      providerPaymentId: null,
      amountMinor: 1_000,
      currency: "BYN"
    }]
  } as const;
}

function notification(overrides: Partial<ProviderNotification> = {}): ProviderNotification {
  return {
    merchantReference: "merchant-internal-reference",
    providerPaymentId: null,
    providerEventKey: null,
    status: "pending",
    amountMinor: 1_000,
    currency: "BYN",
    signatureValid: true,
    eventType: "authoritative_status",
    redactedPayload: { status: "pending" },
    ...overrides
  };
}

function provider(fetchPaymentStatus: CommercialPaymentProviderAdapter["fetchPaymentStatus"]): CommercialPaymentProviderAdapter {
  return {
    provider: "LOCAL_FAKE",
    createCheckout: vi.fn(),
    verifyNotification: vi.fn(),
    fetchPaymentStatus
  };
}

function statusDto(projection?: "payment_status_unknown") {
  return {
    orderStatus: "pending",
    paymentStatus: projection ?? "pending",
    accessStatus: "none",
    nextAction: "WAIT_FOR_PAYMENT" as const,
    nextUrl: null
  };
}

function setup(input: {
  runtimeProvider?: CommercialPaymentProviderAdapter;
  processRejected?: boolean;
}) {
  const processNotification = vi.fn().mockResolvedValue({
    duplicate: false,
    grantedAccess: false,
    rejected: input.processRejected ?? false
  });
  const orderStatus = vi.fn(async (
    _value: string,
    projection?: { paymentStatus?: "payment_status_unknown" }
  ) => statusDto(projection?.paymentStatus));
  const handler = createCommercialRefreshStatusPostHandler({
    requireOrderToken: vi.fn().mockResolvedValue({ id: "authorized-order" }),
    allowRefresh: vi.fn().mockReturnValue(true),
    getOrder: vi.fn().mockResolvedValue(pendingOrder()),
    providerForRuntime: () => input.runtimeProvider ?? provider(vi.fn().mockResolvedValue(notification())),
    processNotification,
    orderStatus,
    writeEvent: vi.fn().mockResolvedValue(undefined)
  });
  return { handler, processNotification, orderStatus };
}

async function call(handler: ReturnType<typeof createCommercialRefreshStatusPostHandler>) {
  return handler(
    new Request(`http://localhost/api/commercial/orders/${publicId}/refresh-status`, { method: "POST" }),
    { params: Promise.resolve({ publicId }) }
  );
}

describe("transient commercial payment status projection", () => {
  it("projects timeout as payment_status_unknown without processing a payment event", async () => {
    const { handler, processNotification, orderStatus } = setup({
      runtimeProvider: provider(vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")))
    });

    const response = await call(handler);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        orderStatus: "pending",
        paymentStatus: "payment_status_unknown",
        accessStatus: "none",
        nextAction: "WAIT_FOR_PAYMENT"
      }
    });
    expect(processNotification).not.toHaveBeenCalled();
    expect(orderStatus).toHaveBeenCalledWith(publicId, { paymentStatus: "payment_status_unknown" });
  });

  it.each([
    ["malformed", notification({ signatureValid: false })],
    ["ambiguous reference", notification({ merchantReference: "different-reference" })]
  ])("projects %s authoritative response as unknown", async (_case, value) => {
    const { handler, processNotification } = setup({
      runtimeProvider: provider(vi.fn().mockResolvedValue(value))
    });

    const response = await call(handler);

    expect((await response.json()).data.paymentStatus).toBe("payment_status_unknown");
    expect(processNotification).not.toHaveBeenCalled();
  });

  it("projects an unavailable configured provider as unknown", async () => {
    const unavailable = provider(vi.fn());
    Object.defineProperty(unavailable, "provider", { value: "WEBPAY_SANDBOX" });
    const { handler, processNotification } = setup({ runtimeProvider: unavailable });

    const response = await call(handler);

    expect((await response.json()).data).toMatchObject({
      paymentStatus: "payment_status_unknown",
      nextAction: "WAIT_FOR_PAYMENT"
    });
    expect(processNotification).not.toHaveBeenCalled();
  });

  it("keeps the confirmed business state when an authoritative refresh is processed", async () => {
    const fetchPaymentStatus = vi.fn().mockResolvedValue(notification());
    const { handler, processNotification, orderStatus } = setup({
      runtimeProvider: provider(fetchPaymentStatus)
    });

    const response = await call(handler);

    expect((await response.json()).data.paymentStatus).toBe("pending");
    expect(fetchPaymentStatus).toHaveBeenCalledWith({
      merchantReference: "merchant-internal-reference",
      providerPaymentId: null,
      amountMinor: 1_000,
      currency: "BYN"
    });
    expect(processNotification).toHaveBeenCalledTimes(1);
    expect(orderStatus).toHaveBeenCalledWith(publicId);
  });

  it("projects a rejected provider decision as unknown without offering retry", async () => {
    const { handler } = setup({ processRejected: true });

    const response = await call(handler);
    const body = await response.json();

    expect(body.data.paymentStatus).toBe("payment_status_unknown");
    expect(body.data.nextAction).toBe("WAIT_FOR_PAYMENT");
    expect(JSON.stringify(body)).not.toContain("retry");
  });
});
