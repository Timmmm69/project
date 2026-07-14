import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import type { EnabledRecoveryConfig, RecoveryKeyRing } from "@/server/recovery/config";
import {
  createRecoveryContinuationService,
  createRecoveryDestination,
  isContinuationOperationUniqueConflict,
  isAllowedRecoveryDestination,
  RecoveryContinuationError
} from "@/server/recovery/continuation";
import { createRecoveryHttpHandlers } from "@/server/recovery/http-handlers";
import {
  RECOVERY_HTTP_GLOBAL_SOURCE,
  RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE,
  type RecoveryHttpRuntime
} from "@/server/recovery/http-runtime";

const origin = "http://continuation.test";
const operationId = "11111111-1111-4111-8111-111111111111";
const recoveryToken = "rs1.v1.recovery-secret";
const verifiedToken = "vs1.v1.verified-secret";
const expiresAt = new Date("2026-07-21T12:00:00.000Z");
const now = new Date("2026-07-14T12:00:00.000Z");

function request(body: unknown = { operationId }, options: {
  origin?: string | null;
  host?: string;
  contentType?: string | null;
  cookie?: string | null;
  rawBody?: string;
} = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? origin);
  headers.set("host", options.host ?? "continuation.test");
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.cookie !== null) {
    headers.set("cookie", options.cookie ?? `acc01a_recovery=${recoveryToken}`);
  }
  return new Request(`${origin}/api/recovery/continue`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body)
  });
}

function runtime(overrides: {
  exchange?: ReturnType<typeof vi.fn>;
  consumeResolverRead?: ReturnType<typeof vi.fn>;
  continuation?: boolean;
} = {}) {
  const exchange = overrides.exchange ?? vi.fn().mockResolvedValue({
    status: "SUCCESS",
    nextAction: "OPEN_PRE",
    nextUrl: "/tests/exact-test-slug",
    rawVerifiedToken: verifiedToken,
    verifiedSessionExpiresAt: expiresAt
  });
  const consumeResolverRead = overrides.consumeResolverRead ?? vi.fn().mockResolvedValue({
    allowed: true
  });
  const value = {
    config: { enabled: true },
    trustedOrigin: origin,
    sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE,
    resolverLimiterInput: RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE,
    service: {
      consumeResolverRead,
      requestChallenge: vi.fn(),
      verifyChallenge: vi.fn(),
      validateRecoverySession: vi.fn(),
      invalidateRecoverySession: vi.fn()
    },
    resolveState: vi.fn(),
    continuation: overrides.continuation === false ? undefined : { exchange }
  };
  return { value: value as unknown as RecoveryHttpRuntime, exchange, consumeResolverRead };
}

function handlers(value: RecoveryHttpRuntime | (() => RecoveryHttpRuntime), secure = false) {
  return createRecoveryHttpHandlers({
    getRuntime: typeof value === "function" ? value : () => value,
    clock: () => new Date(now),
    normalizeRequestTiming: async () => {},
    cookieSecure: secure
  });
}

describe("ACC-01A recovery continuation destination allowlist", () => {
  it("generates the exact PRE, ATT and RES destinations from private authority", () => {
    const shared = {
      userId: randomUUID(),
      commercialProductId: randomUUID(),
      testId: randomUUID(),
      testSlug: "verified-test-slug",
      accessId: randomUUID()
    };
    const attemptId = randomUUID();
    expect(createRecoveryDestination({ state: "access_unstarted", ...shared })).toEqual({
      nextAction: "OPEN_PRE",
      nextUrl: "/tests/verified-test-slug"
    });
    expect(createRecoveryDestination({ state: "attempt_active", ...shared, attemptId })).toEqual({
      nextAction: "OPEN_ATTEMPT",
      nextUrl: `/attempts/${attemptId}`
    });
    expect(createRecoveryDestination({ state: "result_available", ...shared, attemptId })).toEqual({
      nextAction: "OPEN_RESULT",
      nextUrl: `/results/${attemptId}`
    });
  });

  it.each([
    ["OPEN_PRE", "https://evil.test/tests/x"],
    ["OPEN_PRE", "//evil.test/x"],
    ["OPEN_PRE", "/tests/x?next=evil"],
    ["OPEN_PRE", "/tests/x#fragment"],
    ["OPEN_PRE", "/tests\\x"],
    ["OPEN_PRE", "/tests/x//y"],
    ["OPEN_ATTEMPT", "/attempts/not-a-uuid"],
    ["OPEN_RESULT", `/attempts/${randomUUID()}`]
  ] as const)("rejects %s destination %s", (action, destination) => {
    expect(isAllowedRecoveryDestination(action, destination)).toBe(false);
  });
});

describe("ACC-01A recovery continuation HTTP boundary", () => {
  it("fails closed when the feature is off, configuration throws, or continuation is absent", async () => {
    const disabled = handlers({ config: { enabled: false } });
    expect((await disabled.continueRecovery(request())).status).toBe(404);
    expect((await handlers(() => { throw new Error("invalid config"); })
      .continueRecovery(request())).status).toBe(404);
    expect((await handlers(runtime({ continuation: false }).value)
      .continueRecovery(request())).status).toBe(404);
  });

  it.each([
    [request(undefined, { origin: null }), 403],
    [request(undefined, { origin: "http://foreign.test" }), 403],
    [request(undefined, { host: "foreign.test" }), 403],
    [request(undefined, { contentType: null }), 400],
    [request(undefined, { contentType: "text/plain" }), 400],
    [request(undefined, { rawBody: "{" }), 400],
    [request({}), 400],
    [request({ operationId: "invalid" }), 400],
    [request({ operationId, unexpected: true }), 400],
    [request({ operationId, accessId: randomUUID() }), 400],
    [request({ operationId, nextUrl: "https://evil.test" }), 400],
    [request({ operationId, state: "access_unstarted" }), 400]
  ])("rejects an invalid request before domain effects", async (input, status) => {
    const testRuntime = runtime();
    const response = await handlers(testRuntime.value).continueRecovery(input as Request);
    expect(response.status).toBe(status);
    expect(testRuntime.consumeResolverRead).not.toHaveBeenCalled();
    expect(testRuntime.exchange).not.toHaveBeenCalled();
  });

  it("requires the recovery cookie before rate limiting or exchange", async () => {
    const testRuntime = runtime();
    const response = await handlers(testRuntime.value).continueRecovery(request(
      { operationId },
      { cookie: null }
    ));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "RECOVERY_SESSION_REQUIRED", message: "Recovery session is required." }
    });
    expect(testRuntime.consumeResolverRead).not.toHaveBeenCalled();
    expect(testRuntime.exchange).not.toHaveBeenCalled();
  });

  it("uses only the server-controlled limiter source and bounds Retry-After", async () => {
    const consumeResolverRead = vi.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 17
    });
    const testRuntime = runtime({ consumeResolverRead });
    const response = await handlers(testRuntime.value).continueRecovery(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(consumeResolverRead).toHaveBeenCalledWith(RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE);
    expect(testRuntime.exchange).not.toHaveBeenCalled();
  });

  it.each([
    ["RECOVERY_SESSION_REQUIRED", 401, "RECOVERY_SESSION_REQUIRED"],
    ["SCOPE_NOT_ALLOWED", 403, "SCOPE_NOT_ALLOWED"],
    ["STATE_CHANGED_RETRY_RESOLVE", 409, "STATE_CHANGED_RETRY_RESOLVE"],
    ["CONTINUATION_OPERATION_CONFLICT", 409, "CONTINUATION_OPERATION_CONFLICT"]
  ] as const)("maps %s to a closed response", async (domainStatus, httpStatus, code) => {
    const exchange = vi.fn().mockResolvedValue({ status: domainStatus });
    const response = await handlers(runtime({ exchange }).value).continueRecovery(request());
    expect(response.status).toBe(httpStatus);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("verified_student_session");
  });

  it("returns exactly action/url and sets the verified cookie only after successful exchange", async () => {
    const testRuntime = runtime();
    const response = await handlers(testRuntime.value).continueRecovery(request());
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({
      nextAction: "OPEN_PRE",
      nextUrl: "/tests/exact-test-slug"
    });
    expect(Object.keys(await response.clone().json()).sort()).toEqual(["nextAction", "nextUrl"]);
    expect(testRuntime.exchange).toHaveBeenCalledWith(recoveryToken, operationId);
    const serializedBody = await response.clone().text();
    expect(serializedBody).not.toContain(recoveryToken);
    expect(serializedBody).not.toContain(verifiedToken);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`verified_student_session=${verifiedToken}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Expires=Tue, 21 Jul 2026 12:00:00 GMT");
    expect(cookie).not.toContain("Max-Age=");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("acc01a_recovery=;");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("adds Secure in production-like cookie mode without changing the body", async () => {
    const response = await handlers(runtime().value, true).continueRecovery(request());
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(await response.json()).toEqual({
      nextAction: "OPEN_PRE",
      nextUrl: "/tests/exact-test-slug"
    });
  });

  it("maps a post-commit/unknown exception to 503 and does not set a verified cookie", async () => {
    const exchange = vi.fn().mockRejectedValue(
      new RecoveryContinuationError("CONTINUATION_OUTCOME_UNKNOWN")
    );
    const response = await handlers(runtime({ exchange }).value).continueRecovery(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("CONTINUATION_OUTCOME_UNKNOWN");
    expect(response.headers.get("set-cookie") ?? "").not.toContain("verified_student_session");
    expect(response.headers.get("set-cookie") ?? "").not.toContain("acc01a_recovery=;");
  });
});

describe("ACC-01A continuation unique-conflict classification", () => {
  function p2002(target: unknown) {
    return new Prisma.PrismaClientKnownRequestError("synthetic unique conflict", {
      code: "P2002",
      clientVersion: "test",
      meta: { target }
    });
  }

  it.each([
    "continuationOperationId",
    "continuation_operation_id",
    "verified_recovery_sessions_continuation_operation_id_key",
    ["continuationOperationId"],
    ["continuation_operation_id"]
  ])("recognizes only the exact continuation operation target %j", (target) => {
    expect(isContinuationOperationUniqueConflict(p2002(target))).toBe(true);
  });

  it.each([
    "token_digest",
    "security_correlation_id",
    "verified_student_sessions_source_source_reference_id_issuan_key",
    ["source", "sourceReferenceId", "issuanceOperationId"],
    ["continuationOperationId", "tokenDigest"],
    undefined
  ])("does not reclassify unrelated P2002 target %j", (target) => {
    expect(isContinuationOperationUniqueConflict(p2002(target))).toBe(false);
  });

  it("does not reclassify rollback or unknown errors as an operation collision", () => {
    const rollback = new Prisma.PrismaClientKnownRequestError("rollback", {
      code: "P2034",
      clientVersion: "test"
    });
    expect(isContinuationOperationUniqueConflict(rollback)).toBe(false);
    expect(isContinuationOperationUniqueConflict(new Error("unknown"))).toBe(false);
  });

  function ring(byte: number): RecoveryKeyRing {
    return { activeKeyVersion: "v1", keys: new Map([["v1", Buffer.alloc(32, byte)]]) };
  }

  const recoveryConfig: EnabledRecoveryConfig = {
    enabled: true,
    mailerMode: "test",
    productCode: "unit-continuation",
    keyRings: {
      emailFingerprint: ring(101),
      challengeToken: ring(102),
      otpMac: ring(103),
      sessionToken: ring(104)
    }
  };
  const verifiedConfig: VerifiedStudentSessionConfig = {
    mode: "enforce",
    activeKeyVersion: "v1",
    keys: new Map([["v1", Buffer.alloc(32, 105)]])
  };

  function throwingService(error: unknown) {
    const client = {
      $transaction: vi.fn().mockRejectedValue(error)
    } as unknown as PrismaClient;
    return createRecoveryContinuationService({
      client,
      recoveryConfig,
      verifiedSessionConfig: verifiedConfig
    });
  }

  it("maps only an exact continuation-operation P2002 to operation conflict", async () => {
    await expect(throwingService(p2002(["continuation_operation_id"]))
      .exchange(recoveryToken, operationId)).resolves.toEqual({
      status: "CONTINUATION_OPERATION_CONFLICT"
    });
  });

  it("leaves unrelated P2002 failures unknown for the HTTP boundary", async () => {
    const unrelated = p2002(["token_digest"]);
    await expect(throwingService(unrelated).exchange(recoveryToken, operationId))
      .rejects.toBe(unrelated);
  });
});
