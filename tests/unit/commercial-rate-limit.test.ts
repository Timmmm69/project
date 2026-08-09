/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommercialRateLimitService, deriveCommercialClientKey } from "@/lib/commercial/rate-limit";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

function fakeHeaders(entries: Record<string, string>) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(entries)) {
    headers.set(k, v);
  }
  return headers;
}

function fakeRequest(headers: Record<string, string>) {
  return { headers: fakeHeaders(headers) } as unknown as Request;
}

describe("deriveCommercialClientKey", () => {
  it("uses x-forwarded-for when trusted proxy is enabled", () => {
    process.env.TRUSTED_PROXY = "true";
    const req = fakeRequest({ "x-forwarded-for": "10.0.0.1, 10.0.0.2", host: "example.com" });
    expect(deriveCommercialClientKey(req)).toBe("proxy:10.0.0.1");
  });

  it("falls back to host when x-forwarded-for is missing with trusted proxy", () => {
    process.env.TRUSTED_PROXY = "true";
    const req = fakeRequest({ host: "example.com" });
    expect(deriveCommercialClientKey(req)).toBe("host:example.com");
  });

  it("uses host when trusted proxy is disabled", () => {
    process.env.TRUSTED_PROXY = "false";
    const req = fakeRequest({ "x-forwarded-for": "10.0.0.1", host: "example.com" });
    expect(deriveCommercialClientKey(req)).toBe("host:example.com");
  });

  it("uses 'unknown' when host is missing and no proxy", () => {
    process.env.TRUSTED_PROXY = "false";
    const req = fakeRequest({});
    expect(deriveCommercialClientKey(req)).toBe("host:unknown");
  });

  it("trims and takes the first IP from x-forwarded-for chain", () => {
    process.env.TRUSTED_PROXY = "true";
    const req = fakeRequest({ "x-forwarded-for": "  192.168.1.1 , 10.0.0.1  ", host: "example.com" });
    expect(deriveCommercialClientKey(req)).toBe("proxy:192.168.1.1");
  });
});

function makeRateEventMock(count: number, oldestOffsetMs?: number) {
  const events = {
    count: vi.fn().mockResolvedValue(count),
    create: vi.fn().mockResolvedValue({}),
    findFirst: oldestOffsetMs !== undefined
      ? vi.fn().mockResolvedValue({ occurredAt: new Date(Date.now() - oldestOffsetMs) })
      : vi.fn().mockResolvedValue(null)
  };
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    commercialRateLimitEvent: events
  };
}

function makeCleanupMock() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    commercialRateLimitEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) }
  };
}

describe("commercial rate limit service with mock", () => {
  it("allows within limit", async () => {
    const mockTx = makeRateEventMock(0);
    const service = createCommercialRateLimitService({
      client: { $transaction: vi.fn() } as any,
      clock: () => new Date(2026, 0, 1, 12, 0, 0)
    });
    const result = await service.consume("CHECKOUT_FLOW", "client-1", mockTx as any);
    expect(result.allowed).toBe(true);
    expect(mockTx.commercialRateLimitEvent.create).toHaveBeenCalledTimes(1);
  });

  it("denies when limit exceeded and returns Retry-After with safeCode", async () => {
    const mockTx = makeRateEventMock(5, 60_000);
    const service = createCommercialRateLimitService({
      client: { $transaction: vi.fn() } as any,
      clock: () => new Date(2026, 0, 1, 12, 0, 0)
    });
    const result = await service.consume("CHECKOUT_FLOW", "client-1", mockTx as any);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.safeCode).toBe("CHECKOUT_FLOW_LIMIT_1M");
    }
    expect(mockTx.commercialRateLimitEvent.create).not.toHaveBeenCalled();
  });

  it("separate namespaces do not affect each other", async () => {
    const orderTx = makeRateEventMock(0);
    const flowTx = makeRateEventMock(5, 60_000);
    const service = createCommercialRateLimitService({
      client: { $transaction: vi.fn() } as any,
      clock: () => new Date(2026, 0, 1, 12, 0, 0)
    });

    const allowed = await service.consume("ORDER_CREATE", "client-same", orderTx as any);
    expect(allowed.allowed).toBe(true);

    const denied = await service.consume("CHECKOUT_FLOW", "client-same", flowTx as any);
    expect(denied.allowed).toBe(false);
  });

  it("different client keys get separate limits within the same namespace", async () => {
    const mockTx = makeRateEventMock(0);
    const service = createCommercialRateLimitService({
      client: { $transaction: vi.fn() } as any,
      clock: () => new Date(2026, 0, 1, 12, 0, 0)
    });

    const client1 = await service.consume("STATUS_REFRESH", "client-1:order-a", mockTx as any);
    const client2 = await service.consume("STATUS_REFRESH", "client-2:order-a", mockTx as any);
    expect(client1.allowed).toBe(true);
    expect(client2.allowed).toBe(true);
  });

  it("cleanupExpired removes expired events", async () => {
    const cleanupMock = makeCleanupMock();
    const service = createCommercialRateLimitService({
      client: { $transaction: vi.fn() } as any,
      clock: () => new Date(2026, 0, 1, 12, 0, 0)
    });
    const result = await service.cleanupExpired(cleanupMock as any);
    expect(result.deletedCount).toBe(3);
  });

  it("records events for different kinds independently", async () => {
    const ordersTx = makeRateEventMock(0);
    const sessionsTx = makeRateEventMock(0);
    const service = createCommercialRateLimitService({
      client: { $transaction: vi.fn() } as any,
      clock: () => new Date(2026, 0, 1, 12, 0, 0)
    });

    const r1 = await service.consume("ORDER_CREATE", "client-1", ordersTx as any);
    expect(r1.allowed).toBe(true);
    expect(ordersTx.commercialRateLimitEvent.create).toHaveBeenCalledTimes(1);

    const r2 = await service.consume("PAYMENT_SESSION_CREATE", "client-1", sessionsTx as any);
    expect(r2.allowed).toBe(true);
    expect(sessionsTx.commercialRateLimitEvent.create).toHaveBeenCalledTimes(1);
  });
});
