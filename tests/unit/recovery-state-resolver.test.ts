import { readFileSync } from "node:fs";
import { Prisma, type PrismaClient } from "@prisma/client";
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
  createRecoveryStateResolver,
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
    configuredProductCode: "russian-training-variant-01",
    commercialProductId: ids.product,
    testId: ids.test,
    product: {
      id: ids.product,
      code: "russian-training-variant-01",
      testId: ids.test,
      attemptLimit: 1,
      resultRetentionDays: 365,
      priceMinor: 1000,
      currency: "BYN",
      isActive: true,
      test: {
        id: ids.test,
        examMode: "RIKZ_RUSSIAN_2026",
        status: "PUBLISHED",
        deletedAt: null
      }
    },
    users: [{ id: ids.user, role: "STUDENT", deletedAt: null }],
    orders: [{
      id: ids.order,
      commercialProductId: ids.product,
      testIdSnapshot: ids.test,
      emailNormalized: "buyer@example.test",
      status: "PAID",
      priceMinor: 1000,
      currency: "BYN",
      paidAt: now,
      paymentAttempts: [{
        id: ids.payment,
        status: "PAID",
        amountMinor: 1000,
        currency: "BYN",
        paidAt: now,
        createdAt: now
      }]
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

function authenticQuestions() {
  return Array.from({ length: 40 }, (_, index) => ({
    snapshotQuestionId: `q_${index + 1}`,
    orderIndex: index,
    questionType: index < 18 ? "multi_select_five" : "short_answer_token",
    points: 2,
    correctAnswer: "server-only"
  }));
}

function authenticTerminalSnapshot(overrides: Record<string, unknown> = {}): Prisma.JsonValue {
  return {
    testId: ids.test,
    subject: "russian",
    mode: "ce_ct",
    examMode: "rikz_russian_2026",
    durationMinutes: 120,
    maxRawScore: 80,
    questions: authenticQuestions(),
    ...overrides
  } as Prisma.JsonValue;
}

function terminalAttempt(
  overrides: Partial<RecoveryStateSnapshot["attempts"][number]> = {}
): RecoveryStateSnapshot["attempts"][number] {
  const status = overrides.status ?? "COMPLETED";
  const startedAt = overrides.startedAt ?? new Date(now.getTime() - 7_200_000);
  const defaultFinishedAt = status === "EXPIRED"
    ? new Date(startedAt.getTime() + 7_200_000)
    : new Date(now.getTime() - 60_000);
  const finishedAt = overrides.finishedAt === undefined ? defaultFinishedAt : overrides.finishedAt;
  const durationSeconds = overrides.durationSeconds === undefined && finishedAt
    ? Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1_000)
    : overrides.durationSeconds ?? null;
  return {
    id: ids.attempt,
    userId: ids.user,
    testId: ids.test,
    accessId: ids.access,
    rawScore: 60,
    maxRawScore: 80,
    percent: new Prisma.Decimal(75),
    testSnapshot: authenticTerminalSnapshot(),
    ...overrides,
    status,
    startedAt,
    finishedAt,
    durationSeconds
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

  it.each([
    ["missing snapshot metadata", () => terminalAttempt({
      testSnapshot: authenticTerminalSnapshot({ subject: undefined })
    })],
    ["wrong Test ID", () => terminalAttempt({
      testSnapshot: authenticTerminalSnapshot({ testId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
    })],
    ["wrong exam mode", () => terminalAttempt({
      testSnapshot: authenticTerminalSnapshot({ examMode: "generic" })
    })],
    ["wrong duration", () => terminalAttempt({
      testSnapshot: authenticTerminalSnapshot({ durationMinutes: 119 })
    })],
    ["wrong snapshot max raw score", () => terminalAttempt({
      testSnapshot: authenticTerminalSnapshot({ maxRawScore: 79 })
    })],
    ["wrong question count", () => terminalAttempt({
      testSnapshot: authenticTerminalSnapshot({ questions: authenticQuestions().slice(0, 39) })
    })],
    ["snapshot points sum mismatch", () => terminalAttempt({
      testSnapshot: authenticTerminalSnapshot({
        questions: authenticQuestions().map((question, index) =>
          index === 0 ? { ...question, points: 1 } : question
        )
      })
    })],
    ["Attempt max score mismatch", () => terminalAttempt({ maxRawScore: 79 })],
    ["raw score outside range", () => terminalAttempt({ rawScore: 81 })],
    ["percent mismatch", () => terminalAttempt({ rawScore: 59, percent: new Prisma.Decimal(75) })],
    ["finishedAt before startedAt", () => terminalAttempt({
      startedAt: now,
      finishedAt: new Date(now.getTime() - 1_000)
    })],
    ["duration mismatch", () => terminalAttempt({ durationSeconds: 1 })],
    ["COMPLETED at timer deadline", () => terminalAttempt({
      status: "COMPLETED",
      startedAt: new Date(now.getTime() - 7_200_000),
      finishedAt: now
    })],
    ["EXPIRED before timer deadline", () => terminalAttempt({
      status: "EXPIRED",
      startedAt: new Date(now.getTime() - 7_200_000),
      finishedAt: new Date(now.getTime() - 1_000)
    })],
    ["expired Result retention", () => {
      const finishedAt = new Date(now.getTime() - 366 * 86_400_000);
      return terminalAttempt({
        startedAt: new Date(finishedAt.getTime() - 3_600_000),
        finishedAt
      });
    }]
  ] as const)("maps %s to support_required", (_label, buildAttempt) => {
    const access = { ...baseSnapshot().accesses[0]!, attemptsAvailable: 0 };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      accesses: [access],
      attempts: [buildAttempt()]
    }), now).state).toBe("support_required");
  });

  it.each([0, 366])("rejects terminal Result retention configuration %i", (resultRetentionDays) => {
    const access = { ...baseSnapshot().accesses[0]!, attemptsAvailable: 0 };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      product: { ...baseSnapshot().product!, resultRetentionDays },
      accesses: [access],
      attempts: [terminalAttempt()]
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
        paidAt: null,
        paymentAttempts: [{
          ...baseSnapshot().orders[0]!.paymentAttempts[0]!,
          status,
          paidAt: null
        }]
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

  it.each([
    ["inactive Product", { isActive: false }],
    ["wrong Product price", { priceMinor: 999 }],
    ["wrong Product currency", { currency: "USD" }]
  ] as const)("maps %s without Access to support_required", (_label, productChange) => {
    const product = { ...baseSnapshot().product!, ...productChange };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      product,
      users: [],
      orders: [],
      accesses: [],
      attempts: []
    }), now).state).toBe("support_required");
  });

  it.each([
    ["unpublished Test", { status: "HIDDEN" as const, deletedAt: null }],
    ["deleted Test", { status: "PUBLISHED" as const, deletedAt: now }]
  ])("maps %s without Access to support_required", (_label, testChange) => {
    const original = baseSnapshot().product!;
    const product = { ...original, test: { ...original.test, ...testChange } };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      product,
      users: [],
      orders: [],
      accesses: [],
      attempts: []
    }), now).state).toBe("support_required");
  });

  it("rejects contradictory terminal Order/PaymentAttempt truth", () => {
    const order = {
      ...baseSnapshot().orders[0]!,
      status: "FAILED" as const,
      paidAt: null,
      paymentAttempts: [{
        ...baseSnapshot().orders[0]!.paymentAttempts[0]!,
        status: "CANCELLED" as const,
        paidAt: null
      }]
    };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      orders: [order],
      users: [],
      accesses: [],
      attempts: []
    }), now).state).toBe("support_required");
  });

  it("keeps valid existing entitlement states recoverable when Product is inactive", () => {
    const inactiveProduct = { ...baseSnapshot().product!, isActive: false };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({ product: inactiveProduct }), now).state)
      .toBe("access_unstarted");

    const consumedAccess = { ...baseSnapshot().accesses[0]!, attemptsAvailable: 0 };
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      product: inactiveProduct,
      accesses: [consumedAccess],
      attempts: [{ ...terminalAttempt(), status: "STARTED", finishedAt: null }]
    }), now).state).toBe("attempt_active");
    expect(resolveRecoveryStateSnapshot(baseSnapshot({
      product: inactiveProduct,
      accesses: [consumedAccess],
      attempts: [terminalAttempt()]
    }), now).state).toBe("result_available");
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
    expect(source).not.toMatch(/transaction\.answer|\.answers\b/);
  });

  it("loads every business model through one read-only REPEATABLE READ transaction", async () => {
    const snapshot = baseSnapshot();
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      commercialProduct: { findUnique: vi.fn().mockResolvedValue(snapshot.product) },
      user: { findMany: vi.fn().mockResolvedValue(snapshot.users) },
      commercialOrder: { findMany: vi.fn().mockResolvedValue(snapshot.orders) },
      access: { findMany: vi.fn().mockResolvedValue(snapshot.accesses) },
      attempt: { findMany: vi.fn().mockResolvedValue(snapshot.attempts) }
    } as unknown as Prisma.TransactionClient;
    const client = {
      $transaction: vi.fn((callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(transaction)
      )
    } as unknown as PrismaClient;
    const clock = vi.fn(() => new Date(now));
    const readTransactions: Prisma.TransactionClient[] = [];
    const resolver = createRecoveryStateResolver({
      client,
      productCode: snapshot.configuredProductCode,
      clock,
      snapshotReadHook: async ({ transaction: activeTransaction }) => {
        readTransactions.push(activeTransaction);
      }
    });

    await expect(resolver({
      emailNormalized: snapshot.emailNormalized,
      commercialProductId: snapshot.commercialProductId,
      testId: snapshot.testId
    })).resolves.toEqual({
      state: "access_unstarted",
      screen: "REC-01",
      nextAction: "CONTINUE"
    });

    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
    expect(transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(readTransactions).toEqual([transaction, transaction]);
    expect(clock).toHaveBeenCalledOnce();
    expect(transaction.commercialProduct.findUnique).toHaveBeenCalledOnce();
    expect(transaction.user.findMany).toHaveBeenCalledOnce();
    expect(transaction.commercialOrder.findMany).toHaveBeenCalledOnce();
    expect(transaction.access.findMany).toHaveBeenCalledOnce();
    expect(transaction.attempt.findMany).toHaveBeenCalledOnce();
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
