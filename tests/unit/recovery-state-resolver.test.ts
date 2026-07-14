import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryConfig } from "@/server/recovery/config";
import { createRecoveryHttpHandlers } from "@/server/recovery/http-handlers";
import {
  RECOVERY_HTTP_GLOBAL_SOURCE,
  RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE,
  type RecoveryHttpRuntime,
  type RecoveryHttpService
} from "@/server/recovery/http-runtime";
import {
  RECOVERY_RESOLVED_STATES,
  recoveryStateResponseSchema,
  resolveRecoveryStateSnapshot,
  type RecoveryStateSnapshot
} from "@/server/recovery/state-resolver";

const now = new Date("2026-07-14T12:00:00.000Z");
const ids = {
  product: "11111111-1111-4111-8111-111111111111",
  test: "22222222-2222-4222-8222-222222222222",
  user: "33333333-3333-4333-8333-333333333333",
  order: "44444444-4444-4444-8444-444444444444",
  payment: "55555555-5555-4555-8555-555555555555",
  access: "66666666-6666-4666-8666-666666666666",
  attempt: "77777777-7777-4777-8777-777777777777"
};

function baseSnapshot(overrides: Partial<RecoveryStateSnapshot> = {}): RecoveryStateSnapshot {
  return {
    emailNormalized: "buyer@example.test",
    commercialProductId: ids.product,
    testId: ids.test,
    product: {
      id: ids.product,
      code: "russian-training-variant-01",
      testId: ids.test,
      attemptLimit: 1,
      resultRetentionDays: 365,
      test: { id: ids.test, examMode: "RIKZ_RUSSIAN_2026", deletedAt: null }
    },
    users: [{ id: ids.user, role: "STUDENT", deletedAt: null }],
    orders: [{
      id: ids.order,
      commercialProductId: ids.product,
      testIdSnapshot: ids.test,
      emailNormalized: "buyer@example.test",
      status: "PAID",
      paymentAttempts: [{ id: ids.payment, status: "PAID" }]
    }],
    accesses: [{
      id: ids.access,
      userId: ids.user,
      testId: ids.test,
      source: "COMMERCIAL",
      attemptsTotal: 1,
      attemptsAvailable: 1,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
      commercialProductId: ids.product,
      commercialOrderId: ids.order,
      commercialPaymentAttemptId: ids.payment,
      grantedAt: now,
      startDeadlineAt: new Date(now.getTime() + 60_000)
    }],
    attempts: [],
    ...overrides
  };
}

function terminalAttempt(
  overrides: Partial<RecoveryStateSnapshot["attempts"][number]> = {}
): RecoveryStateSnapshot["attempts"][number] {
  return {
    id: ids.attempt,
    userId: ids.user,
    testId: ids.test,
    accessId: ids.access,
    status: "COMPLETED" as const,
    finishedAt: new Date(now.getTime() - 60_000),
    durationSeconds: 7_200,
    rawScore: 60,
    maxRawScore: 80,
    percent: new Prisma.Decimal(75),
    testSnapshot: {
      testId: ids.test,
      examMode: "rikz_russian_2026",
      durationMinutes: 120,
      questions: [{ correctAnswer: "server-only" }]
    },
    ...overrides
  };
}

describe("ACC-01A recovery state decision table", () => {
  it("exposes exactly the canonical six success states", () => {
    expect(RECOVERY_RESOLVED_STATES).toEqual([
      "access_unstarted", "attempt_active", "result_available",
      "start_window_expired", "no_access", "support_required"
    ]);
  });

  it("maps an open valid Access to access_unstarted/CONTINUE", () => {
    expect(resolveRecoveryStateSnapshot(baseSnapshot(), now)).toEqual({
      state: "access_unstarted", screen: "REC-01", nextAction: "CONTINUE"
    });
  });

  it("maps an expired unused Access to start_window_expired/null", () => {
    const access = { ...baseSnapshot().accesses[0]!, expiresAt: now, startDeadlineAt: now };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({ accesses: [access] }), now))
      .toEqual({ state: "start_window_expired", screen: "REC-01", nextAction: null });
  });

  it("lets a STARTED Attempt outrank an elapsed start deadline without exposing timer data", () => {
    const access = {
      ...baseSnapshot().accesses[0]!,
      attemptsAvailable: 0,
      expiresAt: new Date(now.getTime() - 60_000),
      startDeadlineAt: new Date(now.getTime() - 60_000)
    };
    const result = resolveRecoveryStateSnapshot(baseSnapshot({
      accesses: [access],
      attempts: [{ ...terminalAttempt(), status: "STARTED", finishedAt: null }]
    }), now);
    expect(result).toEqual({ state: "attempt_active", screen: "REC-01", nextAction: "CONTINUE" });
    expect(JSON.stringify(result)).not.toMatch(/startedAt|endsAt|remaining|attemptId/);
  });

  it.each(["COMPLETED", "EXPIRED"] as const)(
    "lets a readable %s terminal projection outrank the deadline",
    (status) => {
      const access = {
        ...baseSnapshot().accesses[0]!, attemptsAvailable: 0, expiresAt: now, startDeadlineAt: now
      };
      expect(resolveRecoveryStateSnapshot(baseSnapshot({
        accesses: [access], attempts: [terminalAttempt({ status })]
      }), now)).toEqual({
        state: "result_available", screen: "REC-01", nextAction: "CONTINUE"
      });
    }
  );

  it("maps an unreadable or out-of-retention terminal projection to support_required", () => {
    const access = { ...baseSnapshot().accesses[0]!, attemptsAvailable: 0 };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      accesses: [access], attempts: [terminalAttempt({ rawScore: null })]
    }), now).state).toBe("support_required");
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      product: { ...baseSnapshot().product!, resultRetentionDays: 1 },
      accesses: [access],
      attempts: [terminalAttempt({ finishedAt: new Date(now.getTime() - 2 * 86_400_000) })]
    }), now).state).toBe("support_required");
  });

  it("maps CANCELLED to support_required", () => {
    const access = { ...baseSnapshot().accesses[0]!, attemptsAvailable: 0 };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      accesses: [access], attempts: [terminalAttempt({ status: "CANCELLED" })]
    }), now).state).toBe("support_required");
  });

  it("never maps PAID without Access to no_access", () => {
    expect(resolveRecoveryStateSnapshot(baseSnapshot({ accesses: [], attempts: [] }), now).state)
      .toBe("support_required");
  });

  it.each(["CREATED", "PENDING"] as const)(
    "maps %s Order without Access to support_required",
    (status) => {
      const order = { ...baseSnapshot().orders[0]!, status, paymentAttempts: [] };
      expect(resolveRecoveryStateSnapshot(baseSnapshot({
        orders: [order], accesses: [], attempts: []
      }), now).state).toBe("support_required");
    }
  );

  it.each(["FAILED", "CANCELLED", "EXPIRED"] as const)(
    "maps a consistent terminal non-paid %s Order to no_access",
    (status) => {
      const order = {
        ...baseSnapshot().orders[0]!,
        status,
        paymentAttempts: [{ id: ids.payment, status }]
      };
      expect(resolveRecoveryStateSnapshot(baseSnapshot({
        orders: [order], accesses: [], attempts: []
      }), now).state).toBe("no_access");
    }
  );

  it("maps a clean subject without Access or payment history to no_access", () => {
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      users: [], orders: [], accesses: [], attempts: []
    }), now)).toEqual({ state: "no_access", screen: "REC-01", nextAction: null });
  });

  it("maps revoked or zero-availability unstarted Access to support_required", () => {
    for (const access of [
      { ...baseSnapshot().accesses[0]!, revokedAt: now },
      { ...baseSnapshot().accesses[0]!, attemptsAvailable: 0 }
    ]) {
      expect(resolveRecoveryStateSnapshot(baseSnapshot({ accesses: [access] }), now).state)
        .toBe("support_required");
    }
  });

  it("detects conflicting Access and Attempt candidates instead of choosing the first", () => {
    const otherAccess = { ...baseSnapshot().accesses[0]!, id: "88888888-8888-4888-8888-888888888888" };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      accesses: [baseSnapshot().accesses[0]!, otherAccess]
    }), now).state).toBe("support_required");
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      attempts: [terminalAttempt(), { ...terminalAttempt(), id: "99999999-9999-4999-8999-999999999999" }]
    }), now).state).toBe("support_required");
  });

  it("fails generic, broken ownership and Product/Test relations closed", () => {
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      product: { ...baseSnapshot().product!, test: { ...baseSnapshot().product!.test, examMode: "GENERIC" } }
    }), now).state).toBe("support_required");
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      accesses: [{ ...baseSnapshot().accesses[0]!, source: "MANUAL" }]
    }), now).state).toBe("support_required");
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      accesses: [{ ...baseSnapshot().accesses[0]!, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]
    }), now).state).toBe("support_required");
  });

  it("uses a closed serializer with exactly three public keys and no sensitive values", () => {
    const responses = RECOVERY_RESOLVED_STATES.map((value) => recoveryStateResponseSchema.parse({
      state: value,
      screen: "REC-01",
      nextAction: ["access_unstarted", "attempt_active", "result_available"].includes(value)
        ? "CONTINUE"
        : null
    }));
    for (const response of responses) {
      expect(Object.keys(response).sort()).toEqual(["nextAction", "screen", "state"]);
      expect(JSON.stringify(response)).not.toMatch(
        /email|userId|productId|testId|order|payment|provider|accessId|attemptId|resultId|startedAt|endsAt|finishedAt|remaining|answer|question|correct|accepted|explanation|primaryScore|scaledScore|lookup|token|digest/i
      );
    }
    expect(() => recoveryStateResponseSchema.parse({
      state: "no_access", screen: "REC-01", nextAction: null, email: "x@example.test"
    })).toThrow();
  });

  it("contains no imports or calls to business mutation, scoring, Result or analytics services", () => {
    const source = readFileSync("src/server/recovery/state-resolver.ts", "utf8");
    expect(source).not.toMatch(/completeAttempt|startOrRestoreAttempt|scoreAttempt|serializeResult|logEvent|analytics/i);
    expect(source).not.toMatch(/\.create\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});

function enabledConfig() {
  return { enabled: true } as Extract<RecoveryConfig, { enabled: true }>;
}

function getRequest(query = "", cookie = "acc01a_recovery=opaque-token") {
  return new Request(`http://recovery.test/api/recovery/state${query}`, {
    method: "GET",
    headers: cookie ? { cookie, "x-email": "victim@example.test" } : {}
  });
}

describe("ACC-01A recovery state HTTP boundary", () => {
  let service: {
    validateRecoverySession: ReturnType<typeof vi.fn>;
    consumeResolverRead: ReturnType<typeof vi.fn>;
    requestChallenge: ReturnType<typeof vi.fn>;
    verifyChallenge: ReturnType<typeof vi.fn>;
    invalidateRecoverySession: ReturnType<typeof vi.fn>;
  };
  let businessResolver: ReturnType<typeof vi.fn>;

  function runtime(): RecoveryHttpRuntime {
    return {
      config: enabledConfig(),
      service: service as unknown as RecoveryHttpService,
      resolveState: businessResolver,
      trustedOrigin: "http://recovery.test",
      sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE,
      resolverLimiterInput: RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
    };
  }

  function handlers(getRuntime = runtime) {
    return createRecoveryHttpHandlers({ getRuntime, cookieSecure: false });
  }

  beforeEach(() => {
    service = {
      validateRecoverySession: vi.fn().mockResolvedValue({
        status: "RESOLVED",
        emailNormalized: "buyer@example.test",
        emailFingerprint: "fingerprint",
        commercialProductId: ids.product,
        testId: ids.test,
        sessionId: "session-id",
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 60_000)
      }),
      consumeResolverRead: vi.fn().mockResolvedValue({ allowed: true }),
      requestChallenge: vi.fn(),
      verifyChallenge: vi.fn(),
      invalidateRecoverySession: vi.fn()
    };
    businessResolver = vi.fn().mockResolvedValue({
      state: "access_unstarted", screen: "REC-01", nextAction: "CONTINUE"
    });
  });

  it("validates the cookie before passing only server-bound scope to business lookup", async () => {
    const response = await handlers().resolveState(getRequest());
    expect(response.status).toBe(200);
    expect(service.validateRecoverySession).toHaveBeenCalledWith("opaque-token");
    expect(businessResolver).toHaveBeenCalledWith({
      emailNormalized: "buyer@example.test",
      commercialProductId: ids.product,
      testId: ids.test
    });
    expect(service.validateRecoverySession.mock.invocationCallOrder[0])
      .toBeLessThan(businessResolver.mock.invocationCallOrder[0]!);
  });

  it("maps missing, malformed, unknown, expired and revoked authority to safe 401 before lookup", async () => {
    expect((await handlers().resolveState(getRequest("", ""))).status).toBe(401);
    for (const status of ["INVALID_TOKEN", "UNKNOWN_KEY", "NOT_FOUND", "EXPIRED", "REVOKED"]) {
      service.validateRecoverySession.mockResolvedValueOnce({ status });
      const response = await handlers().resolveState(getRequest());
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("RECOVERY_SESSION_REQUIRED");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
    expect(businessResolver).not.toHaveBeenCalled();
  });

  it("maps session scope mismatch to safe 403 and clears terminal authority", async () => {
    service.validateRecoverySession.mockResolvedValueOnce({ status: "SCOPE_MISMATCH" });
    const response = await handlers().resolveState(getRequest());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("SCOPE_NOT_ALLOWED");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(businessResolver).not.toHaveBeenCalled();
  });

  it("rejects every query override before validation", async () => {
    const response = await handlers().resolveState(getRequest("?email=victim%40example.test"));
    expect(response.status).toBe(400);
    expect(service.validateRecoverySession).not.toHaveBeenCalled();
    expect(businessResolver).not.toHaveBeenCalled();
  });

  it("maps feature-off/config-invalid preflight to 404 before cookie or lookup", async () => {
    const disabled = handlers(() => ({ config: { enabled: false } }));
    expect((await disabled.resolveState(getRequest())).status).toBe(404);
    const invalid = handlers(() => { throw new Error("invalid config"); });
    expect((await invalid.resolveState(getRequest())).status).toBe(404);
    expect(service.validateRecoverySession).not.toHaveBeenCalled();
    expect(businessResolver).not.toHaveBeenCalled();
  });

  it("maps a source/global resolver limit to safe 429 with bounded server Retry-After", async () => {
    service.consumeResolverRead.mockResolvedValueOnce({
      allowed: false, safeCode: "SOURCE_REQUEST_LIMIT_15M", retryAfterSeconds: 42
    });
    const response = await handlers().resolveState(getRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(JSON.stringify(await response.json())).not.toContain("SOURCE_REQUEST_LIMIT");
    expect(businessResolver).not.toHaveBeenCalled();
  });

  it("maps transport/DB failure to 503 without clearing the retryable cookie", async () => {
    businessResolver.mockRejectedValueOnce(new Error("synthetic database outage"));
    const response = await handlers().resolveState(getRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("RESOLUTION_TEMPORARY_ERROR");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("adds no-store/no-referrer and returns only the closed success body", async () => {
    const response = await handlers().resolveState(getRequest());
    expect(await response.json()).toEqual({
      state: "access_unstarted", screen: "REC-01", nextAction: "CONTINUE"
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
