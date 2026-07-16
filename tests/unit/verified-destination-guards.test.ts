import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient, VerifiedStudentSessionSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeVerifiedStudentDestination,
  type VerifiedDestinationGuardDependencies
} from "@/server/auth/verified-student-session/destination-guard";
import { isAuthenticRikzRussianExamMode } from "@/server/auth/verified-student-session/exam-mode";
import {
  finalizeVerifiedDestinationResponse,
  verifiedDestinationRejection
} from "@/server/auth/verified-student-session/destination-response";
import type {
  ResolveVerifiedStudentSessionResult
} from "@/server/auth/verified-student-session/service";

const ids = {
  session: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  test: "44444444-4444-4444-8444-444444444444",
  access: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  recovery: "77777777-7777-4777-8777-777777777777",
  operation: "88888888-8888-4888-8888-888888888888"
} as const;

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
    sourceReferenceId: ids.recovery,
    issuanceOperationId: ids.operation,
    tokenGeneration: 1,
    issuedAt: new Date("2026-07-14T10:00:00.000Z"),
    expiresAt: new Date("2026-07-21T10:00:00.000Z"),
    ...overrides
  };
}

function access(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.access,
    userId: ids.user,
    testId: ids.test,
    source: "COMMERCIAL",
    commercialProductId: ids.product,
    revokedAt: null,
    expiresAt: new Date("2026-08-14T10:00:00.000Z"),
    user: {
      id: ids.user,
      email: "student@example.test",
      role: "STUDENT",
      deletedAt: null
    },
    commercialProduct: { id: ids.product, testId: ids.test },
    ...overrides
  };
}

function authenticPre(overrides: Record<string, unknown> = {}) {
  return {
    kind: "PRE",
    classification: "AUTHENTIC",
    test: {
      id: ids.test,
      slug: "authentic-test",
      examMode: "RIKZ_RUSSIAN_2026",
      commercialProducts: [{ id: ids.product, testId: ids.test }]
    },
    ...overrides
  };
}

function authenticAttempt(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ATTEMPT",
    classification: "AUTHENTIC",
    attempt: {
      id: ids.attempt,
      userId: ids.user,
      testId: ids.test,
      accessId: ids.access,
      status: "STARTED",
      testSnapshot: { examMode: "rikz_russian_2026" },
      test: {
        id: ids.test,
        examMode: "RIKZ_RUSSIAN_2026",
        commercialProducts: [{ id: ids.product, testId: ids.test }]
      },
      access: {
        ...access(),
        commercialOrderId: ids.operation,
        commercialPaymentAttemptId: ids.session
      }
    },
    ...overrides
  };
}

function classifiedPre(examMode: string, withProduct: boolean) {
  return authenticPre({
    classification: isAuthenticRikzRussianExamMode(examMode, "CURRENT_TEST")
      ? "AUTHENTIC"
      : "GENERIC",
    test: {
      id: ids.test,
      slug: "classified-test",
      examMode,
      commercialProducts: withProduct ? [{ id: ids.product, testId: ids.test }] : []
    }
  });
}

function classifiedAttempt(input: {
  currentExamMode: string;
  snapshotExamMode: string | null;
  accessOverrides?: Record<string, unknown>;
  status?: "STARTED" | "COMPLETED";
}) {
  const target = authenticAttempt();
  target.classification = isAuthenticRikzRussianExamMode(input.currentExamMode, "CURRENT_TEST") ||
    isAuthenticRikzRussianExamMode(input.snapshotExamMode, "ATTEMPT_SNAPSHOT")
    ? "AUTHENTIC"
    : "GENERIC";
  target.attempt.test.examMode = input.currentExamMode;
  (target.attempt as { testSnapshot: unknown }).testSnapshot = input.snapshotExamMode === null
    ? {}
    : { examMode: input.snapshotExamMode };
  target.attempt.status = input.status ?? "STARTED";
  Object.assign(target.attempt.access, input.accessOverrides);
  return target;
}

function fakeClient(input: {
  accessRow?: ReturnType<typeof access> | null;
  recoveryRow?: Record<string, unknown> | null;
} = {}) {
  return {
    access: {
      findUnique: vi.fn(async () => input.accessRow === undefined ? access() : input.accessRow)
    },
    verifiedRecoverySession: {
      findUnique: vi.fn(async () => input.recoveryRow === undefined ? {
        status: "REVOKED",
        revokedAt: new Date("2026-07-14T11:00:00.000Z"),
        revocationCode: "CONTINUED",
        continuationVerifiedStudentSessionId: ids.session,
        continuationOperationId: ids.operation,
        continuedAt: new Date("2026-07-14T11:00:00.000Z")
      } : input.recoveryRow)
    }
  } as unknown as PrismaClient;
}

function dependencies(input: {
  mode?: "off" | "shadow" | "enforce";
  cookie?: string | null;
  resolution?: ResolveVerifiedStudentSessionResult;
  target?: unknown;
  client?: PrismaClient;
  readCookie?: ReturnType<typeof vi.fn>;
  resolveSession?: ReturnType<typeof vi.fn>;
} = {}): VerifiedDestinationGuardDependencies {
  const readCookie = input.readCookie ?? vi.fn(async () => input.cookie === undefined ? "verified-token" : input.cookie);
  const resolveSession = input.resolveSession ?? vi.fn(async () => input.resolution ?? resolved());
  return {
    client: input.client ?? fakeClient(),
    verifiedSessionConfig: {
      mode: input.mode ?? "enforce",
      activeKeyVersion: "v1",
      keys: new Map()
    },
    readCookie,
    resolveSession,
    loadTarget: vi.fn(async () => (input.target ?? authenticPre()) as never)
  };
}

async function authorizePre(input: Parameters<typeof dependencies>[0] = {}) {
  return authorizeVerifiedStudentDestination(
    { destination: "PRE", testId: ids.test },
    undefined,
    dependencies(input)
  );
}

describe("ACC-01A verified destination guard", () => {
  it("1. rejects a missing verified cookie", async () => {
    expect(await authorizePre({ cookie: null })).toMatchObject({
      status: "REJECTED",
      code: "VERIFIED_SESSION_REQUIRED"
    });
  });

  it.each([
    ["2. malformed token", "INVALID_TOKEN"],
    ["3. unknown key", "UNKNOWN_KEY"],
    ["4. unknown session", "NOT_FOUND"],
    ["5. expired session", "EXPIRED"],
    ["6. revoked session", "REVOKED"],
    ["7. revoked Access", "ACCESS_REVOKED"],
    ["expired Access", "ACCESS_EXPIRED"]
  ] as const)("%s is rejected as requiring a verified session", async (_label, status) => {
    expect(await authorizePre({ resolution: { status } })).toMatchObject({
      status: "REJECTED",
      code: "VERIFIED_SESSION_REQUIRED"
    });
  });

  it("8. rejects a missing or non-student subject", async () => {
    expect(await authorizePre({ resolution: { status: "SUBJECT_INVALID" } })).toMatchObject({
      status: "REJECTED",
      code: "VERIFIED_SESSION_REQUIRED"
    });
  });

  it("9. rejects a Product mismatch", async () => {
    const session = resolved({ scope: { ...resolved().scope, commercialProductId: "other-product" } });
    expect(await authorizePre({ resolution: session })).toMatchObject({ code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it("10. rejects a Test mismatch", async () => {
    const session = resolved({ scope: { ...resolved().scope, testId: "other-test" } });
    expect(await authorizePre({ resolution: session })).toMatchObject({ code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it("11. rejects an Access mismatch", async () => {
    const session = resolved({ scope: { ...resolved().scope, accessId: "other-access" } });
    expect(await authorizePre({ resolution: session })).toMatchObject({ code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it("12. accepts an exact PRE scope", async () => {
    expect(await authorizePre()).toMatchObject({
      status: "AUTHORIZED",
      context: { destination: "PRE", userId: ids.user, accessId: ids.access }
    });
  });

  it("13. accepts an exact ATT scope", async () => {
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt },
      undefined,
      dependencies({ target: authenticAttempt() })
    );
    expect(decision).toMatchObject({ status: "AUTHORIZED", context: { attemptId: ids.attempt } });
  });

  it("14. accepts an exact terminal RES scope", async () => {
    const target = authenticAttempt();
    target.attempt.status = "COMPLETED";
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "RES", attemptId: ids.attempt },
      undefined,
      dependencies({ target })
    );
    expect(decision).toMatchObject({ status: "AUTHORIZED", context: { destination: "RES" } });
  });

  it("15. rejects an Attempt owned by another User", async () => {
    const target = authenticAttempt();
    (target.attempt as { userId: string }).userId = "other-user";
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt }, undefined, dependencies({ target })
    );
    expect(decision).toMatchObject({ code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it("16. rejects an Attempt for another Test", async () => {
    const target = authenticAttempt();
    (target.attempt as { testId: string }).testId = "other-test";
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt }, undefined, dependencies({ target })
    );
    expect(decision).toMatchObject({ code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it("17. rejects an Attempt for another Access", async () => {
    const target = authenticAttempt();
    (target.attempt as { accessId: string }).accessId = "other-access";
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt }, undefined, dependencies({ target })
    );
    expect(decision).toMatchObject({ code: "VERIFIED_SCOPE_NOT_ALLOWED" });
  });

  it("18. does not treat the recovery cookie as authority", async () => {
    const request = new Request("http://local.test/private", {
      headers: { cookie: "acc01a_recovery=recovery-token" }
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "PRE", testId: ids.test }, request,
      { ...dependencies(), readCookie: undefined }
    );
    expect(decision).toMatchObject({ code: "VERIFIED_SESSION_REQUIRED" });
  });

  it("19. does not treat the legacy student cookie as authority in enforce mode", async () => {
    const request = new Request("http://local.test/private", {
      headers: { cookie: "student_session=legacy-token" }
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "PRE", testId: ids.test }, request,
      { ...dependencies(), readCookie: undefined }
    );
    expect(decision).toMatchObject({ code: "VERIFIED_SESSION_REQUIRED" });
  });

  it.each([
    ["20. Order-claim", "COMMERCIAL_ORDER_CLAIM"],
    ["21. AccessCode", "ACCESS_CODE"]
  ] as const)("%s source is accepted", async (_label, source) => {
    expect(await authorizePre({ resolution: resolved({ source }) })).toMatchObject({ status: "AUTHORIZED" });
  });

  it("22. accepts a recovery source with exact committed continuation proof", async () => {
    expect(await authorizePre({
      resolution: resolved({ source: "EMAIL_OTP_RECOVERY" })
    })).toMatchObject({
      status: "AUTHORIZED",
      context: { clearRecoveryCookie: true }
    });
  });

  it("23. rejects a source outside the explicit allowlist", async () => {
    const unknown = "FUTURE_SOURCE" as VerifiedStudentSessionSource;
    expect(await authorizePre({ resolution: resolved({ source: unknown }) })).toMatchObject({
      code: "VERIFIED_SCOPE_NOT_ALLOWED"
    });
  });

  it("24. off preserves legacy behavior without reading authority or target", async () => {
    const readCookie = vi.fn();
    const resolveSession = vi.fn();
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "PRE", testId: ids.test },
      undefined,
      {
        environment: { VERIFIED_COMMERCIAL_SESSION_MODE: "off" },
        readCookie,
        resolveSession,
        loadTarget: vi.fn()
      }
    );
    expect(decision).toEqual({ status: "LEGACY", mode: "off", classification: "NOT_EVALUATED" });
    expect(readCookie).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("25. shadow evaluates mismatch without blocking", async () => {
    expect(await authorizePre({ mode: "shadow", cookie: null })).toEqual({
      status: "LEGACY",
      mode: "shadow",
      classification: "AUTHENTIC",
      shadowResult: "VERIFIED_SESSION_REQUIRED"
    });
  });

  it("shadow preserves legacy behavior when verification is unavailable", async () => {
    const resolveSession = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    expect(await authorizePre({ mode: "shadow", resolveSession })).toEqual({
      status: "LEGACY",
      mode: "shadow",
      classification: "AUTHENTIC"
    });
  });

  it("26. enforce blocks an exact-scope mismatch", async () => {
    expect(await authorizePre({ resolution: { status: "SCOPE_MISMATCH" } })).toMatchObject({
      status: "REJECTED",
      mode: "enforce"
    });
  });

  it("27. generic mode bypasses the commercial guard", async () => {
    const readCookie = vi.fn();
    const resolveSession = vi.fn();
    const decision = await authorizePre({
      target: {
        kind: "PRE",
        classification: "GENERIC",
        test: { id: ids.test, slug: "generic", examMode: "GENERIC", commercialProducts: [] }
      },
      readCookie,
      resolveSession
    });
    expect(decision).toEqual({ status: "LEGACY", mode: "enforce", classification: "GENERIC" });
    expect(readCookie).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("28. failure responses do not disclose entity IDs", async () => {
    const decision = await authorizePre({ resolution: resolved({ scope: { ...resolved().scope, accessId: "secret-access-id" } }) });
    if (decision.status !== "REJECTED") throw new Error("expected rejection");
    const body = await verifiedDestinationRejection(decision).text();
    expect(body).not.toContain("secret-access-id");
    expect(body).not.toContain(ids.test);
    expect(body).not.toContain(ids.user);
  });

  it("29. successful recovery-linked authorization clears only the recovery cookie", async () => {
    const decision = await authorizePre({ resolution: resolved({ source: "EMAIL_OTP_RECOVERY" }) });
    const response = finalizeVerifiedDestinationResponse(NextResponse.json({ ok: true }), decision);
    expect(response.headers.get("set-cookie")).toContain("acc01a_recovery=");
    expect(response.headers.get("set-cookie")).not.toContain("verified_student_session=");
  });

  it("30. failed authorization does not clear the recovery cookie", async () => {
    const decision = await authorizePre({ cookie: null });
    if (decision.status !== "REJECTED") throw new Error("expected rejection");
    expect(verifiedDestinationRejection(decision).headers.get("set-cookie")).toBeNull();
  });

  it("31. guard resolves once and never invokes an issuer or rotation path", async () => {
    const resolveSession = vi.fn(async () => resolved());
    await authorizePre({ resolveSession });
    expect(resolveSession).toHaveBeenCalledTimes(1);
  });

  it("32. guard does not extend expiry or set a replacement verified cookie", async () => {
    const originalExpiry = resolved().expiresAt;
    const decision = await authorizePre({ resolution: resolved({ expiresAt: originalExpiry }) });
    const response = finalizeVerifiedDestinationResponse(NextResponse.json({ ok: true }), decision);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(originalExpiry.toISOString()).toBe("2026-07-21T10:00:00.000Z");
  });

  it("33. raw token is absent from logs and rejection responses", async () => {
    const rawToken = "raw-verified-secret";
    const consoleSpies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const decision = await authorizePre({ cookie: rawToken, resolution: { status: "INVALID_TOKEN" } });
    if (decision.status !== "REJECTED") throw new Error("expected rejection");
    expect(await verifiedDestinationRejection(decision).text()).not.toContain(rawToken);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it("34. public Test page resolves verified entry after public serialization and gates dedicated PRE", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(public)/tests/[slug]/page.tsx"), "utf8");
    const publicSerializationIndex = page.indexOf("serializePublicTest(test)");
    const entryResolutionIndex = page.indexOf("resolveVerifiedStudentEntryDestination({ testSlug: slug })");

    expect(publicSerializationIndex).not.toBe(-1);
    expect(entryResolutionIndex).not.toBe(-1);
    expect(publicSerializationIndex).toBeLessThan(entryResolutionIndex);
    expect(page).toMatch(/entryResolution\?\.status\s*===\s*"AUTHORIZED"/);
    expect(page).toMatch(/entryResolution\.nextAction\s*===\s*"OPEN_PRE"/);
    expect(page).toContain("if (verifiedOpenPre && !verifiedProductView)");
    expect(page).toContain("<PrestartConfirmation");
    expect(page).toContain("<h1 className=\"page-title\">{publicTest.title}</h1>");
    expect(page).toContain("Доступ готов. Попытка ещё не начата.");
    expect(page).toContain("Перейти к началу");
    expect(page).not.toContain("verifiedPreAuthorized");
    expect(page).not.toContain("Начать или продолжить тест");
  });

  it("35. classifies PRE generic mode without a product as legacy", async () => {
    expect(await authorizePre({ target: classifiedPre("GENERIC", false) })).toEqual({
      status: "LEGACY",
      mode: "enforce",
      classification: "GENERIC"
    });
  });

  it("36. classifies PRE generic mode with a product as legacy", async () => {
    expect(await authorizePre({ target: classifiedPre("GENERIC", true) })).toEqual({
      status: "LEGACY",
      mode: "enforce",
      classification: "GENERIC"
    });
  });

  it("37. enforces PRE authentic mode even without a loaded matching session", async () => {
    expect(await authorizePre({
      target: classifiedPre("RIKZ_RUSSIAN_2026", false),
      cookie: null
    })).toMatchObject({
      status: "REJECTED",
      classification: "AUTHENTIC",
      code: "VERIFIED_SESSION_REQUIRED"
    });
  });

  it("38. does not use a commercial product alone as authentic evidence", async () => {
    const readCookie = vi.fn();
    const resolveSession = vi.fn();
    expect(isAuthenticRikzRussianExamMode("GENERIC", "CURRENT_TEST")).toBe(false);
    expect(await authorizePre({
      target: classifiedPre("GENERIC", true),
      readCookie,
      resolveSession
    })).toMatchObject({ status: "LEGACY", classification: "GENERIC" });
    expect(readCookie).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("39. keeps a generic current and snapshot mode with MANUAL Access on ATT legacy authority", async () => {
    const readCookie = vi.fn();
    const resolveSession = vi.fn();
    const target = classifiedAttempt({
      currentExamMode: "GENERIC",
      snapshotExamMode: "generic",
      accessOverrides: {
        source: "MANUAL",
        commercialProductId: null,
        commercialOrderId: null,
        commercialPaymentAttemptId: null,
        commercialProduct: null
      }
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt }, undefined,
      dependencies({ target, readCookie, resolveSession })
    );
    expect(decision).toEqual({ status: "LEGACY", mode: "enforce", classification: "GENERIC" });
    expect(readCookie).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("40. keeps generic current and snapshot modes with COMMERCIAL Access on RES legacy authority", async () => {
    const readCookie = vi.fn();
    const resolveSession = vi.fn();
    const target = classifiedAttempt({
      currentExamMode: "GENERIC",
      snapshotExamMode: "generic",
      status: "COMPLETED"
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "RES", attemptId: ids.attempt }, undefined,
      dependencies({ target, readCookie, resolveSession })
    );
    expect(decision).toEqual({ status: "LEGACY", mode: "enforce", classification: "GENERIC" });
    expect(readCookie).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("41. ignores all filled commercial linkage IDs when both attempt modes are generic", async () => {
    const readCookie = vi.fn();
    const resolveSession = vi.fn();
    const target = classifiedAttempt({
      currentExamMode: "GENERIC",
      snapshotExamMode: "generic",
      accessOverrides: {
        source: "COMMERCIAL",
        commercialProductId: ids.product,
        commercialOrderId: ids.operation,
        commercialPaymentAttemptId: ids.session
      }
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt }, undefined,
      dependencies({ target, readCookie, resolveSession })
    );
    expect(decision).toEqual({ status: "LEGACY", mode: "enforce", classification: "GENERIC" });
    expect(readCookie).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("42. enforces an attempt when current and snapshot modes are authentic", async () => {
    const target = classifiedAttempt({
      currentExamMode: "RIKZ_RUSSIAN_2026",
      snapshotExamMode: "rikz_russian_2026"
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt }, undefined,
      dependencies({ target })
    );
    expect(decision).toMatchObject({ status: "AUTHORIZED", classification: "AUTHENTIC" });
  });

  it("43. classifies authentic current plus generic snapshot as authentic and fails exact proof closed", async () => {
    const target = classifiedAttempt({
      currentExamMode: "RIKZ_RUSSIAN_2026",
      snapshotExamMode: "generic"
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: ids.attempt }, undefined,
      dependencies({ target })
    );
    expect(decision).toMatchObject({
      status: "REJECTED",
      classification: "AUTHENTIC",
      code: "VERIFIED_SCOPE_NOT_ALLOWED"
    });
  });

  it("44. classifies generic current plus authentic snapshot as authentic and fails exact proof closed", async () => {
    const target = classifiedAttempt({
      currentExamMode: "GENERIC",
      snapshotExamMode: "rikz_russian_2026",
      status: "COMPLETED"
    });
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "RES", attemptId: ids.attempt }, undefined,
      dependencies({ target })
    );
    expect(decision).toMatchObject({
      status: "REJECTED",
      classification: "AUTHENTIC",
      code: "VERIFIED_SCOPE_NOT_ALLOWED"
    });
  });
});
