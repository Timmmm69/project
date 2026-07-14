import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  createCommercialClaimAccessHandler,
  type CommercialClaimAccessRouteDependencies
} from "@/app/api/commercial/orders/[publicId]/claim-access/route";
import {
  createCommercialStartAttemptHandler,
  type CommercialStartAttemptRouteDependencies
} from "@/app/api/commercial/orders/[publicId]/start-attempt/route";
import {
  finalizeCommercialOrderSessionResponse,
  issueCommercialOrderVerifiedSession,
  type CommercialOrderSessionClaim,
  type CommercialOrderSessionIssuance
} from "@/server/auth/verified-student-session/commercial-order-issuer";
import {
  VerifiedStudentSessionServiceError,
  type IssueVerifiedStudentSessionResult
} from "@/server/auth/verified-student-session/service";

const ids = {
  order: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  test: "44444444-4444-4444-8444-444444444444",
  access: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  session: "77777777-7777-4777-8777-777777777777",
  operation: "88888888-8888-4888-8888-888888888888"
} as const;

const rawToken = `vs1.v1.${Buffer.alloc(32, 7).toString("base64url")}`;
const issuedAt = new Date("2026-07-15T10:00:00.000Z");
const expiresAt = new Date("2026-07-22T10:00:00.000Z");

type Claim = CommercialOrderSessionClaim & Readonly<{
  attemptId: string | null;
  nextAction: "START_TEST" | "RESUME_TEST" | "VIEW_RESULT";
  nextUrl: string;
}>;

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    orderId: ids.order,
    examMode: "RIKZ_RUSSIAN_2026",
    student: { userId: ids.user, email: "student@example.test", role: "STUDENT" as const },
    commercialProductId: ids.product,
    testId: ids.test,
    accessId: ids.access,
    attemptId: ids.attempt,
    nextAction: "RESUME_TEST" as const,
    nextUrl: `/attempts/${ids.attempt}`,
    ...overrides
  };
}

function issuedResult(overrides: Partial<IssueVerifiedStudentSessionResult> = {}): IssueVerifiedStudentSessionResult {
  return {
    sessionId: ids.session,
    outcome: "ISSUED",
    source: "COMMERCIAL_ORDER_CLAIM",
    rawToken,
    tokenGeneration: 1,
    issuedAt,
    expiresAt,
    userId: ids.user,
    commercialProductId: ids.product,
    testId: ids.test,
    accessId: ids.access,
    ...overrides
  };
}

function issued(mode: "shadow" | "enforce" = "enforce"): CommercialOrderSessionIssuance {
  return { status: "ISSUED", mode, result: issuedResult() };
}

function request(operationId: string | null = ids.operation) {
  return new Request("http://issuer.test/api/commercial/orders/order-public-id/start-attempt", {
    method: "POST",
    headers: {
      origin: "http://issuer.test",
      ...(operationId === null ? {} : { "Idempotency-Key": operationId })
    }
  });
}

function context() {
  return { params: Promise.resolve({ publicId: "order-public-id" }) };
}

function authorized(
  destination: "PRE" | "ATT" | "RES" = "ATT",
  attemptId: string | null = ids.attempt
) {
  return {
    status: "AUTHORIZED" as const,
    mode: "enforce" as const,
    classification: "AUTHENTIC" as const,
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

function startDependencies(input: {
  issuance?: CommercialOrderSessionIssuance;
  authorization?: ReturnType<typeof authorized> | {
    status: "LEGACY";
    mode: "off" | "shadow" | "enforce";
    classification: "AUTHENTIC" | "GENERIC" | "UNKNOWN" | "NOT_EVALUATED";
  } | {
    status: "REJECTED";
    mode: "enforce";
    classification: "AUTHENTIC";
    code: "VERIFIED_SESSION_REQUIRED" | "VERIFIED_SCOPE_NOT_ALLOWED";
  };
  claim?: ReturnType<typeof claim>;
  orderToken?: boolean;
} = {}) {
  const claimResult = input.claim ?? claim();
  const startAttempt = vi.fn(async () => ({
    attempt: {
      id: ids.attempt,
      testId: ids.test,
      status: "STARTED",
      startedAt: issuedAt,
      finishedAt: null,
      testSnapshot: { testId: ids.test, title: "Test", subject: "russian", mode: "ce_ct", examMode: "rikz_russian_2026", durationMinutes: 120, maxRawScore: 0, questions: [] },
      answers: []
    },
    restored: false
  }));
  const authorizeDestination = vi.fn(async (
    _target: unknown,
    _request?: Request,
    _dependencies?: { readCookie?: () => Promise<string | null> }
  ) => {
    void _target;
    void _request;
    void _dependencies;
    return input.authorization ?? authorized();
  });
  const dependencies = {
    requireOrderToken: vi.fn(async () => input.orderToken ?? true),
    claimAccess: vi.fn(async () => claimResult),
    issueSession: vi.fn(async () => input.issuance ?? issued()),
    authorizeDestination,
    setLegacySession: vi.fn(async () => {}),
    startAttempt
  } as unknown as CommercialStartAttemptRouteDependencies;
  return { dependencies, startAttempt, authorizeDestination };
}

describe("commercial Order verified-session issuer", () => {
  it("off mode does not issue a verified session", async () => {
    const issueSession = vi.fn();
    expect(await issueCommercialOrderVerifiedSession(claim(), ids.operation, {
      environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "off" },
      issueSession
    })).toEqual({ status: "LEGACY", mode: "off", reason: "MODE_OFF" });
    expect(issueSession).not.toHaveBeenCalled();
  });

  it.each(["shadow", "enforce"] as const)("%s issues an exact scoped session", async (mode) => {
    const issueSession = vi.fn(async (issueInput: unknown) => {
      void issueInput;
      return issuedResult();
    });
    const result = await issueCommercialOrderVerifiedSession(claim(), ids.operation, {
      config: { mode, activeKeyVersion: "v1", keys: new Map() },
      issueSession
    });
    expect(result).toMatchObject({ status: "ISSUED", mode });
    expect(issueSession).toHaveBeenCalledWith({
      source: "COMMERCIAL_ORDER_CLAIM",
      sourceReferenceId: ids.order,
      issuanceOperationId: ids.operation,
      userId: ids.user,
      commercialProductId: ids.product,
      testId: ids.test,
      accessId: ids.access
    });
  });

  it("uses the internal Order id rather than public or secret claim fields", async () => {
    const issueSession = vi.fn(async (issueInput: unknown) => {
      void issueInput;
      return issuedResult();
    });
    const enriched = { ...claim(), publicId: "public-order", lookupToken: "order-secret" };
    await issueCommercialOrderVerifiedSession(enriched, ids.operation, {
      config: { mode: "enforce", activeKeyVersion: "v1", keys: new Map() },
      issueSession
    });
    const input = issueSession.mock.calls[0][0] as Record<string, unknown>;
    expect(input.sourceReferenceId).toBe(ids.order);
    expect(JSON.stringify(input)).not.toContain("public-order");
    expect(JSON.stringify(input)).not.toContain("order-secret");
  });

  it("keeps a generic Test on legacy behavior even in enforce mode", async () => {
    const issueSession = vi.fn();
    expect(await issueCommercialOrderVerifiedSession(
      claim({ examMode: "GENERIC" }),
      ids.operation,
      {
        environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "enforce" },
        issueSession
      }
    )).toEqual({ status: "LEGACY", mode: "enforce", reason: "GENERIC_TEST" });
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("shadow safely falls back without producing a token after issuance failure", async () => {
    const result = await issueCommercialOrderVerifiedSession(claim(), ids.operation, {
      config: { mode: "shadow", activeKeyVersion: "v1", keys: new Map() },
      issueSession: vi.fn(async () => { throw new Error("database unavailable"); })
    });
    expect(result).toEqual({
      status: "LEGACY",
      mode: "shadow",
      reason: "SHADOW_ISSUANCE_UNAVAILABLE"
    });
    expect(JSON.stringify(result)).not.toContain(rawToken);
  });

  it.each(["SUBJECT_INVALID", "ACCESS_REVOKED", "ACCESS_EXPIRED", "SCOPE_MISMATCH"] as const)(
    "enforce maps %s to a safe scope rejection",
    async (code) => {
      expect(await issueCommercialOrderVerifiedSession(claim(), ids.operation, {
        config: { mode: "enforce", activeKeyVersion: "v1", keys: new Map() },
        issueSession: vi.fn(async () => { throw new VerifiedStudentSessionServiceError(code); })
      })).toEqual({ status: "SCOPE_NOT_ALLOWED", mode: "enforce" });
    }
  );

  it("enforce maps unavailable configuration or rotation to safe unavailable", async () => {
    expect(await issueCommercialOrderVerifiedSession(claim(), ids.operation, {
      environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "enforce" }
    })).toEqual({ status: "UNAVAILABLE", mode: "enforce" });
    expect(await issueCommercialOrderVerifiedSession(claim(), ids.operation, {
      config: { mode: "enforce", activeKeyVersion: "v1", keys: new Map() },
      issueSession: vi.fn(async () => { throw new VerifiedStudentSessionServiceError("SESSION_INACTIVE"); })
    })).toEqual({ status: "UNAVAILABLE", mode: "enforce" });
  });

  it("sets the canonical verified cookie without exposing the raw token in JSON", async () => {
    const response = finalizeCommercialOrderSessionResponse(
      NextResponse.json({ success: true, data: { nextUrl: "/attempts/safe" } }),
      issued()
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("verified_student_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(expiresAt.toUTCString());
    expect(await response.text()).not.toContain(rawToken);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each([
    { status: "LEGACY", mode: "off", reason: "MODE_OFF" },
    { status: "SCOPE_NOT_ALLOWED", mode: "enforce" },
    { status: "UNAVAILABLE", mode: "enforce" }
  ] as CommercialOrderSessionIssuance[])("does not set a verified cookie for $status", (issuance) => {
    const response = finalizeCommercialOrderSessionResponse(NextResponse.json({ ok: true }), issuance);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("commercial Order issuer route boundary", () => {
  it.each([null, "not-a-uuid"])("rejects missing or malformed idempotency key: %s", async (key) => {
    const { dependencies } = startDependencies();
    const response = await createCommercialStartAttemptHandler(dependencies)(request(key), context());
    expect(response.status).toBe(422);
    expect(dependencies.requireOrderToken).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalid Order token before claim or issuance", async () => {
    const { dependencies } = startDependencies({ orderToken: false });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ORDER_TOKEN_REQUIRED");
    expect(dependencies.claimAccess).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not treat the Order token or legacy flow as destination authority in enforce", async () => {
    const { dependencies, startAttempt } = startDependencies({
      authorization: {
        status: "REJECTED",
        mode: "enforce",
        classification: "AUTHENTIC",
        code: "VERIFIED_SESSION_REQUIRED"
      }
    });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(401);
    expect(startAttempt).not.toHaveBeenCalled();
    expect(dependencies.setLegacySession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("passes only the newly issued raw token through the guard dependency boundary", async () => {
    const { dependencies, authorizeDestination } = startDependencies();
    await createCommercialStartAttemptHandler(dependencies)(request(), context());
    const guardDependencies = authorizeDestination.mock.calls[0][2];
    if (!guardDependencies?.readCookie) throw new Error("expected server-only cookie reader");
    expect(await guardDependencies.readCookie()).toBe(rawToken);
  });

  it("guard scope rejection does not set a verified cookie or write an Attempt", async () => {
    const { dependencies, startAttempt } = startDependencies({
      authorization: {
        status: "REJECTED",
        mode: "enforce",
        classification: "AUTHENTIC",
        code: "VERIFIED_SCOPE_NOT_ALLOWED"
      }
    });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(403);
    expect(startAttempt).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("START_TEST invokes the existing start service only after verified authorization", async () => {
    const fixture = claim({ attemptId: null, nextAction: "START_TEST", nextUrl: `/tests/${ids.test}` });
    const decision = authorized("PRE", null);
    const { dependencies, startAttempt } = startDependencies({ claim: fixture, authorization: decision });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(200);
    expect(startAttempt).toHaveBeenCalledWith({
      studentId: ids.user,
      email: "student@example.test",
      testId: ids.test,
      authorizedAccessId: ids.access
    });
    expect(response.headers.get("set-cookie")).toContain("verified_student_session=");
  });

  it.each(["RESUME_TEST", "VIEW_RESULT"] as const)("%s returns the allowlisted URL without an Attempt write", async (nextAction) => {
    const nextUrl = nextAction === "RESUME_TEST"
      ? `/attempts/${ids.attempt}`
      : `/results/${ids.attempt}`;
    const { dependencies, startAttempt } = startDependencies({
      claim: claim({ nextAction, nextUrl })
    });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(200);
    expect(startAttempt).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ data: { nextAction, nextUrl } });
  });

  it("off mode preserves the legacy session and does not set a verified cookie", async () => {
    const { dependencies } = startDependencies({
      issuance: { status: "LEGACY", mode: "off", reason: "MODE_OFF" },
      authorization: { status: "LEGACY", mode: "off", classification: "NOT_EVALUATED" }
    });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(200);
    expect(dependencies.setLegacySession).toHaveBeenCalledWith(claim().student);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("shadow issues the verified cookie and preserves the legacy flow", async () => {
    const { dependencies } = startDependencies({
      issuance: issued("shadow"),
      authorization: { status: "LEGACY", mode: "shadow", classification: "AUTHENTIC" }
    });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(200);
    expect(dependencies.setLegacySession).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain("verified_student_session=");
  });

  it("verified issuance unavailable fails safely without setting either session", async () => {
    const { dependencies, startAttempt } = startDependencies({
      issuance: { status: "UNAVAILABLE", mode: "enforce" }
    });
    const response = await createCommercialStartAttemptHandler(dependencies)(request(), context());
    expect(response.status).toBe(503);
    expect(startAttempt).not.toHaveBeenCalled();
    expect(dependencies.setLegacySession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("the separate canonical claim route uses the same issuer and operation UUID", async () => {
    const dependencies = {
      requireOrderToken: vi.fn(async () => true),
      claimAccess: vi.fn(async () => claim()),
      issueSession: vi.fn(async () => issued()),
      setLegacySession: vi.fn(async () => {})
    } as unknown as CommercialClaimAccessRouteDependencies;
    const response = await createCommercialClaimAccessHandler(dependencies)(request(), context());
    expect(response.status).toBe(200);
    expect(dependencies.issueSession).toHaveBeenCalledWith(expect.objectContaining({ orderId: ids.order }), ids.operation);
    expect(response.headers.get("set-cookie")).toContain("verified_student_session=");
    const text = await response.text();
    expect(text).not.toContain(rawToken);
    expect(text).not.toContain(ids.order);
    expect(text).not.toContain(ids.user);
    expect(text).not.toContain(ids.access);
    expect(text).not.toContain(ids.product);
    expect(text).not.toContain(ids.operation);
  });

  it.each([null, "not-a-uuid"])(
    "claim route rejects missing or malformed idempotency key: %s",
    async (key) => {
      const dependencies = {
        requireOrderToken: vi.fn(async () => true),
        claimAccess: vi.fn(async () => claim()),
        issueSession: vi.fn(async () => issued()),
        setLegacySession: vi.fn(async () => {})
      } as unknown as CommercialClaimAccessRouteDependencies;
      const response = await createCommercialClaimAccessHandler(dependencies)(request(key), context());
      expect(response.status).toBe(422);
      expect(dependencies.requireOrderToken).not.toHaveBeenCalled();
      expect(dependencies.issueSession).not.toHaveBeenCalled();
    }
  );

  it("claim route missing authority cannot issue or set a verified cookie", async () => {
    const dependencies = {
      requireOrderToken: vi.fn(async () => false),
      claimAccess: vi.fn(),
      issueSession: vi.fn(),
      setLegacySession: vi.fn()
    } as unknown as CommercialClaimAccessRouteDependencies;
    const response = await createCommercialClaimAccessHandler(dependencies)(request(randomUUID()), context());
    expect(response.status).toBe(403);
    expect(dependencies.issueSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
