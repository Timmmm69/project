import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  createCommercialClaimAccessHandler,
  type CommercialClaimAccessRouteDependencies
} from "@/app/api/commercial/orders/[publicId]/claim-access/route";
import {
  createCommercialStartAttemptHandler
} from "@/app/api/commercial/orders/[publicId]/start-attempt/route";
import { CommercialError } from "@/lib/commercial/commercial-service";
import {
  decideCommercialOrderSessionOperation,
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
  nextAction: "OPEN_PRE" | "RESUME_TEST" | "VIEW_RESULT";
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

function request(operationId: string | null = ids.operation, surface: "claim-access" | "start-attempt" = "claim-access") {
  return new Request(`http://issuer.test/api/commercial/orders/order-public-id/${surface}`, {
    method: "POST",
    headers: {
      origin: "http://issuer.test",
      "x-test-internal-request": "true",
      ...(operationId === null ? {} : { "Idempotency-Key": operationId })
    }
  });
}

function context(publicId = "order-public-id") {
  return { params: Promise.resolve({ publicId }) };
}

function routeDependencies(input: {
  issuance?: CommercialOrderSessionIssuance;
  claim?: ReturnType<typeof claim>;
  orderToken?: boolean;
} = {}) {
  const claimResult = input.claim ?? claim();
  const dependencies = {
    requireOrderToken: vi.fn(async () => input.orderToken ?? true),
    claimAccess: vi.fn(async () => claimResult),
    resolveIssuance: vi.fn(async () => input.issuance ?? issued()),
    setLegacySession: vi.fn(async () => {})
  } as unknown as CommercialClaimAccessRouteDependencies;
  return dependencies;
}

describe("commercial Order verified-session issuer", () => {
  it.each([null, "not-a-uuid"])("off mode ignores operation key %s and does not issue", async (key) => {
    const issueSession = vi.fn();
    expect(await issueCommercialOrderVerifiedSession(claim(), key, {
      environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "off" },
      issueSession
    })).toEqual({ status: "LEGACY", mode: "off", reason: "MODE_OFF" });
    expect(issueSession).not.toHaveBeenCalled();
  });

  it.each([null, "not-a-uuid"])("generic mode ignores operation key %s before mode resolution", async (key) => {
    const issueSession = vi.fn();
    expect(await issueCommercialOrderVerifiedSession(claim({ examMode: "GENERIC" }), key, {
      environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "invalid-mode" },
      issueSession
    })).toEqual({ status: "LEGACY", mode: null, reason: "GENERIC_TEST" });
    expect(issueSession).not.toHaveBeenCalled();
  });

  it.each(["shadow", "enforce"] as const)("authentic %s requires a valid operation UUID", async (mode) => {
    const issueSession = vi.fn();
    for (const key of [null, "not-a-uuid"]) {
      expect(await issueCommercialOrderVerifiedSession(claim(), key, {
        config: { mode, activeKeyVersion: "v1", keys: new Map() },
        issueSession
      })).toEqual({ status: "INVALID_OPERATION", mode });
    }
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("exposes one closed decision table for both route surfaces", () => {
    expect(decideCommercialOrderSessionOperation(
      claim({ examMode: "GENERIC" }),
      null,
      { environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "enforce" } }
    )).toEqual({ status: "LEGACY_GENERIC" });
    expect(decideCommercialOrderSessionOperation(
      claim(),
      "malformed",
      { environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "off" } }
    )).toEqual({ status: "LEGACY_MODE_OFF", mode: "off" });
    expect(decideCommercialOrderSessionOperation(
      claim(),
      ids.operation,
      { environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "enforce" } }
    )).toEqual({ status: "ISSUE", mode: "enforce", issuanceOperationId: ids.operation });
    expect(decideCommercialOrderSessionOperation(
      claim(),
      null,
      { environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "shadow" } }
    )).toEqual({ status: "INVALID_OPERATION", mode: "shadow" });
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
    { status: "INVALID_OPERATION", mode: "enforce" },
    { status: "SCOPE_NOT_ALLOWED", mode: "enforce" },
    { status: "UNAVAILABLE", mode: "enforce" }
  ] as CommercialOrderSessionIssuance[])("does not set a verified cookie for $status", (issuance) => {
    const response = finalizeCommercialOrderSessionResponse(NextResponse.json({ ok: true }), issuance);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("commercial Order issuer route boundary", () => {
  const surfaces = [
    ["claim-access", createCommercialClaimAccessHandler] as const,
    ["start-attempt", createCommercialStartAttemptHandler] as const
  ];

  function expectPrivate(response: Response) {
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }

  it.each(surfaces)("%s rejects CSRF and malformed public IDs without cookies", async (surface, createHandler) => {
    const dependencies = routeDependencies();
    const csrf = new Request("http://issuer.test/private", {
      method: "POST",
      headers: { origin: "http://attacker.test" }
    });
    for (const response of [
      await createHandler(dependencies)(csrf.clone(), context()),
      await createHandler(dependencies)(request(ids.operation, surface), context("bad"))
    ]) {
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expectPrivate(response);
    }
    expect(dependencies.claimAccess).not.toHaveBeenCalled();
  });

  it.each(surfaces)("%s rejects invalid Order authority before claim or issuance", async (surface, createHandler) => {
    const dependencies = routeDependencies({ orderToken: false });
    const response = await createHandler(dependencies)(request(ids.operation, surface), context());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ORDER_TOKEN_REQUIRED");
    expect(dependencies.claimAccess).not.toHaveBeenCalled();
    expect(dependencies.resolveIssuance).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
    expectPrivate(response);
  });

  it.each(surfaces)("%s finalizes paid-proof failure without a verified cookie", async (surface, createHandler) => {
    const dependencies = routeDependencies();
    dependencies.claimAccess = vi.fn(async () => {
      throw new CommercialError("PAYMENT_NOT_CONFIRMED");
    });
    const response = await createHandler(dependencies)(request(ids.operation, surface), context());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(dependencies.resolveIssuance).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
    expectPrivate(response);
  });

  it.each(surfaces)("%s returns the non-creating OPEN_PRE outcome", async (surface, createHandler) => {
    const openPre = claim({ attemptId: null, nextAction: "OPEN_PRE", nextUrl: "/tests/canonical-slug" });
    const dependencies = routeDependencies({ claim: openPre });
    const response = await createHandler(dependencies)(request(ids.operation, surface), context());
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({
      data: { nextAction: "OPEN_PRE", nextUrl: "/tests/canonical-slug", testId: ids.test }
    });
    expect(dependencies.resolveIssuance).toHaveBeenCalledWith(openPre, ids.operation);
    expect("startAttempt" in dependencies).toBe(false);
    expect(response.headers.get("set-cookie")).toContain("verified_student_session=");
    const text = await response.text();
    for (const secret of [rawToken, ids.order, ids.user, ids.access, ids.product, ids.operation]) {
      expect(text).not.toContain(secret);
    }
    expectPrivate(response);
  });

  it.each(surfaces)("%s preserves active and terminal actions", async (surface, createHandler) => {
    for (const nextAction of ["RESUME_TEST", "VIEW_RESULT"] as const) {
      const nextUrl = nextAction === "RESUME_TEST" ? `/attempts/${ids.attempt}` : `/results/${ids.attempt}`;
      const dependencies = routeDependencies({ claim: claim({ nextAction, nextUrl }) });
      const response = await createHandler(dependencies)(request(ids.operation, surface), context());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { nextAction, nextUrl } });
      expect("startAttempt" in dependencies).toBe(false);
      expectPrivate(response);
    }
  });

  it.each(["shadow", "enforce"] as const)("both surfaces reject missing and malformed UUIDs in authentic %s", async (mode) => {
    for (const [surface, createHandler] of surfaces) {
      for (const key of [null, "not-a-uuid"]) {
        const dependencies = routeDependencies({ issuance: { status: "INVALID_OPERATION", mode } });
        const response = await createHandler(dependencies)(request(key, surface), context());
        expect(response.status).toBe(422);
        expect((await response.clone().json()).error.code).toBe("VALIDATION_ERROR");
        expect(dependencies.resolveIssuance).toHaveBeenCalledWith(claim(), key);
        expect(response.headers.get("set-cookie")).toBeNull();
        expectPrivate(response);
      }
    }
  });

  it.each([
    { label: "off", claim: claim(), issuance: { status: "LEGACY", mode: "off", reason: "MODE_OFF" } as const },
    { label: "generic", claim: claim({ examMode: "GENERIC" }), issuance: { status: "LEGACY", mode: null, reason: "GENERIC_TEST" } as const },
    { label: "shadow fallback", claim: claim(), issuance: { status: "LEGACY", mode: "shadow", reason: "SHADOW_ISSUANCE_UNAVAILABLE" } as const }
  ])("both surfaces preserve non-creating $label compatibility", async ({ claim: claimResult, issuance }) => {
    for (const [surface, createHandler] of surfaces) {
      const dependencies = routeDependencies({ claim: claimResult, issuance });
      const response = await createHandler(dependencies)(request(null, surface), context());
      expect(response.status).toBe(200);
      expect(dependencies.setLegacySession).toHaveBeenCalledWith(claimResult.student);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect("startAttempt" in dependencies).toBe(false);
      expectPrivate(response);
    }
  });

  it.each(surfaces)("%s fails safely when verified issuance is unavailable", async (surface, createHandler) => {
    const dependencies = routeDependencies({ issuance: { status: "UNAVAILABLE", mode: "enforce" } });
    const response = await createHandler(dependencies)(request(ids.operation, surface), context());
    expect(response.status).toBe(503);
    expect(dependencies.setLegacySession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
    expectPrivate(response);
  });
});
