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

const origin = "http://recovery.test";
const now = new Date("2026-07-14T12:00:00.000Z");
const challengeExpiry = new Date(now.getTime() + 10 * 60_000);
const sessionExpiry = new Date(now.getTime() + 30 * 60_000);

function enabledConfig() {
  return { enabled: true } as RecoveryConfig;
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
  } = {}
) {
  const headers = new Headers({
    host: options.host ?? "recovery.test",
    "content-type": options.contentType ?? "application/json"
  });
  if (options.origin !== null) headers.set("origin", options.origin ?? origin);
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(`${origin}${path}`, {
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
      invalidateRecoverySession: vi.fn().mockResolvedValue({ status: "REVOKED" })
    };
    const runtime: RecoveryHttpRuntime = {
      config: enabledConfig(),
      service: service as unknown as RecoveryHttpService
    };
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => runtime,
      clock: () => new Date(now),
      normalizeRequestTiming: async () => {},
      sourceForRequest: () => "server-derived-source",
      trustedOrigin: origin,
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
      source: "server-derived-source"
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
      getRuntime: () => ({
        config: enabledConfig(),
        service: service as unknown as RecoveryHttpService
      }),
      clock: () => new Date(now),
      normalizeRequestTiming: async () => {},
      trustedOrigin: origin,
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

  it("keeps a disabled feature unavailable without calling the service or setting cookies", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => ({ config: { enabled: false } }),
      normalizeRequestTiming: async () => {},
      trustedOrigin: origin
    });
    const response = await handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody()
    ));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(service.requestChallenge).not.toHaveBeenCalled();
  });

  it("keeps verify unavailable while the feature is off even without a challenge cookie", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => ({ config: { enabled: false } }),
      trustedOrigin: origin
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
