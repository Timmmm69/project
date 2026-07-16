import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  createAttemptStartHandler,
  type AttemptStartRouteDependencies
} from "@/app/api/attempts/start/route";
import {
  authorizeVerifiedStudentDestination,
  resolveVerifiedStudentEntryDestination,
  type VerifiedDestinationGuardDependencies,
  type VerifiedStudentEntryResolution,
  type VerifiedStudentEntryState
} from "@/server/auth/verified-student-session/destination-guard";
import type { ResolveVerifiedStudentSessionResult } from "@/server/auth/verified-student-session/service";

const ids = {
  session: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  test: "44444444-4444-4444-8444-444444444444",
  access: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  secondAttempt: "77777777-7777-4777-8777-777777777777",
  operation: "88888888-8888-4888-8888-888888888888"
} as const;

const now = new Date("2026-07-16T10:00:00.000Z");

type Resolved = Extract<ResolveVerifiedStudentSessionResult, { status: "RESOLVED" }>;

function resolved(overrides: Partial<Resolved> = {}): Resolved {
  return {
    status: "RESOLVED",
    sessionId: ids.session,
    scope: {
      userId: ids.user,
      commercialProductId: ids.product,
      testId: ids.test,
      accessId: ids.access
    },
    source: "COMMERCIAL_ORDER_CLAIM",
    sourceReferenceId: ids.operation,
    issuanceOperationId: ids.operation,
    tokenGeneration: 1,
    issuedAt: new Date("2026-07-15T10:00:00.000Z"),
    expiresAt: new Date("2026-07-22T10:00:00.000Z"),
    ...overrides
  };
}

function attempt(status = "STARTED", overrides: Record<string, unknown> = {}) {
  return {
    id: ids.attempt,
    userId: ids.user,
    testId: ids.test,
    accessId: ids.access,
    status,
    ...overrides
  };
}

function entryState(overrides: Partial<VerifiedStudentEntryState> = {}): VerifiedStudentEntryState {
  return {
    id: ids.access,
    userId: ids.user,
    testId: ids.test,
    source: "COMMERCIAL",
    commercialProductId: ids.product,
    attemptsAvailable: 1,
    revokedAt: null,
    expiresAt: new Date("2026-08-16T10:00:00.000Z"),
    startDeadlineAt: new Date("2026-08-16T10:00:00.000Z"),
    user: {
      id: ids.user,
      email: "student@example.test",
      role: "STUDENT",
      deletedAt: null
    },
    commercialProduct: { id: ids.product, testId: ids.test },
    attempts: [],
    ...overrides
  };
}

function authenticTarget(): {
  kind: "PRE";
  classification: "AUTHENTIC" | "GENERIC";
  test: {
    id: string;
    slug: string;
    examMode: string;
    commercialProducts: Array<{ id: string; testId: string }>;
  };
} {
  return {
    kind: "PRE",
    classification: "AUTHENTIC",
    test: {
      id: ids.test,
      slug: "canonical-test",
      examMode: "RIKZ_RUSSIAN_2026",
      commercialProducts: [{ id: ids.product, testId: ids.test }]
    }
  };
}

function authenticAttemptTarget(status: "STARTED" | "COMPLETED" | "EXPIRED", attemptsAvailable: number) {
  return {
    kind: "ATTEMPT",
    classification: "AUTHENTIC",
    attempt: {
      ...attempt(status),
      testSnapshot: { examMode: "rikz_russian_2026" },
      test: {
        id: ids.test,
        examMode: "RIKZ_RUSSIAN_2026",
        commercialProducts: [{ id: ids.product, testId: ids.test }]
      },
      access: {
        id: ids.access,
        userId: ids.user,
        testId: ids.test,
        source: "COMMERCIAL",
        commercialProductId: ids.product,
        commercialOrderId: ids.operation,
        commercialPaymentAttemptId: ids.operation,
        attemptsAvailable,
        revokedAt: null,
        expiresAt: new Date("2026-08-16T10:00:00.000Z"),
        user: {
          id: ids.user,
          email: "student@example.test",
          role: "STUDENT",
          deletedAt: null
        },
        commercialProduct: { id: ids.product, testId: ids.test }
      }
    }
  };
}

function resolverDependencies(input: {
  mode?: "off" | "shadow" | "enforce";
  cookie?: string | null;
  resolution?: ResolveVerifiedStudentSessionResult;
  state?: VerifiedStudentEntryState | null;
  target?: ReturnType<typeof authenticTarget> & { classification: "AUTHENTIC" | "GENERIC" };
} = {}): VerifiedDestinationGuardDependencies {
  return {
    client: {} as PrismaClient,
    verifiedSessionConfig: {
      mode: input.mode ?? "enforce",
      activeKeyVersion: "v1",
      keys: new Map()
    },
    clock: () => now,
    readCookie: vi.fn(async () => input.cookie === undefined ? "verified-token" : input.cookie),
    resolveSession: vi.fn(async () => input.resolution ?? resolved()),
    loadTarget: vi.fn(async () => (input.target ?? authenticTarget()) as never),
    loadEntryState: vi.fn(async () => input.state === undefined ? entryState() : input.state)
  };
}

async function resolveEntry(input: Parameters<typeof resolverDependencies>[0] = {}) {
  return resolveVerifiedStudentEntryDestination(
    { testId: ids.test },
    undefined,
    resolverDependencies(input)
  );
}

describe("verified PRE entry destination resolver", () => {
  it("routes an exact unused Access to canonical PRE without an Attempt", async () => {
    expect(await resolveEntry()).toMatchObject({
      status: "AUTHORIZED",
      nextAction: "OPEN_PRE",
      nextUrl: "/tests/canonical-test",
      context: { destination: "PRE", attemptId: null }
    });
  });

  it.each([
    ["STARTED", "OPEN_ATTEMPT", `/attempts/${ids.attempt}`, "ATT"],
    ["COMPLETED", "OPEN_RESULT", `/results/${ids.attempt}`, "RES"],
    ["EXPIRED", "OPEN_RESULT", `/results/${ids.attempt}`, "RES"]
  ] as const)("routes exact %s state", async (status, nextAction, nextUrl, destination) => {
    expect(await resolveEntry({
      state: entryState({ attemptsAvailable: 0, attempts: [attempt(status)] })
    })).toMatchObject({
      status: "AUTHORIZED",
      nextAction,
      nextUrl,
      context: { destination, attemptId: ids.attempt }
    });
  });

  it.each([
    ["no Attempt with zero availability", entryState({ attemptsAvailable: 0 })],
    ["no Attempt with excess availability", entryState({ attemptsAvailable: 2 })],
    ["no Attempt with negative availability", entryState({ attemptsAvailable: -1 })],
    ["STARTED with remaining availability", entryState({ attemptsAvailable: 1, attempts: [attempt()] })],
    ["COMPLETED with remaining availability", entryState({ attemptsAvailable: 1, attempts: [attempt("COMPLETED")] })],
    ["EXPIRED with remaining availability", entryState({ attemptsAvailable: 1, attempts: [attempt("EXPIRED")] })],
    ["two Attempts", entryState({ attemptsAvailable: 0, attempts: [attempt(), attempt("COMPLETED", { id: ids.secondAttempt })] })],
    ["wrong User", entryState({ attemptsAvailable: 0, attempts: [attempt("STARTED", { userId: "wrong-user" })] })],
    ["wrong Test", entryState({ attemptsAvailable: 0, attempts: [attempt("STARTED", { testId: "wrong-test" })] })],
    ["wrong Access", entryState({ attemptsAvailable: 0, attempts: [attempt("STARTED", { accessId: "wrong-access" })] })],
    ["wrong Product", entryState({ commercialProductId: "wrong-product" })],
    ["revoked Access", entryState({ revokedAt: now })],
    ["unsupported status", entryState({ attemptsAvailable: 0, attempts: [attempt("CANCELLED")] })]
  ])("rejects %s", async (_label, state) => {
    expect(await resolveEntry({ state })).toMatchObject({
      status: "REJECTED",
      code: "VERIFIED_SCOPE_NOT_ALLOWED"
    });
  });

  it("rejects expired unstarted Access", async () => {
    expect(await resolveEntry({
      state: entryState({
        expiresAt: new Date("2026-07-16T09:59:59.000Z"),
        startDeadlineAt: new Date("2026-07-16T09:59:59.000Z")
      })
    })).toMatchObject({ status: "REJECTED", code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it.each([
    ["STARTED", "OPEN_ATTEMPT"],
    ["COMPLETED", "OPEN_RESULT"],
    ["EXPIRED", "OPEN_RESULT"]
  ] as const)("lets exact %s outrank Access expiry", async (status, nextAction) => {
    expect(await resolveEntry({
      state: entryState({
        attemptsAvailable: 0,
        expiresAt: new Date("2026-07-16T09:59:59.000Z"),
        startDeadlineAt: new Date("2026-07-16T09:59:59.000Z"),
        attempts: [attempt(status)]
      })
    })).toMatchObject({ status: "AUTHORIZED", nextAction });
  });

  it("requires exactly one remaining attempt for direct PRE authorization", async () => {
    const dependencies = {
      ...resolverDependencies({ state: entryState({ attemptsAvailable: 2 }) }),
      client: {
        access: { findUnique: vi.fn(async () => entryState({ attemptsAvailable: 2 })) }
      } as unknown as PrismaClient
    };
    expect(await authorizeVerifiedStudentDestination(
      { destination: "PRE", testId: ids.test },
      undefined,
      dependencies
    )).toMatchObject({ status: "REJECTED", code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it.each([
    ["ATT", "STARTED"],
    ["RES", "COMPLETED"],
    ["RES", "EXPIRED"]
  ] as const)("requires a consumed counter for direct %s %s authorization", async (destination, status) => {
    for (const [attemptsAvailable, expectedStatus] of [[0, "AUTHORIZED"], [1, "REJECTED"]] as const) {
      const dependencies = {
        ...resolverDependencies(),
        loadTarget: vi.fn(async () => authenticAttemptTarget(status, attemptsAvailable) as never)
      };
      const decision = await authorizeVerifiedStudentDestination(
        { destination, attemptId: ids.attempt },
        undefined,
        dependencies
      );
      expect(decision.status).toBe(expectedStatus);
      if (expectedStatus === "REJECTED") {
        expect(decision).toMatchObject({ code: "VERIFIED_SCOPE_NOT_ALLOWED" });
      }
    }
  });

  it("keeps a generic Test on legacy authority", async () => {
    const target = authenticTarget();
    target.classification = "GENERIC";
    expect(await resolveEntry({ target })).toEqual({
      status: "LEGACY",
      mode: "enforce",
      classification: "GENERIC"
    });
  });

  it("keeps off mode on legacy authority", async () => {
    expect(await resolveEntry({ mode: "off" })).toEqual({
      status: "LEGACY",
      mode: "off",
      classification: "NOT_EVALUATED"
    });
  });

  it("keeps shadow mode legacy without redirect authority", async () => {
    const result = await resolveEntry({ mode: "shadow" });
    expect(result).toMatchObject({
      status: "LEGACY",
      mode: "shadow",
      classification: "AUTHENTIC",
      shadowResult: "AUTHORIZED"
    });
    expect("nextUrl" in result).toBe(false);
    expect("nextAction" in result).toBe(false);
  });

  it.each([
    ["missing", null, resolved()],
    ["invalid", "invalid-token", { status: "INVALID_TOKEN" } as const]
  ])("rejects a %s verified cookie in enforce", async (_label, cookie, resolution) => {
    expect(await resolveEntry({ cookie, resolution })).toMatchObject({
      status: "REJECTED",
      code: "VERIFIED_SESSION_REQUIRED"
    });
  });
});

function authorizedResolution(
  nextAction: "OPEN_PRE" | "OPEN_ATTEMPT" | "OPEN_RESULT"
): Extract<VerifiedStudentEntryResolution, { status: "AUTHORIZED" }> {
  const attemptId = nextAction === "OPEN_PRE" ? null : ids.attempt;
  const destination = nextAction === "OPEN_PRE" ? "PRE" : nextAction === "OPEN_ATTEMPT" ? "ATT" : "RES";
  return {
    status: "AUTHORIZED",
    mode: "enforce",
    classification: "AUTHENTIC",
    nextAction,
    nextUrl: nextAction === "OPEN_PRE"
      ? "/tests/canonical-test"
      : nextAction === "OPEN_ATTEMPT"
        ? `/attempts/${ids.attempt}`
        : `/results/${ids.attempt}`,
    context: {
      destination,
      userId: ids.user,
      userEmail: "student@example.test",
      commercialProductId: ids.product,
      testId: ids.test,
      accessId: ids.access,
      attemptId,
      clearRecoveryCookie: false
    }
  };
}

function routeRequest(email?: string) {
  return new Request("http://entry.test/api/attempts/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ testId: ids.test, ...(email ? { email } : {}) })
  });
}

function routeDependencies(resolution: VerifiedStudentEntryResolution) {
  const startAttempt = vi.fn(async () => ({
    attempt: { id: ids.attempt, status: "STARTED" },
    restored: false
  }));
  const dependencies = {
    resolveEntry: vi.fn(async () => resolution),
    requireStudent: vi.fn(async () => ({ id: ids.user, email: "student@example.test" })),
    startAttempt,
    getAttempt: vi.fn(async () => ({ id: ids.attempt, status: "STARTED" })),
    serializeAttempt: vi.fn((value: { id: string }) => ({ attemptId: value.id }))
  } as unknown as AttemptStartRouteDependencies;
  return { dependencies, startAttempt };
}

describe("authentic final-start route entry resolution", () => {
  it("does not call the start service for an active Attempt", async () => {
    const { dependencies, startAttempt } = routeDependencies(authorizedResolution("OPEN_ATTEMPT"));
    const response = await createAttemptStartHandler(dependencies)(routeRequest());
    expect(response.status).toBe(200);
    expect(startAttempt).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      data: {
        nextAction: "OPEN_ATTEMPT",
        nextUrl: `/attempts/${ids.attempt}`,
        attempt: { attemptId: ids.attempt },
        restored: true
      }
    });
  });

  it("does not call the start service for a terminal Attempt", async () => {
    const { dependencies, startAttempt } = routeDependencies(authorizedResolution("OPEN_RESULT"));
    const response = await createAttemptStartHandler(dependencies)(routeRequest());
    expect(response.status).toBe(200);
    expect(startAttempt).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      data: {
        nextAction: "OPEN_RESULT",
        nextUrl: `/results/${ids.attempt}`,
        restored: true
      }
    });
  });

  it("calls the start service once only for OPEN_PRE", async () => {
    const { dependencies, startAttempt } = routeDependencies(authorizedResolution("OPEN_PRE"));
    const response = await createAttemptStartHandler(dependencies)(routeRequest());
    expect(response.status).toBe(200);
    expect(startAttempt).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({
      data: {
        nextAction: "OPEN_ATTEMPT",
        nextUrl: `/attempts/${ids.attempt}`,
        restored: false
      }
    });
  });

  it("does not call the start service after resolver rejection", async () => {
    const { dependencies, startAttempt } = routeDependencies({
      status: "REJECTED",
      mode: "enforce",
      classification: "AUTHENTIC",
      code: "VERIFIED_SCOPE_NOT_ALLOWED"
    });
    const response = await createAttemptStartHandler(dependencies)(routeRequest());
    expect(response.status).toBe(403);
    expect(startAttempt).not.toHaveBeenCalled();
  });

  it("keeps the generic legacy response contract unchanged", async () => {
    const { dependencies, startAttempt } = routeDependencies({
      status: "LEGACY",
      mode: "enforce",
      classification: "GENERIC"
    });
    const response = await createAttemptStartHandler(dependencies)(routeRequest("student@example.test"));
    expect(response.status).toBe(200);
    expect(startAttempt).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      success: true,
      data: { attempt: { attemptId: ids.attempt }, restored: false }
    });
  });

  it("does not expose authentic email or raw token fields", async () => {
    const { dependencies } = routeDependencies(authorizedResolution("OPEN_ATTEMPT"));
    const text = await (await createAttemptStartHandler(dependencies)(routeRequest())).text();
    expect(text).not.toContain("student@example.test");
    expect(text).not.toContain("verified-token");
    expect(text).not.toContain(ids.access);
    expect(text).not.toContain(ids.product);
  });
});
