import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EnabledRecoveryConfig, RecoveryKeyRing } from "@/server/recovery/config";
import { createRecoveryHttpHandlers } from "@/server/recovery/http-handlers";
import { RECOVERY_HTTP_GLOBAL_SOURCE } from "@/server/recovery/http-runtime";
import type { RecoveryMail, RecoveryMailer } from "@/server/recovery/mailer";
import { createRecoveryDomainService } from "@/server/recovery/service";
import { normalizeRecoveryTiming } from "@/server/recovery/timing";

const shouldRun = process.env.RUN_ACC01A_HTTP_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();
const origin = "http://recovery-http.test";

function ring(byte: number): RecoveryKeyRing {
  return { activeKeyVersion: "v1", keys: new Map([["v1", Buffer.alloc(32, byte)]]) };
}

const recoveryConfig: EnabledRecoveryConfig = {
  enabled: true,
  mailerMode: "test",
  productCode: "acc01a-http-product",
  keyRings: {
    emailFingerprint: ring(41),
    challengeToken: ring(42),
    otpMac: ring(43),
    sessionToken: ring(44)
  }
};

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ACC01A_HTTP_INTEGRATION_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "acc01a_recovery_ci") {
    throw new Error("ACC01A_HTTP_INTEGRATION_REQUIRES_ACC01A_RECOVERY_CI_SCHEMA");
  }
}

async function cleanDatabase() {
  await prisma.recoverySecurityEvent.deleteMany();
  await prisma.verifiedRecoverySession.deleteMany();
  await prisma.recoveryVerificationAttempt.deleteMany();
  await prisma.recoveryChallenge.deleteMany();
  await prisma.recoveryRateLimitEvent.deleteMany();
  await prisma.verifiedStudentSession.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.access.deleteMany();
  await prisma.commercialPaymentEvent.deleteMany();
  await prisma.commercialPaymentAttempt.deleteMany();
  await prisma.commercialOrder.deleteMany();
  await prisma.commercialCheckoutFlow.deleteMany();
  await prisma.commercialProduct.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.accessCode.deleteMany();
  await prisma.question.deleteMany();
  await prisma.test.deleteMany();
  await prisma.user.deleteMany();
}

function postRequest(path: string, body: unknown, options: {
  origin?: string | null;
  host?: string;
  contentType?: string;
  cookie?: string;
  rawBody?: string;
} = {}) {
  const headers = new Headers({
    host: options.host ?? "recovery-http.test",
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

function deleteRequest(cookie?: string) {
  return new Request(`${origin}/api/recovery/session`, {
    method: "DELETE",
    headers: {
      origin,
      host: "recovery-http.test",
      ...(cookie ? { cookie } : {})
    }
  });
}

function challengeBody(email = "buyer@example.test", overrides: Record<string, unknown> = {}) {
  return {
    email,
    productCode: recoveryConfig.productCode,
    intent: "recovery",
    idempotencyKey: randomUUID(),
    ...overrides
  };
}

function verifyBody(overrides: Record<string, unknown> = {}) {
  return { code: "908172", operationId: randomUUID(), ...overrides };
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? "";
  return new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`).exec(header)?.[1] ?? null;
}

describeWithDatabase("ACC-01A recovery HTTP boundary PostgreSQL integration", () => {
  let now: Date;
  let deliveries: RecoveryMail[];
  let handlers: ReturnType<typeof createRecoveryHttpHandlers>;

  function buildHandlers(options: {
    mailer?: RecoveryMailer;
    normalizeRequestTiming?: (startedAt: Date) => Promise<void>;
  } = {}) {
    const mailer: RecoveryMailer = options.mailer ?? {
      async sendVerificationCode(message) {
        deliveries.push({ ...message, expiresAt: new Date(message.expiresAt) });
        return { status: "accepted" };
      }
    };
    const service = createRecoveryDomainService({
      client: prisma,
      config: recoveryConfig,
      mailer,
      clock: () => new Date(now),
      otpGenerator: () => "908172"
    });
    return createRecoveryHttpHandlers({
      getRuntime: () => ({
        config: recoveryConfig,
        service,
        trustedOrigin: origin,
        sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE
      }),
      clock: () => new Date(now),
      normalizeRequestTiming: options.normalizeRequestTiming ?? (async () => {}),
      cookieSecure: false
    });
  }

  async function requestChallenge(email = "buyer@example.test", overrides: Record<string, unknown> = {}) {
    return handlers.requestChallenge(postRequest(
      "/api/recovery/challenges",
      challengeBody(email, overrides)
    ));
  }

  beforeAll(() => {
    assertDedicatedTestSchema();
  });

  beforeEach(async () => {
    await cleanDatabase();
    now = new Date("2026-07-14T12:00:00.000Z");
    deliveries = [];
    const test = await prisma.test.create({
      data: {
        title: "ACC-01A HTTP integration",
        slug: `acc01a-http-${randomUUID()}`,
        price: 1000,
        durationMinutes: 120,
        status: "PUBLISHED"
      }
    });
    await prisma.commercialProduct.create({
      data: {
        code: recoveryConfig.productCode,
        testId: test.id,
        name: "ACC-01A HTTP product",
        priceMinor: 1000
      }
    });
    handlers = buildHandlers();
  });

  afterAll(async () => {
    if (shouldRun) await cleanDatabase();
    await prisma.$disconnect();
  });

  it("completes request, verify and two idempotent DELETE calls without exposing raw authority", async () => {
    const challengeResponse = await requestChallenge();
    expect(challengeResponse.status).toBe(202);
    const challengeBodyJson = await challengeResponse.clone().json();
    expect(challengeBodyJson).toMatchObject({ state: "code_sent", resendAfterSeconds: 60 });
    const challengeToken = cookieValue(challengeResponse, "acc01a_recovery_challenge");
    expect(challengeToken).toMatch(/^rc1\.v1\./);
    expect(deliveries).toHaveLength(1);
    expect(challengeBodyJson).not.toHaveProperty("challengeId");
    expect(JSON.stringify(challengeBodyJson)).not.toContain(challengeToken ?? "missing-token");

    const verifyResponse = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      { code: deliveries[0].code, operationId: randomUUID() },
      { cookie: `acc01a_recovery_challenge=${challengeToken}` }
    ));
    expect(verifyResponse.status).toBe(200);
    const verifyJson = await verifyResponse.clone().json();
    expect(verifyJson).toEqual({
      state: "verified",
      messageKey: "email.code.verified",
      nextAction: "RESOLVE"
    });
    const recoveryToken = cookieValue(verifyResponse, "acc01a_recovery");
    expect(recoveryToken).toMatch(/^rs1\.v1\./);
    expect(JSON.stringify(verifyJson)).not.toContain(recoveryToken ?? "missing-token");

    const persisted = JSON.stringify({
      challenges: await prisma.recoveryChallenge.findMany(),
      sessions: await prisma.verifiedRecoverySession.findMany(),
      attempts: await prisma.recoveryVerificationAttempt.findMany()
    });
    expect(persisted).not.toContain(deliveries[0].code);
    expect(persisted).not.toContain(challengeToken ?? "missing-challenge-token");
    expect(persisted).not.toContain(recoveryToken ?? "missing-recovery-token");

    const firstDelete = await handlers.invalidateSession(deleteRequest(
      `acc01a_recovery=${recoveryToken}`
    ));
    const revocationEventsAfterFirstDelete = await prisma.recoverySecurityEvent.count({
      where: { eventCode: "SESSION_REVOKED" }
    });
    const secondDelete = await handlers.invalidateSession(deleteRequest(
      `acc01a_recovery=${recoveryToken}`
    ));
    expect([firstDelete.status, secondDelete.status]).toEqual([204, 204]);
    expect(secondDelete.headers.get("set-cookie")).toContain("acc01a_recovery=;");
    expect(await prisma.recoverySecurityEvent.count({
      where: { eventCode: "SESSION_REVOKED" }
    })).toBe(revocationEventsAfterFirstDelete);
    expect(await prisma.verifiedRecoverySession.findFirstOrThrow()).toMatchObject({
      status: "REVOKED",
      revocationCode: "USER_INVALIDATED"
    });
  });

  it("replays one idempotency key neutrally without a second delivery or invented cookie", async () => {
    const idempotencyKey = randomUUID();
    const first = await requestChallenge("replay@example.test", { idempotencyKey });
    const second = await requestChallenge("replay@example.test", { idempotencyKey });
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(deliveries).toHaveLength(1);
    expect(await prisma.recoveryChallenge.count()).toBe(1);
    expect(cookieValue(first, "acc01a_recovery_challenge")).toMatch(/^rc1\./);
    expect(cookieValue(second, "acc01a_recovery_challenge")).toBeNull();
  });

  it("keeps cooldown and target-dependent limiting neutral without a second active challenge", async () => {
    const first = await requestChallenge("limited@example.test");
    const second = await requestChallenge("limited@example.test");
    const third = await requestChallenge("limited@example.test");
    const fourth = await requestChallenge("limited@example.test");
    expect([first.status, second.status, third.status, fourth.status]).toEqual([202, 202, 202, 202]);
    expect(deliveries).toHaveLength(1);
    expect(await prisma.recoveryChallenge.count({ where: { status: "ACTIVE" } })).toBe(1);
    for (const response of [second, third, fourth]) {
      expect(cookieValue(response, "acc01a_recovery_challenge")).toBeNull();
    }
  });

  it("normalizes existing and nonexistent email requests to the same deterministic HTTP timing contract", async () => {
    await prisma.user.create({
      data: { email: "existing-timing@example.test", role: "STUDENT" }
    });
    const timings: Array<{ targetElapsedMs: number; sleptMs: number }> = [];
    const jitters = [80, 80];
    handlers = buildHandlers({
      normalizeRequestTiming: async (startedAt) => {
        const jitter = jitters.shift();
        if (jitter === undefined) throw new Error("missing deterministic jitter");
        const timing = await normalizeRecoveryTiming(startedAt, {
          clock: () => new Date(startedAt.getTime() + 40),
          randomJitterMs: () => jitter,
          sleep: async () => {}
        });
        timings.push(timing);
      }
    });

    const existing = await requestChallenge("existing-timing@example.test");
    const nonexistent = await requestChallenge("nonexistent-timing@example.test");
    const existingJson = await existing.json() as Record<string, unknown>;
    const nonexistentJson = await nonexistent.json() as Record<string, unknown>;
    const { emailMasked: existingMask, ...existingPublicContract } = existingJson;
    const { emailMasked: nonexistentMask, ...nonexistentPublicContract } = nonexistentJson;

    expect([existing.status, nonexistent.status]).toEqual([202, 202]);
    expect(existingPublicContract).toEqual(nonexistentPublicContract);
    expect(existingMask).not.toBe(nonexistentMask);
    expect(timings).toEqual([
      { targetElapsedMs: 380, sleptMs: 340 },
      { targetElapsedMs: 380, sleptMs: 340 }
    ]);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.user.findUnique({
      where: { email: "nonexistent-timing@example.test" }
    })).toBeNull();
  });

  it("normalizes created, replay, cooldown, target limit and product rejection through the real domain service", async () => {
    const jitters = [0, 40, 80, 120, 160, 200];
    const timings: Array<{ targetElapsedMs: number; sleptMs: number }> = [];
    handlers = buildHandlers({
      normalizeRequestTiming: async (startedAt) => {
        const jitter = jitters.shift();
        if (jitter === undefined) throw new Error("missing deterministic jitter");
        timings.push(await normalizeRecoveryTiming(startedAt, {
          clock: () => new Date(startedAt.getTime() + 10),
          randomJitterMs: () => jitter,
          sleep: async () => {}
        }));
      }
    });

    const idempotencyKey = randomUUID();
    const responses = [
      await requestChallenge("timing-outcomes@example.test", { idempotencyKey }),
      await requestChallenge("timing-outcomes@example.test", { idempotencyKey }),
      await requestChallenge("timing-outcomes@example.test"),
      await requestChallenge("timing-outcomes@example.test"),
      await requestChallenge("timing-outcomes@example.test"),
      await requestChallenge("scope-rejected@example.test", { productCode: "other-product" })
    ];

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202, 202, 202, 404]);
    expect(timings).toEqual([
      { targetElapsedMs: 300, sleptMs: 290 },
      { targetElapsedMs: 340, sleptMs: 330 },
      { targetElapsedMs: 380, sleptMs: 370 },
      { targetElapsedMs: 420, sleptMs: 410 },
      { targetElapsedMs: 460, sleptMs: 450 },
      { targetElapsedMs: 500, sleptMs: 490 }
    ]);
    expect(await prisma.recoveryChallenge.count()).toBe(1);
    expect(deliveries).toHaveLength(1);
  });

  it("rejects foreign, missing and malformed origins plus host mismatch without database mutation", async () => {
    const options = [
      { origin: "https://evil.test" },
      { origin: null },
      { origin: "not-an-origin" },
      { host: "other.test" }
    ];
    for (const option of options) {
      const response = await handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        challengeBody(),
        option
      ));
      expect(response.status).toBe(403);
    }
    expect(await prisma.recoveryChallenge.count()).toBe(0);
    expect(await prisma.recoveryRateLimitEvent.count()).toBe(0);
    expect(deliveries).toHaveLength(0);
  });

  it("rejects malformed JSON, unknown fields, invalid UUID, intent, and content type before writes", async () => {
    const requests = [
      postRequest("/api/recovery/challenges", {}, { rawBody: "{" }),
      postRequest("/api/recovery/challenges", challengeBody("a@example.test", { token: "x" })),
      postRequest("/api/recovery/challenges", challengeBody("b@example.test", { idempotencyKey: "bad" })),
      postRequest("/api/recovery/challenges", challengeBody("c@example.test", { intent: "login" })),
      postRequest("/api/recovery/challenges", challengeBody("d@example.test"), { contentType: "text/plain" })
    ];
    for (const request of requests) {
      const response = await handlers.requestChallenge(request);
      expect([400, 403]).toContain(response.status);
    }
    expect(await prisma.recoveryChallenge.count()).toBe(0);
    expect(deliveries).toHaveLength(0);
  });

  it("does not create recovery authority for a wrong OTP, then accepts the valid OTP once", async () => {
    const challengeResponse = await requestChallenge();
    const challengeToken = cookieValue(challengeResponse, "acc01a_recovery_challenge");
    const wrong = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody({ code: "000000" }),
      { cookie: `acc01a_recovery_challenge=${challengeToken}` }
    ));
    expect(wrong.status).toBe(401);
    expect(await prisma.verifiedRecoverySession.count()).toBe(0);

    const correct = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${challengeToken}` }
    ));
    expect(correct.status).toBe(200);
    expect(await prisma.verifiedRecoverySession.count()).toBe(1);
  });

  it("does not create authority for expired or locked challenges", async () => {
    const expiredResponse = await requestChallenge("expired@example.test");
    const expiredToken = cookieValue(expiredResponse, "acc01a_recovery_challenge");
    now = new Date(now.getTime() + 10 * 60_000);
    const expired = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${expiredToken}` }
    ));
    expect(expired.status).toBe(410);

    now = new Date("2026-07-14T13:00:00.000Z");
    const lockedResponse = await requestChallenge("locked@example.test");
    const lockedToken = cookieValue(lockedResponse, "acc01a_recovery_challenge");
    let finalStatus = 0;
    for (let index = 0; index < 5; index += 1) {
      finalStatus = (await handlers.verifyChallenge(postRequest(
        "/api/recovery/challenges/verify",
        verifyBody({ code: "000000" }),
        { cookie: `acc01a_recovery_challenge=${lockedToken}` }
      ))).status;
    }
    expect(finalStatus).toBe(409);
    expect(await prisma.verifiedRecoverySession.count()).toBe(0);
  });

  it("serializes concurrent correct verification to one MATCH and one inactive response", async () => {
    const challengeResponse = await requestChallenge();
    const token = cookieValue(challengeResponse, "acc01a_recovery_challenge");
    const submit = () => handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${token}` }
    ));
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.verifiedRecoverySession.count()).toBe(1);
    expect(await prisma.recoveryVerificationAttempt.count({ where: { outcomeCode: "MATCH" } })).toBe(1);
  });

  it("never returns a second session cookie when a consumed OTP is replayed", async () => {
    const challengeResponse = await requestChallenge();
    const token = cookieValue(challengeResponse, "acc01a_recovery_challenge");
    const first = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${token}` }
    ));
    const replay = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${token}` }
    ));
    expect(first.status).toBe(200);
    expect(replay.status).toBe(409);
    expect(cookieValue(replay, "acc01a_recovery")).toBeNull();
    expect(await prisma.verifiedRecoverySession.count()).toBe(1);
  });

  it("clears a malformed recovery cookie without creating a session or audit event", async () => {
    const response = await handlers.invalidateSession(deleteRequest(
      "acc01a_recovery=malformed"
    ));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("acc01a_recovery=;");
    expect(await prisma.verifiedRecoverySession.count()).toBe(0);
    expect(await prisma.recoverySecurityEvent.count()).toBe(0);
  });

  it("returns a safe source/global 429 after twenty distinct requests", async () => {
    for (let index = 0; index < 20; index += 1) {
      expect((await requestChallenge(`buyer-${index}@example.test`)).status).toBe(202);
    }
    const denied = await requestChallenge("buyer-20@example.test");
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).not.toBeNull();
    expect(JSON.stringify(await denied.json())).not.toContain("SOURCE_REQUEST_LIMIT");
  });

  it("does not mutate User, Order, Payment, Access, Attempt, Answer or verified student sessions", async () => {
    const before = {
      users: await prisma.user.count(),
      orders: await prisma.commercialOrder.count(),
      payments: await prisma.payment.count(),
      paymentAttempts: await prisma.commercialPaymentAttempt.count(),
      accesses: await prisma.access.count(),
      attempts: await prisma.attempt.count(),
      answers: await prisma.answer.count(),
      verifiedStudentSessions: await prisma.verifiedStudentSession.count()
    };
    const challengeResponse = await requestChallenge();
    const challengeToken = cookieValue(challengeResponse, "acc01a_recovery_challenge");
    const verifyResponse = await handlers.verifyChallenge(postRequest(
      "/api/recovery/challenges/verify",
      verifyBody(),
      { cookie: `acc01a_recovery_challenge=${challengeToken}` }
    ));
    const recoveryToken = cookieValue(verifyResponse, "acc01a_recovery");
    await handlers.invalidateSession(deleteRequest(`acc01a_recovery=${recoveryToken}`));
    expect({
      users: await prisma.user.count(),
      orders: await prisma.commercialOrder.count(),
      payments: await prisma.payment.count(),
      paymentAttempts: await prisma.commercialPaymentAttempt.count(),
      accesses: await prisma.access.count(),
      attempts: await prisma.attempt.count(),
      answers: await prisma.answer.count(),
      verifiedStudentSessions: await prisma.verifiedStudentSession.count()
    }).toEqual(before);
  });

  it("preflights every disabled endpoint to one 404 before request parsing and without writes", async () => {
    handlers = createRecoveryHttpHandlers({
      getRuntime: () => ({ config: { enabled: false } })
    });
    const responses = await Promise.all([
      requestChallenge(),
      handlers.requestChallenge(postRequest(
        "/api/recovery/challenges",
        {},
        { origin: "https://evil.test", rawBody: "{" }
      )),
      handlers.verifyChallenge(postRequest(
        "/api/recovery/challenges/verify",
        {},
        { origin: null, contentType: "text/plain", rawBody: "not-json" }
      )),
      handlers.invalidateSession(new Request(`${origin}/api/recovery/session`, {
        method: "DELETE",
        headers: { origin: "https://evil.test", host: "wrong.test" },
        body: "unexpected"
      }))
    ]);
    const bodies = await Promise.all(responses.map((response) => response.clone().json()));
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(bodies).toEqual(Array.from({ length: 4 }, () => ({
      error: { code: "FEATURE_UNAVAILABLE", message: "Recovery is unavailable." }
    })));
    for (const response of responses) {
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(await prisma.recoveryChallenge.count()).toBe(0);
    expect(await prisma.recoveryVerificationAttempt.count()).toBe(0);
    expect(await prisma.verifiedRecoverySession.count()).toBe(0);
    expect(await prisma.recoveryRateLimitEvent.count()).toBe(0);
    expect(await prisma.recoverySecurityEvent.count()).toBe(0);
    expect(deliveries).toHaveLength(0);
  });
});
