import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type VerifiedStudentSessionSource } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as checkAccessRoute } from "@/app/api/access/check/route";
import { POST as startAttemptRoute } from "@/app/api/attempts/start/route";
import { GET as readAttemptRoute } from "@/app/api/attempts/[attemptId]/route";
import { POST as saveAnswerRoute } from "@/app/api/attempts/[attemptId]/answers/route";
import { POST as completeAttemptRoute } from "@/app/api/attempts/[attemptId]/complete/route";
import { GET as readResultRoute } from "@/app/api/results/[attemptId]/route";
import PublicTestPage from "@/app/(public)/tests/[slug]/page";
import { createStudentSessionToken } from "@/server/auth/student-session";
import {
  authorizeVerifiedStudentDestination
} from "@/server/auth/verified-student-session/destination-guard";
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

const nextCookieState = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = nextCookieState.values.get(name);
      return value === undefined ? undefined : { value };
    },
    set: vi.fn()
  })
}));

const shouldRun = process.env.RUN_ACC01A_DESTINATION_GUARDS_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();
const origin = "http://verified-destinations.test";

function ring(byte: number): RecoveryKeyRing {
  return { activeKeyVersion: "v1", keys: new Map([["v1", Buffer.alloc(32, byte)]]) };
}

const recoveryConfig: EnabledRecoveryConfig = {
  enabled: true,
  mailerMode: "test",
  productCode: "acc01a-destination-product",
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

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ACC01A_DESTINATION_GUARDS_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "acc01a_recovery_ci") {
    throw new Error("ACC01A_DESTINATION_GUARDS_REQUIRES_ACC01A_RECOVERY_CI_SCHEMA");
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
  await prisma.analyticsEvent.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.access.deleteMany();
  await prisma.commercialPaymentEvent.deleteMany();
  await prisma.commercialPaymentAttempt.deleteMany();
  await prisma.commercialOrder.deleteMany();
  await prisma.commercialCheckoutFlow.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.accessCode.deleteMany();
  await prisma.commercialProduct.deleteMany();
  await prisma.question.deleteMany();
  await prisma.test.deleteMany();
  await prisma.user.deleteMany();
}

function authenticSnapshot(testId: string) {
  return {
    testId,
    title: "ACC-01A destination integration",
    subject: "russian",
    mode: "ce_ct",
    examMode: "rikz_russian_2026",
    durationMinutes: 120,
    maxRawScore: 2,
    questions: [{
      snapshotQuestionId: "q_1",
      orderIndex: 1,
      questionText: "Sensitive prompt",
      questionType: "short_answer_token",
      options: {},
      points: 2,
      correctAnswer: "SECRET_CORRECT",
      acceptedAnswers: ["SECRET_ACCEPTED"],
      explanation: "SECRET_EXPLANATION",
      topic: "Sensitive topic",
      subtopic: null,
      scoringRule: "full_match",
      officialPart: "B",
      officialNumber: 1,
      responseSubtype: "word"
    }]
  };
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? "";
  return new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`).exec(header)?.[1] ?? null;
}

function request(
  method: "GET" | "POST",
  path: string,
  input: { cookie?: string; body?: unknown } = {}
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      host: "verified-destinations.test",
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.cookie ? { cookie: input.cookie } : {})
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) })
  });
}

function context(attemptId: string) {
  return { params: Promise.resolve({ attemptId }) };
}

function renderedText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join(" ");
  if (node && typeof node === "object" && "props" in node) {
    return renderedText((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function renderedComponentNames(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(renderedComponentNames);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as { type?: unknown; props?: { children?: unknown } };
  const current = typeof element.type === "function" && element.type.name
    ? [element.type.name]
    : [];
  return [...current, ...renderedComponentNames(element.props?.children)];
}

describeWithDatabase("ACC-01A verified destination guards PostgreSQL integration", () => {
  let now: Date;
  let testId: string;
  let testSlug: string;
  let productId: string;
  let deliveries: RecoveryMail[];
  let domain: ReturnType<typeof createRecoveryDomainService>;
  let resolver: ReturnType<typeof createRecoveryStateResolver>;
  const previousEnvironment = new Map<string, string | undefined>();

  function continuation() {
    return createRecoveryContinuationService({
      client: prisma,
      recoveryConfig,
      verifiedSessionConfig: verifiedConfig,
      clock: () => new Date(now)
    });
  }

  function recoveryHandlers() {
    return createRecoveryHttpHandlers({
      getRuntime: () => ({
        config: recoveryConfig,
        service: domain,
        resolveState: resolver,
        continuation: continuation(),
        trustedOrigin: origin,
        sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE,
        resolverLimiterInput: RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
      }),
      clock: () => new Date(now),
      normalizeRequestTiming: async () => {},
      cookieSecure: false
    });
  }

  async function createPaidAccess(email: string, scope: {
    targetTestId?: string;
    targetProductId?: string;
  } = {}) {
    const targetTestId = scope.targetTestId ?? testId;
    const targetProductId = scope.targetProductId ?? productId;
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, role: "STUDENT" },
      update: {}
    });
    const order = await prisma.commercialOrder.create({
      data: {
        commercialProductId: targetProductId,
        testIdSnapshot: targetTestId,
        productNameSnapshot: "ACC-01A destination product",
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
        testId: targetTestId,
        source: "COMMERCIAL",
        attemptsTotal: 1,
        attemptsAvailable: 1,
        expiresAt: deadline,
        commercialProductId: targetProductId,
        commercialOrderId: order.id,
        commercialPaymentAttemptId: payment.id,
        grantedAt: now,
        startDeadlineAt: deadline
      }
    });
    return { user, order, payment, access, testId: targetTestId, productId: targetProductId };
  }

  async function createAuthenticAttempt(
    fixture: Awaited<ReturnType<typeof createPaidAccess>>,
    status: "STARTED" | "COMPLETED" = "STARTED",
    overrides: { userId?: string; accessId?: string } = {}
  ) {
    const startedAt = new Date(now.getTime() - 60_000);
    const finishedAt = status === "COMPLETED" ? new Date(now.getTime() - 1_000) : null;
    return prisma.attempt.create({
      data: {
        userId: overrides.userId ?? fixture.user.id,
        testId: fixture.testId,
        accessId: overrides.accessId ?? fixture.access.id,
        status,
        startedAt,
        finishedAt,
        durationSeconds: finishedAt ? 59 : null,
        rawScore: finishedAt ? 0 : null,
        maxRawScore: finishedAt ? 2 : null,
        percent: finishedAt ? new Prisma.Decimal(0) : null,
        testSnapshot: authenticSnapshot(fixture.testId)
      }
    });
  }

  async function issueSession(
    fixture: Awaited<ReturnType<typeof createPaidAccess>>,
    source: VerifiedStudentSessionSource = "COMMERCIAL_ORDER_CLAIM",
    logical = { sourceReferenceId: randomUUID(), issuanceOperationId: randomUUID() }
  ) {
    return createVerifiedStudentSessionService({
      client: prisma,
      config: verifiedConfig,
      clock: () => new Date(now)
    }).issue({
      userId: fixture.user.id,
      commercialProductId: fixture.productId,
      testId: fixture.testId,
      accessId: fixture.access.id,
      source,
      ...logical
    });
  }

  async function issueRecoveryCookie(email: string) {
    const handlers = recoveryHandlers();
    const challenge = await handlers.requestChallenge(request("POST", "/api/recovery/challenges", {
      body: {
        email,
        productCode: recoveryConfig.productCode,
        intent: "recovery",
        idempotencyKey: randomUUID()
      }
    }));
    const challengeToken = cookieValue(challenge, "acc01a_recovery_challenge");
    const delivery = deliveries.at(-1);
    expect(challengeToken).not.toBeNull();
    expect(delivery).toBeDefined();
    const verified = await handlers.verifyChallenge(request("POST", "/api/recovery/challenges/verify", {
      cookie: `acc01a_recovery_challenge=${challengeToken}`,
      body: { code: delivery!.code, operationId: randomUUID() }
    }));
    const rawToken = cookieValue(verified, "acc01a_recovery");
    expect(rawToken).not.toBeNull();
    return { rawToken: rawToken!, cookie: `acc01a_recovery=${rawToken}` };
  }

  async function counts() {
    return {
      attempts: await prisma.attempt.count(),
      answers: await prisma.answer.count(),
      eventLogs: await prisma.eventLog.count(),
      analytics: await prisma.analyticsEvent.count()
    };
  }

  beforeAll(() => {
    assertDedicatedTestSchema();
    const values: Record<string, string> = {
      VERIFIED_COMMERCIAL_SESSION_MODE: "enforce",
      VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v1",
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${Buffer.alloc(32, 105).toString("base64url")}`,
      SESSION_SECRET: "destination_integration_session_secret_123456"
    };
    for (const [name, value] of Object.entries(values)) {
      previousEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }
  });

  beforeEach(async () => {
    await cleanDatabase();
    nextCookieState.values.clear();
    // Route handlers intentionally use the production clock. Keep issued
    // sessions current so this integration suite does not become date-expired.
    now = new Date();
    deliveries = [];
    testSlug = `acc01a-destination-${randomUUID()}`;
    const test = await prisma.test.create({
      data: {
        title: "ACC-01A destination integration",
        slug: testSlug,
        price: 1000,
        durationMinutes: 120,
        mode: "CE_CT",
        examMode: "RIKZ_RUSSIAN_2026",
        status: "PUBLISHED",
        questionsCount: 1,
        maxRawScore: 2,
        showCorrectAnswers: true
      }
    });
    testId = test.id;
    await prisma.question.create({
      data: {
        testId,
        questionText: "Sensitive prompt",
        questionType: "SHORT_ANSWER_TOKEN",
        correctAnswer: "SECRET_CORRECT",
        acceptedAnswers: ["SECRET_ACCEPTED"],
        explanation: "SECRET_EXPLANATION",
        topic: "Sensitive topic",
        points: 2,
        officialPart: "B",
        officialNumber: 1,
        responseSubtype: "WORD",
        orderIndex: 1
      }
    });
    const product = await prisma.commercialProduct.create({
      data: {
        code: recoveryConfig.productCode,
        testId,
        name: "ACC-01A destination product",
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
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await prisma.$disconnect();
  });

  it("runs full OTP -> continuation -> PRE -> ATT -> answer -> completion -> RES flow", async () => {
    const fixture = await createPaidAccess("full-flow@example.test");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const recoveryBefore = await prisma.verifiedRecoverySession.findFirstOrThrow();
    const continuationResponse = await recoveryHandlers().continueRecovery(request("POST", "/api/recovery/continue", {
      cookie: recovery.cookie,
      body: { operationId: randomUUID() }
    }));
    expect(continuationResponse.status).toBe(200);
    const verifiedToken = cookieValue(continuationResponse, "verified_student_session");
    expect(verifiedToken).toMatch(/^vs1\.v1\./);
    const continuedRecovery = await prisma.verifiedRecoverySession.findFirstOrThrow();

    const combinedCookie = `verified_student_session=${verifiedToken}; ${recovery.cookie}`;
    const start = await startAttemptRoute(request("POST", "/api/attempts/start", {
      cookie: combinedCookie,
      body: { testId }
    }));
    expect(start.status).toBe(200);
    expect(start.headers.get("cache-control")).toBe("no-store");
    expect(start.headers.get("referrer-policy")).toBe("no-referrer");
    const cleanupCookie = start.headers.get("set-cookie") ?? "";
    expect(cleanupCookie).toContain("acc01a_recovery=");
    expect(cleanupCookie).not.toContain("verified_student_session=");
    const startBody = await start.clone().json();
    const attemptId = startBody.data.attempt.attemptId as string;

    const verifiedCookie = `verified_student_session=${verifiedToken}`;
    const read = await readAttemptRoute(
      request("GET", `/api/attempts/${attemptId}`, { cookie: verifiedCookie }),
      context(attemptId)
    );
    expect(read.status).toBe(200);
    const readBody = await read.json();
    const snapshotQuestionId = readBody.data.attempt.questions[0].snapshotQuestionId as string;
    const saved = await saveAnswerRoute(
      request("POST", `/api/attempts/${attemptId}/answers`, {
        cookie: verifiedCookie,
        body: { snapshotQuestionId, selectedAnswer: "SECRET_ACCEPTED" }
      }),
      context(attemptId)
    );
    expect(saved.status).toBe(200);

    const completed = await completeAttemptRoute(
      request("POST", `/api/attempts/${attemptId}/complete`, { cookie: verifiedCookie }),
      context(attemptId)
    );
    expect(completed.status).toBe(200);
    const result = await readResultRoute(
      request("GET", `/api/results/${attemptId}`, { cookie: verifiedCookie }),
      context(attemptId)
    );
    expect(result.status).toBe(200);
    const resultText = await result.text();
    expect(resultText).not.toContain("SECRET_CORRECT");
    expect(resultText).not.toContain("SECRET_ACCEPTED");
    expect(resultText).not.toContain("SECRET_EXPLANATION");
    expect(resultText).not.toContain("lookup");

    const recoveryAfter = await prisma.verifiedRecoverySession.findFirstOrThrow();
    expect(recoveryAfter).toEqual(continuedRecovery);
    expect(recoveryAfter).toEqual(expect.objectContaining({
      id: recoveryBefore.id,
      status: "REVOKED",
      revocationCode: "CONTINUED"
    }));
    expect(await createVerifiedStudentSessionService({
      client: prisma,
      config: verifiedConfig,
      clock: () => new Date(now)
    }).resolve(verifiedToken!)).toMatchObject({ status: "RESOLVED", source: "EMAIL_OTP_RECOVERY" });
  });

  it("recovery or legacy cookie alone cannot open authentic PRE, ATT or RES", async () => {
    const fixture = await createPaidAccess("cookie-only@example.test");
    const active = await createAuthenticAttempt(fixture);
    const terminal = await createAuthenticAttempt(fixture, "COMPLETED");
    const recovery = await issueRecoveryCookie(fixture.user.email);
    const legacyToken = createStudentSessionToken({
      userId: fixture.user.id,
      email: fixture.user.email,
      role: "STUDENT"
    });

    for (const cookie of [recovery.cookie, `student_session=${legacyToken}`]) {
      const pre = await startAttemptRoute(request("POST", "/api/attempts/start", {
        cookie,
        body: { email: fixture.user.email, testId }
      }));
      const att = await readAttemptRoute(
        request("GET", `/api/attempts/${active.id}`, { cookie }),
        context(active.id)
      );
      const res = await readResultRoute(
        request("GET", `/api/results/${terminal.id}`, { cookie }),
        context(terminal.id)
      );
      for (const response of [pre, att, res]) {
        expect(response.status).toBe(401);
        expect((await response.clone().json()).error.code).toBe("VERIFIED_SESSION_REQUIRED");
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
  });

  it("denies wrong User, Access, Test and copied Attempt UUID without writes", async () => {
    const owner = await createPaidAccess("owner@example.test");
    const otherUser = await createPaidAccess("other@example.test");
    const ownerSession = await issueSession(owner);
    const otherSession = await issueSession(otherUser);
    const wrongUserAttempt = await createAuthenticAttempt(owner, "COMPLETED", { userId: otherUser.user.id });
    const secondaryAccess = await prisma.access.create({
      data: {
        userId: owner.user.id,
        testId,
        source: "COMMERCIAL",
        attemptsTotal: 1,
        attemptsAvailable: 1,
        expiresAt: new Date(now.getTime() + 86_400_000),
        commercialProductId: productId
      }
    });
    const wrongAccessAttempt = await createAuthenticAttempt(owner, "COMPLETED", { accessId: secondaryAccess.id });
    const copiedAttempt = await createAuthenticAttempt(owner, "COMPLETED");

    const otherTest = await prisma.test.create({
      data: {
        title: "Other authentic",
        slug: `other-${randomUUID()}`,
        price: 1000,
        durationMinutes: 120,
        examMode: "RIKZ_RUSSIAN_2026",
        status: "PUBLISHED"
      }
    });
    const otherProduct = await prisma.commercialProduct.create({
      data: { code: `other-${randomUUID()}`, testId: otherTest.id, name: "Other", priceMinor: 1000 }
    });
    const otherScope = await createPaidAccess("other-test@example.test", {
      targetTestId: otherTest.id,
      targetProductId: otherProduct.id
    });
    const otherTestSession = await issueSession(otherScope);
    const before = await counts();

    const cases = [
      [wrongUserAttempt.id, ownerSession.rawToken],
      [wrongAccessAttempt.id, ownerSession.rawToken],
      [copiedAttempt.id, otherSession.rawToken],
      [copiedAttempt.id, otherTestSession.rawToken]
    ] as const;
    for (const [attemptId, token] of cases) {
      const response = await saveAnswerRoute(
        request("POST", `/api/attempts/${attemptId}/answers`, {
          cookie: `verified_student_session=${token}`,
          body: { snapshotQuestionId: "q_1", selectedAnswer: "probe" }
        }),
        context(attemptId)
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("VERIFIED_SCOPE_NOT_ALLOWED");
    }
    expect(await counts()).toEqual(before);
  });

  it("denies stale, revoked and expired sessions plus revoked Access; current generation works", async () => {
    const fixture = await createPaidAccess("credential-state@example.test");
    const attempt = await createAuthenticAttempt(fixture);
    const logical = { sourceReferenceId: randomUUID(), issuanceOperationId: randomUUID() };
    const stale = await issueSession(fixture, "COMMERCIAL_ORDER_CLAIM", logical);
    const current = await issueSession(fixture, "COMMERCIAL_ORDER_CLAIM", logical);
    const read = async (token: string) => readAttemptRoute(
      request("GET", `/api/attempts/${attempt.id}`, { cookie: `verified_student_session=${token}` }),
      context(attempt.id)
    );
    expect((await read(stale.rawToken)).status).toBe(401);
    expect((await read(current.rawToken)).status).toBe(200);

    const service = createVerifiedStudentSessionService({ client: prisma, config: verifiedConfig, clock: () => now });
    await service.revokeCurrent(current.rawToken);
    expect((await read(current.rawToken)).status).toBe(401);

    const expired = await issueSession(fixture, "ACCESS_CODE");
    await prisma.verifiedStudentSession.update({
      where: { id: expired.sessionId },
      data: { expiresAt: new Date(now.getTime() - 1) }
    });
    expect((await read(expired.rawToken)).status).toBe(401);

    const revokedAccessSession = await issueSession(fixture, "ACCESS_CODE");
    await prisma.access.update({ where: { id: fixture.access.id }, data: { revokedAt: now } });
    const denied = await read(revokedAccessSession.rawToken);
    expect(denied.status).toBe(401);
    expect((await denied.json()).error.code).toBe("VERIFIED_SESSION_REQUIRED");
  });

  it("accepts approved Order-claim and AccessCode sources for exact commercial scope", async () => {
    for (const source of ["COMMERCIAL_ORDER_CLAIM", "ACCESS_CODE"] as const) {
      const fixture = await createPaidAccess(`${source.toLowerCase()}@example.test`);
      const attempt = await createAuthenticAttempt(fixture);
      const issued = await issueSession(fixture, source);
      const response = await readAttemptRoute(
        request("GET", `/api/attempts/${attempt.id}`, {
          cookie: `verified_student_session=${issued.rawToken}`
        }),
        context(attempt.id)
      );
      expect(response.status).toBe(200);
    }
  });

  it("keeps a generic commercial Test on legacy authority across real enforce-mode surfaces", async () => {
    const genericTest = await prisma.test.create({
      data: {
        title: "Generic public test",
        slug: `generic-${randomUUID()}`,
        price: 100,
        durationMinutes: 30,
        status: "PUBLISHED",
        questionsCount: 1,
        maxRawScore: 1
      }
    });
    await prisma.question.create({
      data: {
        testId: genericTest.id,
        questionText: "Generic question",
        questionType: "SINGLE_CHOICE",
        optionA: "A",
        optionB: "B",
        correctAnswer: "A",
        topic: "Generic",
        orderIndex: 1
      }
    });
    const genericProduct = await prisma.commercialProduct.create({
      data: {
        code: `generic-${randomUUID()}`,
        testId: genericTest.id,
        name: "Generic commercial product",
        priceMinor: 1000,
        attemptLimit: 1,
        resultRetentionDays: 365
      }
    });
    const fixture = await createPaidAccess("generic-commercial@example.test", {
      targetTestId: genericTest.id,
      targetProductId: genericProduct.id
    });
    const legacyToken = createStudentSessionToken({
      userId: fixture.user.id,
      email: fixture.user.email,
      role: "STUDENT"
    });
    nextCookieState.values.set("student_session", legacyToken);
    const legacyCookie = `student_session=${legacyToken}`;
    const mixedCookies = `${legacyCookie}; verified_student_session=malformed`;
    expect(fixture.access).toMatchObject({
      source: "COMMERCIAL",
      commercialProductId: genericProduct.id,
      commercialOrderId: fixture.order.id,
      commercialPaymentAttemptId: fixture.payment.id
    });

    const pre = await authorizeVerifiedStudentDestination(
      { destination: "PRE", testId: genericTest.id },
      request("GET", `/tests/${genericTest.slug}`, { cookie: mixedCookies })
    );
    expect(pre).toEqual({ status: "LEGACY", mode: "enforce", classification: "GENERIC" });

    const accessCheck = await checkAccessRoute(request("POST", "/api/access/check", {
      body: { email: fixture.user.email, testId: genericTest.id }
    }));
    expect(accessCheck.status).toBe(200);
    expect(await accessCheck.json()).toMatchObject({
      data: { hasAccess: true, status: "can_start", userId: fixture.user.id }
    });

    const start = await startAttemptRoute(request("POST", "/api/attempts/start", {
      cookie: legacyCookie,
      body: { email: fixture.user.email, testId: genericTest.id }
    }));
    expect(start.status).toBe(200);
    const startBody = await start.json();
    expect(JSON.stringify(startBody)).not.toContain("VERIFIED_");
    const attemptId = startBody.data.attempt.attemptId as string;
    const storedAttempt = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { testSnapshot: true }
    });
    expect((storedAttempt.testSnapshot as Record<string, unknown>).examMode).toBe("generic");

    const att = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId },
      request("GET", `/api/attempts/${attemptId}`, { cookie: mixedCookies })
    );
    expect(att).toEqual({ status: "LEGACY", mode: "enforce", classification: "GENERIC" });

    const read = await readAttemptRoute(
      request("GET", `/api/attempts/${attemptId}`, { cookie: legacyCookie }),
      context(attemptId)
    );
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expect(JSON.stringify(readBody)).not.toContain("VERIFIED_");
    const snapshotQuestionId = readBody.data.attempt.questions[0].snapshotQuestionId as string;

    const saved = await saveAnswerRoute(
      request("POST", `/api/attempts/${attemptId}/answers`, {
        cookie: legacyCookie,
        body: { snapshotQuestionId, selectedAnswer: "A" }
      }),
      context(attemptId)
    );
    expect(saved.status).toBe(200);
    expect(JSON.stringify(await saved.json())).not.toContain("VERIFIED_");

    const completed = await completeAttemptRoute(
      request("POST", `/api/attempts/${attemptId}/complete`, { cookie: legacyCookie }),
      context(attemptId)
    );
    expect(completed.status).toBe(200);
    expect(JSON.stringify(await completed.json())).not.toContain("VERIFIED_");

    const res = await authorizeVerifiedStudentDestination(
      { destination: "RES", attemptId },
      request("GET", `/api/results/${attemptId}`, { cookie: mixedCookies })
    );
    expect(res).toEqual({ status: "LEGACY", mode: "enforce", classification: "GENERIC" });

    const result = await readResultRoute(
      request("GET", `/api/results/${attemptId}`, { cookie: legacyCookie }),
      context(attemptId)
    );
    expect(result.status).toBe(200);
    expect(JSON.stringify(await result.json())).not.toContain("VERIFIED_");

    const page = await PublicTestPage({ params: Promise.resolve({ slug: genericTest.slug }) });
    expect(renderedText(page)).toContain("Generic public test");
    expect(renderedComponentNames(page)).toContain("TestAccessForm");
  });

  it("rejected writes have no effects and the guard itself creates no EventLog or analytics rows", async () => {
    const fixture = await createPaidAccess("no-writes@example.test");
    const attempt = await createAuthenticAttempt(fixture);
    const beforeRejected = await counts();
    const rejected = await saveAnswerRoute(
      request("POST", `/api/attempts/${attempt.id}/answers`, {
        body: { snapshotQuestionId: "q_1", selectedAnswer: "secret" }
      }),
      context(attempt.id)
    );
    expect(rejected.status).toBe(401);
    expect(await counts()).toEqual(beforeRejected);

    const issued = await issueSession(fixture);
    const beforeGuard = await counts();
    const logSpy = vi.spyOn(console, "log");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    const decision = await authorizeVerifiedStudentDestination(
      { destination: "ATT", attemptId: attempt.id },
      request("GET", `/attempts/${attempt.id}`, {
        cookie: `verified_student_session=${issued.rawToken}`
      })
    );
    expect(decision.status).toBe("AUTHORIZED");
    expect(await counts()).toEqual(beforeGuard);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
