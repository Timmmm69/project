import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryConfig } from "@/server/recovery/config";
import {
  createRecoveryHttpHandlers,
  maskRecoveryEmail
} from "@/server/recovery/http-handlers";
import type {
  RecoveryHttpRuntime,
  RecoveryHttpService
} from "@/server/recovery/http-runtime";
import {
  createRecoveryHttpRuntime,
  RECOVERY_HTTP_GLOBAL_SOURCE,
  RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
} from "@/server/recovery/http-runtime";
import { RecoveryDomainServiceError } from "@/server/recovery/service";
import { normalizeRecoveryTiming } from "@/server/recovery/timing";

const origin = "http://recovery.test";
const now = new Date("2026-07-14T12:00:00.000Z");
const challengeExpiry = new Date(now.getTime() + 10 * 60_000);
const sessionExpiry = new Date(now.getTime() + 30 * 60_000);

function enabledConfig() {
  return { enabled: true } as Extract<RecoveryConfig, { enabled: true }>;
}

function enabledRuntime(service: RecoveryHttpService): RecoveryHttpRuntime {
  return {
    config: enabledConfig(),
    service,
    resolveState: async () => ({
      state: "no_access",
      screen: "REC-01",
      nextAction: null
    }),
    trustedOrigin: origin,
    sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE,
    resolverLimiterInput: RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
  };
}

function encoded(byte: number) {
  return Buffer.alloc(32, byte).toString("base64url");
}

function enabledEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    APP_URL: origin,
    ACC_01A_RECOVERY_ENABLED: "true",
    RECOVERY_MAILER_MODE: "test",
    VERIFIED_COMMERCIAL_SESSION_MODE: "enforce",
    RECOVERY_COMMERCIAL_PRODUCT_CODE: "russian-training-variant-01",
    RECOVERY_EMAIL_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING: `v1:${encoded(61)}`,
    RECOVERY_CHALLENGE_TOKEN_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_CHALLENGE_TOKEN_HMAC_KEY_RING: `v1:${encoded(62)}`,
    RECOVERY_OTP_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_OTP_HMAC_KEY_RING: `v1:${encoded(63)}`,
    RECOVERY_SESSION_TOKEN_ACTIVE_KEY_VERSION: "v1",
    RECOVERY_SESSION_TOKEN_HMAC_KEY_RING: `v1:${encoded(64)}`,
    VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v1",
    VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${encoded(65)}`,
    ...overrides
  };
}

function postRequest(
  path: string,
  body: unknown,
  options: {
    rawBody?: string;
    origin?: string | null;
    host?: string;
    contentType?: string;
    cookie?: string;
    requestOrigin?: string;
    extraHeaders?: Record<string, string>;
  } = {}
) {
  const headers = new Headers({
    host: options.host ?? "recovery.test",
    "content-type": options.contentType ?? "application/json"
  });
  if (options.origin !== null) headers.set("origin", options.origin ?? origin);
  if (options.cookie) headers.set("cookie", options.cookie);
  for (const [name, value] of Object.entries(options.extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Request(`${options.requestOrigin ?? origin}${path}`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body)
  });
}

function deleteRequest(options: {
  origin?: string | null;
  host?: string;
  cookie?: string;
  body?: string;
} = {}) {
  const headers = new Headers({ host: options.host ?? "recovery.test" });
  if (options.origin !== null) headers.set("origin", options.origin ?? origin);
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(`${origin}/api/recovery/session`, {
    method: "DELETE",
    headers,
    ...(options.body === undefined ? {} : { body: options.body })
  });
}

function challengeBody(overrides: Record<string, unknown> = {}) {
  return {
    email: "Buyer@Example.TEST",
    productCode: "russian-training-variant-01",
    intent: "recovery",
    idempotencyKey: randomUUID(),
    ...overrides
  };
}

function verifyBody(overrides: Record<string, unknown> = {}) {
  return { code: "123456", operationId: randomUUID(), ...overrides };
}

function createdChallenge() {
  return {
    outcome: "CREATED" as const,
    challengeId: randomUUID(),
    rawChallengeToken: `rc1.v1.${"a".repeat(43)}`,
    expiresAt: challengeExpiry,
    resendAvailableAt: new Date(now.getTime() + 60_000),
    correlationId: randomUUID(),
    delivery: { status: "accepted" as const }
  };
}

describe("ACC-01A recovery HTTP boundary", () => {
  let service: {
    requestChallenge: ReturnType<typeof vi.fn>;
    verifyChallenge: ReturnType<typeof vi.fn>;
    invalidateRecoverySession: ReturnType<typeof vi.fn>;
    validateRecoverySession: ReturnType<typeof vi.fn>;
    consumeResolverRead: ReturnType<typeof vi.fn>;
  };
  let handlers: ReturnType<typeof createRecoveryHttpHandlers>;

  beforeEach(() => {
    service = {
      requestChallenge: vi.fn().mockResolvedValue(createdChallenge()),
      verifyChallenge: vi.fn().mockResolvedValue({
        outcome: "MATCH",
        rawRecoveryToken: `rs1.v1.${"b".repeat(43)}`,
        recoverySessionId: randomUUID(),
        issuedAt: now,
        expiresAt: sessionExpiry,
        correlationId: randomUUID()
      }),
      invalidateRecoverySession: vi.fn().mockResolvedValue({ status: "REVOKED" }),
      validateRecoverySession: vi.fn().mockResolvedValue({ status: "NOT_FOUND" }),
      consumeResolverRead: vi.fn().mockResolvedValue({ allowed: true })
    };
    const runtime = enabledRuntime(service as unknown as RecoveryHttpService);
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => runtime,
      clock: () => new Date(now),
      normalizeRequestTiming: async () => {},
      cookieSecure: false
    });
  });

  it("accepts a strict same-origin challenge request and returns only the neutral body", async () => {
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({
      state: "code_sent",
      messageKey: "email.sent_neutral",
      emailMasked: "b***r@example.test",
      resendAfterSeconds: 60
    });
    expect(service.requestChallenge).toHaveBeenCalledWith(expect.objectContaining({
      email: "buyer@example.test",
      source: RECOVERY_HTTP_GLOBAL_SOURCE
    }));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("rc1.");
    expect(serialized).not.toContain("challengeId");
    expect(serialized).not.toContain("delivery");
  });

  it("sets a host-only HttpOnly Strict challenge cookie bounded to ten minutes", async () => {
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("acc01a_recovery_challenge=rc1.v1.");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");
  });

  it("uses Secure cookies when the production-like cookie policy is requested", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => enabledRuntime(service as unknown as RecoveryHttpService),
      clock: () => new Date(now),
      normalizeRequestTiming: async () => {},
      cookieSecure: true
    });
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it.each([
    ["malformed JSON", {}, { rawBody: "{" }],
    ["missing field", { email: "buyer@example.test" }, {}],
    ["unknown field", challengeBody({ source: "client-source" }), {}],
    ["invalid UUID", challengeBody({ idempotencyKey: "not-a-uuid" }), {}],
    ["invalid intent", challengeBody({ intent: "login" }), {}]
  ])("rejects %s before calling the domain service", async (_label, body, options) => {
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      body,
      options
    ));
    expect(response.status).toBe(400);
    expect(service.requestChallenge).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign origin", { origin: "https://evil.test" }],
    ["missing origin", { origin: null }],
    ["malformed origin", { origin: "not-an-origin" }],
    ["host mismatch", { host: "other.test" }],
    ["text/plain", { contentType: "text/plain" }],
    ["form body", { contentType: "application/x-www-form-urlencoded" }]
  ])("rejects %s with the fixed CSRF response and no mutation", async (_label, options) => {
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody(),
      options
    ));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "CSRF_REJECTED", message: "Invalid request origin." }
    });
    expect(service.requestChallenge).not.toHaveBeenCalled();
  });

  it("keeps idempotent replay, cooldown, target limit and unknown mailer outcome neutral", async () => {
    for (const result of [
      {
        outcome: "IDEMPOTENT_REPLAY",
        challengeId: randomUUID(),
        expiresAt: challengeExpiry,
        resendAvailableAt: new Date(now.getTime() + 60_000),
        correlationId: randomUUID()
      },
      { outcome: "COOLDOWN", retryAfterSeconds: 30, correlationId: randomUUID() },
      {
        outcome: "RATE_LIMITED",
        safeCode: "EMAIL_REQUEST_LIMIT_15M",
        retryAfterSeconds: 300,
        correlationId: randomUUID()
      },
      {
        ...createdChallenge(),
        delivery: { status: "unknown", safeCode: "MAILER_OUTCOME_UNKNOWN" }
      }
    ]) {
      service.requestChallenge.mockResolvedValueOnce(result);
      const response = await handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        challengeBody()
      ));
      expect(response.status).toBe(202);
      expect(JSON.stringify(await response.json())).not.toContain("unknown");
      if (result.outcome !== "CREATED") {
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
  });

  it("maps a server/global source limit to a safe 429 with Retry-After", async () => {
    service.requestChallenge.mockResolvedValueOnce({
      outcome: "RATE_LIMITED",
      safeCode: "SOURCE_REQUEST_LIMIT_15M",
      retryAfterSeconds: 42,
      correlationId: randomUUID()
    });
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(JSON.stringify(await response.json())).not.toContain("SOURCE_REQUEST_LIMIT");
  });

  it("maps an idempotency conflict without exposing internal identifiers", async () => {
    service.requestChallenge.mockResolvedValueOnce({
      outcome: "IDEMPOTENCY_CONFLICT",
      correlationId: randomUUID()
    });
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "IDEMPOTENCY_CONFLICT", message: "Request conflict." }
    });
  });

  it("normalizes CREATED, replay, cooldown, target limit, and domain scope rejection deterministically", async () => {
    const jitters = [0, 50, 100, 150, 200];
    const targets: number[] = [];
    const sleeps: number[] = [];
    service.requestChallenge
      .mockResolvedValueOnce(createdChallenge())
      .mockResolvedValueOnce({
        outcome: "IDEMPOTENT_REPLAY",
        challengeId: randomUUID(),
        expiresAt: challengeExpiry,
        resendAvailableAt: new Date(now.getTime() + 60_000),
        correlationId: randomUUID()
      })
      .mockResolvedValueOnce({
        outcome: "COOLDOWN",
        retryAfterSeconds: 30,
        correlationId: randomUUID()
      })
      .mockResolvedValueOnce({
        outcome: "RATE_LIMITED",
        safeCode: "EMAIL_REQUEST_LIMIT_15M",
        retryAfterSeconds: 300,
        correlationId: randomUUID()
      })
      .mockRejectedValueOnce(new RecoveryDomainServiceError("PRODUCT_SCOPE_MISMATCH"));
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => enabledRuntime(service as unknown as RecoveryHttpService),
      clock: () => new Date(now),
      normalizeRequestTiming: async (startedAt) => {
        const jitter = jitters.shift();
        if (jitter === undefined) throw new Error("missing deterministic jitter");
        const result = await normalizeRecoveryTiming(startedAt, {
          clock: () => new Date(startedAt.getTime() + 25),
          randomJitterMs: () => jitter,
          sleep: async (milliseconds) => { sleeps.push(milliseconds); }
        });
        targets.push(result.targetElapsedMs);
      },
      cookieSecure: false
    });

    const responses = [];
    for (let index = 0; index < 5; index += 1) {
      responses.push(await handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        challengeBody()
      )));
    }
    expect(responses.map((response) => response.status)).toEqual([202, 202, 202, 202, 404]);
    expect(targets).toEqual([300, 350, 400, 450, 500]);
    expect(sleeps).toEqual([275, 325, 375, 425, 475]);
  });

  it("keeps a disabled feature unavailable without calling the service or setting cookies", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => ({ config: { enabled: false } }),
      normalizeRequestTiming: async () => {}
    });
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(service.requestChallenge).not.toHaveBeenCalled();
  });

  it("uses one feature-off 404 before Origin, Host, JSON, content type, or DELETE-body checks", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => ({ config: { enabled: false } })
    });
    const requests = [
      handlers.requestChallenge(postRequest("/api/recovery/challenges", challengeBody())),
      handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        challengeBody(),
        { origin: "https://evil.test" }
      )),
      handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        challengeBody(),
        { origin: null }
      )),
      handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        {},
        { rawBody: "{" }
      )),
      handlers.invalidateSession(deleteRequest({ body: "{}" }))
    ];
    const responses = await Promise.all(requests);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "FEATURE_UNAVAILABLE", message: "Recovery is unavailable." }
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(service.requestChallenge).not.toHaveBeenCalled();
    expect(service.verifyChallenge).not.toHaveBeenCalled();
    expect(service.invalidateRecoverySession).not.toHaveBeenCalled();
  });

  it.each([
    ["off", "off"],
    ["shadow", "shadow"],
    ["missing/off", undefined]
  ])("keeps every recovery endpoint unavailable in verified mode %s", async (_label, mode) => {
    const runtime = createRecoveryHttpRuntime(enabledEnvironment({
      VERIFIED_COMMERCIAL_SESSION_MODE: mode
    }));
    expect(runtime).toMatchObject({ config: { enabled: true }, available: false });
    expect("service" in runtime).toBe(false);
    const gated = createRecoveryHttpHandlers({ getRuntime: () => runtime });
    const responses = await Promise.all([
      gated.requestChallenge(postRequest("/api/recovery/challenges", challengeBody())),
      gated.verifyChallenge(postRequest("/api/recovery/challenges/verify", verifyBody())),
      gated.resolveState(new Request(`${origin}/api/recovery/state`, {
        headers: { cookie: "acc01a_recovery=opaque" }
      })),
      gated.continueRecovery(postRequest(
        "/api/recovery/continue",
        { operationId: randomUUID() },
        { cookie: "acc01a_recovery=opaque" }
      )),
      gated.invalidateSession(deleteRequest({ cookie: "acc01a_recovery=opaque" }))
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("FEATURE_UNAVAILABLE");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("creates the recovery HTTP runtime only in verified enforce mode", () => {
    const runtime = createRecoveryHttpRuntime(enabledEnvironment({
      VERIFIED_COMMERCIAL_SESSION_MODE: "enforce"
    }));
    expect(runtime).toMatchObject({ config: { enabled: true }, available: true });
    expect("service" in runtime).toBe(true);
    expect("continuation" in runtime).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-url"],
    ["unsupported protocol", "ftp://recovery.test"],
    ["credentials", "http://user:pass@recovery.test"],
    ["path", "http://recovery.test/recovery"],
    ["query", "http://recovery.test?mode=1"],
    ["fragment", "http://recovery.test#fragment"]
  ])("fails enabled recovery closed for %s APP_URL", async (_label, appUrl) => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => createRecoveryHttpRuntime(enabledEnvironment({ APP_URL: appUrl }))
    });
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody(),
      { origin: "https://evil.test", contentType: "text/plain", rawBody: "not-json" }
    ));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "FEATURE_UNAVAILABLE", message: "Recovery is unavailable." }
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(service.requestChallenge).not.toHaveBeenCalled();
  });

  it("fails production-like recovery preflight closed before request validation", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => createRecoveryHttpRuntime(enabledEnvironment({ NODE_ENV: "production" }))
    });
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      {},
      { origin: null, rawBody: "{" }
    ));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("cannot substitute the configured origin with a self-consistent request URL", async () => {
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody(),
      {
        requestOrigin: "http://attacker.test",
        origin,
        host: "recovery.test"
      }
    ));
    expect(response.status).toBe(403);
    expect(service.requestChallenge).not.toHaveBeenCalled();
  });

  it("uses one fixed source bucket regardless of forwarded host or origin headers", async () => {
    for (const attackerValue of ["one.attacker.test", "two.attacker.test"]) {
      const response = await handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        challengeBody(),
        {
          extraHeaders: {
            "x-forwarded-host": attackerValue,
            "x-forwarded-origin": `https://${attackerValue}`
          }
        }
      ));
      expect(response.status).toBe(202);
    }
    expect(service.requestChallenge.mock.calls.map(([input]) => input.source))
      .toEqual([RECOVERY_HTTP_GLOBAL_SOURCE, RECOVERY_HTTP_GLOBAL_SOURCE]);
  });

  it("keeps verify unavailable while the feature is off even without a challenge cookie", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => ({ config: { enabled: false } })
    });
    const response = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody()
    ));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(service.verifyChallenge).not.toHaveBeenCalled();
  });

  it("reads challenge authority only from the HttpOnly cookie and rejects body overrides", async () => {
    const injected = verifyBody({ email: "victim@example.test" });
    const rejected = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      injected,
      { cookie: `acc01a_recovery_challenge=${createdChallenge().rawChallengeToken}` }
    ));
    expect(rejected.status).toBe(400);
    expect(service.verifyChallenge).not.toHaveBeenCalled();

    const missing = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody()
    ));
    expect(missing.status).toBe(409);
    expect(service.verifyChallenge).not.toHaveBeenCalled();
  });

  it("sets only the recovery cookie on MATCH, clears challenge and omits raw authority from JSON", async () => {
    const response = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${createdChallenge().rawChallengeToken}` }
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      state: "verified",
      messageKey: "email.code.verified",
      nextAction: "RESOLVE"
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("acc01a_recovery_challenge=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("acc01a_recovery=rs1.v1.");
    expect(cookie).toContain("Max-Age=1800");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(JSON.stringify(body)).not.toContain("rs1.");
    expect(JSON.stringify(body)).not.toContain("recoverySessionId");
  });

  it.each([
    ["NO_MATCH", 401, false],
    ["EXPIRED", 410, true],
    ["LOCKED", 409, true],
    ["REPLAY", 409, true],
    ["INVALID_TOKEN", 409, true],
    ["OPERATION_CONFLICT", 409, false],
    ["ERROR", 503, false]
  ])("maps verify %s without issuing recovery authority", async (outcome, status, clearsChallenge) => {
    service.verifyChallenge.mockResolvedValueOnce({ outcome, correlationId: randomUUID() });
    const response = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${createdChallenge().rawChallengeToken}` }
    ));
    expect(response.status).toBe(status);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie.includes("acc01a_recovery_challenge=")).toBe(clearsChallenge);
    expect(cookie).not.toContain("acc01a_recovery=rs1");
  });

  it("invalidates a valid recovery cookie, clears it, and remains idempotent without one", async () => {
    const token = `rs1.v1.${"b".repeat(43)}`;
    const first = await handlers.invalidateSession(deleteRequest({
      cookie: `acc01a_recovery=${token}`
    }));
    expect(first.status).toBe(204);
    expect(service.invalidateRecoverySession).toHaveBeenCalledWith(token, "USER_INVALIDATED");
    expect(first.headers.get("set-cookie")).toContain("acc01a_recovery=");
    expect(first.headers.get("set-cookie")).toContain("Max-Age=0");

    const second = await handlers.invalidateSession(deleteRequest());
    expect(second.status).toBe(204);
    expect(service.invalidateRecoverySession).toHaveBeenCalledTimes(1);
  });

  it.each(["NOT_FOUND", "ALREADY_TERMINAL"])(
    "returns 204 and clears an invalid or terminal cookie for %s",
    async (status) => {
      service.invalidateRecoverySession.mockResolvedValueOnce({ status });
      const response = await handlers.invalidateSession(deleteRequest({
        cookie: `acc01a_recovery=rs1.v1.${"c".repeat(43)}`
      }));
      expect(response.status).toBe(204);
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
  );

  it("keeps the same cookie retryable after an unknown invalidation outcome", async () => {
    const token = `rs1.v1.${"d".repeat(43)}`;
    service.invalidateRecoverySession
      .mockRejectedValueOnce(new Error("synthetic unknown outcome"))
      .mockResolvedValueOnce({ status: "ALREADY_TERMINAL" });

    const first = await handlers.invalidateSession(deleteRequest({
      cookie: `acc01a_recovery=${token}`
    }));
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({
      error: {
        code: "OPERATION_OUTCOME_UNKNOWN",
        message: "Session invalidation outcome is unknown."
      }
    });
    expect(first.headers.get("set-cookie")).toBeNull();

    const second = await handlers.invalidateSession(deleteRequest({
      cookie: `acc01a_recovery=${token}`
    }));
    expect(second.status).toBe(204);
    expect(second.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(service.invalidateRecoverySession).toHaveBeenNthCalledWith(
      1,
      token,
      "USER_INVALIDATED"
    );
    expect(service.invalidateRecoverySession).toHaveBeenNthCalledWith(
      2,
      token,
      "USER_INVALIDATED"
    );
  });

  it("returns 503 without clearing the cookie for an unrecognized invalidation result", async () => {
    service.invalidateRecoverySession.mockResolvedValueOnce({ status: "UNKNOWN" });
    const response = await handlers.invalidateSession(deleteRequest({
      cookie: `acc01a_recovery=rs1.v1.${"e".repeat(43)}`
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects DELETE bodies and cross-site DELETE before invalidation", async () => {
    const withBody = await handlers.invalidateSession(deleteRequest({ body: "{}" }));
    const crossSite = await handlers.invalidateSession(deleteRequest({
      origin: "https://evil.test"
    }));
    expect(withBody.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(service.invalidateRecoverySession).not.toHaveBeenCalled();
  });

  it("adds no-store and no-referrer to success, error, and no-content responses", async () => {
    const success = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    const error = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody(),
      { origin: null }
    ));
    const noContent = await handlers.invalidateSession(deleteRequest());
    for (const response of [success, error, noContent]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("masks only the caller-supplied address without returning a full local part", () => {
    expect(maskRecoveryEmail("a@example.test")).toBe("*@example.test");
    expect(maskRecoveryEmail("ab@example.test")).toBe("a*@example.test");
    expect(maskRecoveryEmail("buyer@example.test")).toBe("b***r@example.test");
  });
});
