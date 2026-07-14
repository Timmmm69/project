import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import { createVerifiedStudentSessionService } from "@/server/auth/verified-student-session/service";
import type { EnabledRecoveryConfig, RecoveryKeyRing } from "@/server/recovery/config";
import { createRecoveryContinuationService } from "@/server/recovery/continuation";
import { createRecoveryHttpHandlers } from "@/server/recovery/http-handlers";
import {
  RECOVERY_HTTP_GLOBAL_SOURCE,
  RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
} from "@/server/recovery/http-runtime";
import type { RecoveryMail } from "@/server/recovery/mailer";
import { createRecoveryDomainService } from "@/server/recovery/service";
import { createRecoveryStateResolver } from "@/server/recovery/state-resolver";

const shouldRun = process.env.RUN_ACC01A_CONTINUATION_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();
const origin = "http://recovery-continuation.test";

function ring(byte: number): RecoveryKeyRing {
  return { activeKeyVersion: "v1", keys: new Map([["v1", Buffer.alloc(32, byte)]]) };
}

const recoveryConfig: EnabledRecoveryConfig = {
  enabled: true,
  mailerMode: "test",
  productCode: "acc01a-continuation-product",
  keyRings: {
    emailFingerprint: ring(81),
    challengeToken: ring(82),
    otpMac: ring(83),
    sessionToken: ring(84)
  }
};

const verifiedConfig: VerifiedStudentSessionConfig = {
  mode: "enforce",
  activeKeyVersion: "v1",
  keys: new Map([["v1", Buffer.alloc(32, 85)]])
};

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ACC01A_CONTINUATION_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "acc01a_recovery_ci") {
    throw new Error("ACC01A_CONTINUATION_REQUIRES_ACC01A_RECOVERY_CI_SCHEMA");
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

function authenticSnapshot(testId: string) {
  return {
    testId,
    subject: "russian",
    mode: "ce_ct",
    examMode: "rikz_russian_2026",
    durationMinutes: 120,
    maxRawScore: 80,
    questions: Array.from({ length: 40 }, (_, index) => ({
      snapshotQuestionId: `q_${index + 1}`,
      orderIndex: index,
      questionType: index < 18 ? "multi_select_five" : "short_answer_token",
      points: 2,
      correctAnswer: "SECRET_CORRECT",
      acceptedAnswers: ["SECRET_ACCEPTED"]
    }))
  };
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? "";
  return new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`).exec(header)?.[1] ?? null;
}

function post(path: string, body: unknown, cookie?: string) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      host: "recovery-continuation.test",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

function getState(cookie: string) {
  return new Request(`${origin}/api/recovery/state`, { headers: { cookie } });
}

describeWithDatabase("ACC-01A recovery continuation PostgreSQL integration", () => {
  let now: Date;
  let testId: string;
  let testSlug: string;
  let productId: string;
  let deliveries: RecoveryMail[];
  let domain: ReturnType<typeof createRecoveryDomainService>;
  let resolver: ReturnType<typeof createRecoveryStateResolver>;

  function continuation(afterCommit?: () => Promise<void>) {
    return createRecoveryContinuationService({
      client: prisma,
      recoveryConfig,
      verifiedSessionConfig: verifiedConfig,
      clock: () => new Date(now),
      testHooks: afterCommit ? { afterCommit } : undefined
    });
  }

  function handlers(exchange = continuation()) {
    return createRecoveryHttpHandlers({
      getRuntime: () => ({
        config: recoveryConfig,
        service: domain,
        resolveState: resolver,
        continuation: exchange,
        trustedOrigin: origin,
        sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE,
        resolverLimiterInput: RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
      }),
      clock: () => new Date(now),
      normalizeRequestTiming: async () => {},
      cookieSecure: false
    });
  }

  async function createPaidAccess(email: string) {
    const user = await prisma.user.create({ data: { email, role: "STUDENT" } });
    const order = await prisma.commercialOrder.create({
      data: {
        commercialProductId: productId,
        testIdSnapshot: testId,
        productNameSnapshot: "ACC-01A continuation product",
        priceMinor: 1000,
        currency: "BYN",
        emailOriginal: email,
        emailNormalized: email,
        status: "PAID",
        offerVersion: "test-v1",
        privacyVersion: "test-v1",
        refundPolicyVersion: "test-v1",
        disclaimerVersion: "test-v1",
        adultBuyerConfirmedAt: now,
        idempotencyKey: randomUUID(),
        lookupTokenHash: randomUUID(),
        paidAt: now
      }
    });
    const payment = await prisma.commercialPaymentAttempt.create({
      data: {
        commercialOrderId: order.id,
        provider: "LOCAL_FAKE",
        merchantReference: randomUUID(),
        providerPaymentId: randomUUID(),
        status: "PAID",
        amountMinor: 1000,
        currency: "BYN",
        verifiedAt: now,
        paidAt: now
      }
    });
    const deadline = new Date(now.getTime() + 90 * 86_400_000);
    const access = await prisma.access.create({
      data: {
        userId: user.id,
        testId,
        source: "COMMERCIAL",
        attemptsTotal: 1,
        attemptsAvailable: 1,
        expiresAt: deadline,
        commercialProductId: productId,
        commercialOrderId: order.id,
        commercialPaymentAttemptId: payment.id,
        grantedAt: now,
        startDeadlineAt: deadline
      }
    });
    return { user, order, payment, access };
  }

  async function createAttempt(
    fixture: Awaited<ReturnType<typeof createPaidAccess>>,
    status: "STARTED" | "COMPLETED"
  ) {
    const startedAt = new Date(now.getTime() - 3_600_000);
    const finishedAt = status === "COMPLETED" ? new Date(now.getTime() - 60_000) : null;
    const attempt = await prisma.attempt.create({
      data: {
        userId: fixture.user.id,
        testId,
        accessId: fixture.access.id,
        status,
        startedAt,
        finishedAt,
        durationSeconds: finishedAt
          ? Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1_000)
          : null,
        rawScore: finishedAt ? 60 : null,
        maxRawScore: finishedAt ? 80 : null,
        percent: finishedAt ? new Prisma.Decimal(75) : null,
        testSnapshot: authenticSnapshot(testId)
      }
    });
    await prisma.access.update({
      where: { id: fixture.access.id },
      data: { attemptsAvailable: 0 }
    });
    return attempt;
  }

  async function issueRecoveryCookie(email: string) {
    const http = handlers();
    const challenge = await http.requestChallenge(post("/api/recovery/challenges", {
      email,
      productCode: recoveryConfig.productCode,
      intent: "recovery",
      idempotencyKey: randomUUID()
    }));
    const challengeToken = cookieValue(challenge, "acc01a_recovery_challenge");
    const delivery = deliveries.at(-1);
    expect(challengeToken).not.toBeNull();
    expect(delivery).toBeDefined();
    const verified = await http.verifyChallenge(post("/api/recovery/challenges/verify", {
      code: delivery!.code,
      operationId: randomUUID()
    }, `acc01a_recovery_challenge=${challengeToken}`));
    const rawToken = cookieValue(verified, "acc01a_recovery");
    expect(rawToken).not.toBeNull();
    return { rawToken: rawToken!, cookie: `acc01a_recovery=${rawToken}` };
  }

  async function businessSnapshot() {
    return {
      users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
      orders: await prisma.commercialOrder.findMany({ orderBy: { id: "asc" } }),
      payments: await prisma.commercialPaymentAttempt.findMany({ orderBy: { id: "asc" } }),
      genericPayments: await prisma.payment.findMany({ orderBy: { id: "asc" } }),
      accesses: await prisma.access.findMany({ orderBy: { id: "asc" } }),
      attempts: await prisma.attempt.findMany({ orderBy: { id: "asc" } }),
      answers: await prisma.answer.findMany({ orderBy: { id: "asc" } }),
      eventLogs: await prisma.eventLog.findMany({ orderBy: { id: "asc" } }),
      analyticsEvents: await prisma.analyticsEvent.findMany({ orderBy: { id: "asc" } })
    };
  }

  beforeAll(() => assertDedicatedTestSchema());

  beforeEach(async () => {
    await cleanDatabase();
    now = new Date("2026-07-14T12:00:00.000Z");
    deliveries = [];
    testSlug = `acc01a-continuation-${randomUUID()}`;
    const test = await prisma.test.create({
      data: {
        title: "ACC-01A continuation integration",
        slug: testSlug,
        price: 1000,
        durationMinutes: 120,
        examMode: "RIKZ_RUSSIAN_2026",
        status: "PUBLISHED"
      }
    });
    testId = test.id;
    const product = await prisma.commercialProduct.create({
      data: {
        code: recoveryConfig.productCode,
        testId,
        name: "ACC-01A continuation product",
        priceMinor: 1000,
        attemptLimit: 1,
        resultRetentionDays: 365
      }
    });
    productId = product.id;
    domain = createRecoveryDomainService({
      client: prisma,
      config: recoveryConfig,
      mailer: {
        async sendVerificationCode(message) {
          deliveries.push(message);
          return { status: "accepted" };
        }
      },
      clock: () => new Date(now),
      otpGenerator: () => "908172"
    });
    resolver = createRecoveryStateResolver({
      client: prisma,
      productCode: recoveryConfig.productCode,
      clock: () => new Date(now)
    });
  });

  afterAll(async () => {
    if (shouldRun) await cleanDatabase();
    await prisma.$disconnect();
  });

  it.each([
    ["access_unstarted", "OPEN_PRE"],
    ["attempt_active", "OPEN_ATTEMPT"],
    ["result_available", "OPEN_RESULT"]
  ] as const)("runs full OTP/resolver/continue flow for %s", async (state, action) => {
    const email = `${state}@example.test`;
    const fixture = await createPaidAccess(email);
    const attempt = state === "access_unstarted"
      ? null
      : await createAttempt(fixture, state === "attempt_active" ? "STARTED" : "COMPLETED");
    const recovery = await issueRecoveryCookie(email);
    const resolved = await handlers().resolveState(getState(recovery.cookie));
    expect((await resolved.json()).state).toBe(state);
    const before = await businessSnapshot();
    const operation = randomUUID();
    const response = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId: operation },
      recovery.cookie
    ));
    expect(response.status).toBe(200);
    const expectedUrl = action === "OPEN_PRE"
      ? `/tests/${testSlug}`
      : action === "OPEN_ATTEMPT" ? `/attempts/${attempt!.id}` : `/results/${attempt!.id}`;
    expect(await response.clone().json()).toEqual({ nextAction: action, nextUrl: expectedUrl });
    const verifiedToken = cookieValue(response, "verified_student_session");
    expect(verifiedToken).toMatch(/^vs1\.v1\./);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=strict");
    const verified = createVerifiedStudentSessionService({
      client: prisma,
      config: verifiedConfig,
      clock: () => new Date(now)
    });
    expect(await verified.resolve(verifiedToken!)).toMatchObject({
      status: "RESOLVED",
      scope: {
        userId: fixture.user.id,
        commercialProductId: productId,
        testId,
        accessId: fixture.access.id
      },
      source: "EMAIL_OTP_RECOVERY"
    });
    const session = await prisma.verifiedRecoverySession.findFirstOrThrow();
    expect(session).toMatchObject({
      status: "REVOKED",
      revocationCode: "CONTINUED",
      continuationOperationId: operation,
      continuationNextAction: action,
      continuationNextUrl: expectedUrl
    });
    expect(session.continuedAt).toEqual(session.revokedAt);
    expect(session.continuationVerifiedStudentSessionId).not.toBeNull();
    const verifiedRow = await prisma.verifiedStudentSession.findUniqueOrThrow({
      where: { id: session.continuationVerifiedStudentSessionId! }
    });
    const cookieExpires = /Expires=([^;]+)/i.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(cookieExpires).toBeDefined();
    expect(new Date(cookieExpires!).getTime()).toBeLessThanOrEqual(verifiedRow.expiresAt.getTime());
    expect(await businessSnapshot()).toEqual(before);
    const persisted = JSON.stringify({
      recovery: await prisma.verifiedRecoverySession.findMany(),
      verified: await prisma.verifiedStudentSession.findMany()
    });
    expect(persisted).not.toContain(recovery.rawToken);
    expect(persisted).not.toContain(verifiedToken!);
    expect((await handlers().resolveState(getState(recovery.cookie))).status).toBe(401);
  });

  it("replays the same operation on one logical session without extending absolute expiry", async () => {
    const fixture = await createPaidAccess("replay@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const operationId = randomUUID();
    const first = await handlers().continueRecovery(post("/api/recovery/continue", { operationId }, recovery.cookie));
    const firstRow = await prisma.verifiedStudentSession.findFirstOrThrow();
    const firstToken = cookieValue(first, "verified_student_session");
    const second = await handlers().continueRecovery(post("/api/recovery/continue", { operationId }, recovery.cookie));
    const secondRow = await prisma.verifiedStudentSession.findFirstOrThrow();
    const secondToken = cookieValue(second, "verified_student_session");
    expect(await second.clone().json()).toEqual(await first.clone().json());
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
    expect(secondRow.tokenGeneration).toBe(firstRow.tokenGeneration + 1);
    expect(secondRow.expiresAt).toEqual(firstRow.expiresAt);
    expect(secondToken).not.toBe(firstToken);
    const verifier = createVerifiedStudentSessionService({ client: prisma, config: verifiedConfig, clock: () => now });
    expect((await verifier.resolve(firstToken!)).status).toBe("NOT_FOUND");
    expect((await verifier.resolve(secondToken!)).status).toBe("RESOLVED");

    const conflict = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId: randomUUID() },
      recovery.cookie
    ));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("CONTINUATION_OPERATION_CONFLICT");
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
  });

  it("uses current truth and refuses non-actionable state without a partial outcome", async () => {
    const fixture = await createPaidAccess("changed@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    expect((await (await handlers().resolveState(getState(recovery.cookie))).json()).state)
      .toBe("access_unstarted");
    await prisma.access.update({ where: { id: fixture.access.id }, data: { revokedAt: now } });
    const response = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId: randomUUID() },
      recovery.cookie
    ));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("STATE_CHANGED_RETRY_RESOLVE");
    expect(await prisma.verifiedStudentSession.count()).toBe(0);
    expect(await prisma.verifiedRecoverySession.findFirstOrThrow()).toMatchObject({
      status: "ACTIVE",
      continuationOperationId: null,
      continuationNextAction: null,
      continuationNextUrl: null,
      continuationVerifiedStudentSessionId: null,
      continuedAt: null
    });
  });

  it("re-resolves an Attempt started or completed after the prior GET", async () => {
    const fixture = await createPaidAccess("transition@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    expect((await (await handlers().resolveState(getState(recovery.cookie))).json()).state)
      .toBe("access_unstarted");
    const attempt = await createAttempt(fixture, "STARTED");
    const active = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId: randomUUID() },
      recovery.cookie
    ));
    expect(await active.json()).toMatchObject({
      nextAction: "OPEN_ATTEMPT",
      nextUrl: `/attempts/${attempt.id}`
    });

  });

  it("uses completed current truth after an earlier active-attempt resolver read", async () => {
    const fixture = await createPaidAccess("completed-transition@example.test");
    const attempt = await createAttempt(fixture, "STARTED");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    expect((await (await handlers().resolveState(getState(recovery.cookie))).json()).state)
      .toBe("attempt_active");
    const finishedAt = new Date(now.getTime() - 60_000);
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        status: "COMPLETED",
        finishedAt,
        durationSeconds: Math.floor((finishedAt.getTime() - attempt.startedAt.getTime()) / 1_000),
        rawScore: 60,
        maxRawScore: 80,
        percent: new Prisma.Decimal(75)
      }
    });
    const response = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId: randomUUID() },
      recovery.cookie
    ));
    expect(await response.json()).toEqual({
      nextAction: "OPEN_RESULT",
      nextUrl: `/results/${attempt.id}`
    });
  });

  it("recovers a deterministic post-commit response failure with the same operation", async () => {
    const fixture = await createPaidAccess("unknown@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const operationId = randomUUID();
    let fail = true;
    const faulting = continuation(async () => {
      if (fail) {
        fail = false;
        throw new Error("injected response failure");
      }
    });
    const unknown = await handlers(faulting).continueRecovery(post(
      "/api/recovery/continue",
      { operationId },
      recovery.cookie
    ));
    expect(unknown.status).toBe(503);
    expect((await unknown.json()).error.code).toBe("CONTINUATION_OUTCOME_UNKNOWN");
    expect(unknown.headers.get("set-cookie") ?? "").not.toContain("verified_student_session");
    expect(unknown.headers.get("set-cookie") ?? "").not.toContain("acc01a_recovery=;");
    expect(await prisma.verifiedStudentSession.count()).toBe(1);

    const recovered = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId },
      recovery.cookie
    ));
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      nextAction: "OPEN_PRE",
      nextUrl: `/tests/${testSlug}`
    });
    expect((await prisma.verifiedStudentSession.findFirstOrThrow()).tokenGeneration).toBe(2);
  });

  it("serializes parallel same-operation calls and converges on a current token", async () => {
    const fixture = await createPaidAccess("parallel@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const operationId = randomUUID();
    const same = await Promise.all([
      handlers().continueRecovery(post("/api/recovery/continue", { operationId }, recovery.cookie)),
      handlers().continueRecovery(post("/api/recovery/continue", { operationId }, recovery.cookie))
    ]);
    expect(same.some((response) => response.status === 200)).toBe(true);
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
    expect(await prisma.verifiedRecoverySession.count({
      where: { continuationOperationId: operationId }
    })).toBe(1);
    const converged = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId },
      recovery.cookie
    ));
    expect(converged.status).toBe(200);

  });

  it("lets at most one of two parallel different operations commit", async () => {
    const fixture = await createPaidAccess("parallel-conflict@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const responses = await Promise.all([
      handlers().continueRecovery(post(
        "/api/recovery/continue",
        { operationId: randomUUID() },
        recovery.cookie
      )),
      handlers().continueRecovery(post(
        "/api/recovery/continue",
        { operationId: randomUUID() },
        recovery.cookie
      ))
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const loser = responses.find((response) => response.status === 409)!;
    expect((await loser.json()).error.code).toBe("CONTINUATION_OPERATION_CONFLICT");
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
    expect(await prisma.verifiedRecoverySession.count({
      where: { continuationOperationId: { not: null } }
    })).toBe(1);
  });

  it("rolls back verified-session and outcome writes when issuance fails", async () => {
    const fixture = await createPaidAccess("rollback@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const brokenConfig: VerifiedStudentSessionConfig = {
      mode: "enforce",
      activeKeyVersion: "missing",
      keys: new Map()
    };
    const broken = createRecoveryContinuationService({
      client: prisma,
      recoveryConfig,
      verifiedSessionConfig: brokenConfig,
      clock: () => new Date(now)
    });
    const response = await handlers(broken).continueRecovery(post(
      "/api/recovery/continue",
      { operationId: randomUUID() },
      recovery.cookie
    ));
    expect(response.status).toBe(503);
    expect(await prisma.verifiedStudentSession.count()).toBe(0);
    expect(await prisma.verifiedRecoverySession.findFirstOrThrow()).toMatchObject({
      status: "ACTIVE",
      continuationOperationId: null,
      continuationNextAction: null,
      continuationNextUrl: null,
      continuationVerifiedStudentSessionId: null,
      continuedAt: null
    });
  });

  it("does not treat a generic Access as recovery continuation authority", async () => {
    const email = "generic@example.test";
    const user = await prisma.user.create({ data: { email, role: "STUDENT" } });
    const genericTest = await prisma.test.create({
      data: {
        title: "Generic",
        slug: `generic-${randomUUID()}`,
        price: 100,
        durationMinutes: 30,
        status: "PUBLISHED"
      }
    });
    await prisma.access.create({
      data: {
        userId: user.id,
        testId: genericTest.id,
        source: "MANUAL",
        attemptsTotal: 1,
        attemptsAvailable: 1,
        expiresAt: new Date(now.getTime() + 86_400_000)
      }
    });
    const recovery = await issueRecoveryCookie(email);
    const response = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId: randomUUID() },
      recovery.cookie
    ));
    expect(response.status).toBe(409);
    expect(await prisma.verifiedStudentSession.count()).toBe(0);
  });

  it("writes only allowlisted recovery audit fields and leaves unrelated verified sessions active", async () => {
    const fixture = await createPaidAccess("audit@example.test");
    const unrelated = await createVerifiedStudentSessionService({
      client: prisma,
      config: verifiedConfig,
      clock: () => new Date(now)
    }).issue({
      userId: fixture.user.id,
      commercialProductId: productId,
      testId,
      accessId: fixture.access.id,
      source: "COMMERCIAL_ORDER_CLAIM",
      sourceReferenceId: fixture.order.id,
      issuanceOperationId: randomUUID()
    });
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const before = await businessSnapshot();
    const response = await handlers().continueRecovery(post(
      "/api/recovery/continue",
      { operationId: randomUUID() },
      recovery.cookie
    ));
    expect(response.status).toBe(200);
    expect(await businessSnapshot()).toEqual(before);
    const unrelatedRow = await prisma.verifiedStudentSession.findUniqueOrThrow({
      where: { id: unrelated.sessionId }
    });
    expect(unrelatedRow.revokedAt).toBeNull();
    const continuationEvents = await prisma.recoverySecurityEvent.findMany({
      where: { eventCode: { in: ["VERIFIED_SESSION_ISSUED", "SESSION_REVOKED"] } },
      orderBy: { occurredAt: "asc" }
    });
    expect(continuationEvents.map((event) => ({
      eventCode: event.eventCode,
      reasonCode: event.reasonCode,
      challengeId: event.challengeId
    }))).toEqual([
      {
        eventCode: "VERIFIED_SESSION_ISSUED",
        reasonCode: "SESSION_CONTINUED",
        challengeId: null
      },
      {
        eventCode: "SESSION_REVOKED",
        reasonCode: "SESSION_CONTINUED",
        challengeId: null
      }
    ]);
  });
});
