import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as startCommercialAttempt } from "@/app/api/commercial/orders/[publicId]/start-attempt/route";
import { GET as readAttempt } from "@/app/api/attempts/[attemptId]/route";
import { POST as saveAnswer } from "@/app/api/attempts/[attemptId]/answers/route";
import { POST as completeAttempt } from "@/app/api/attempts/[attemptId]/complete/route";
import { GET as readResult } from "@/app/api/results/[attemptId]/route";
import { orderTokenCookieName } from "@/lib/commercial/commercial-service";
import { createLookupToken, hashLookupToken } from "@/lib/commercial/security";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import { createVerifiedStudentSessionService } from "@/server/auth/verified-student-session/service";

const nextCookieState = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = nextCookieState.values.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => nextCookieState.values.set(name, value)
  })
}));

const shouldRun = process.env.RUN_ACC01A_ORDER_ISSUER_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();
const origin = "http://commercial-order-issuer.test";
const verifiedKey = Buffer.alloc(32, 121);
const verifiedConfig: VerifiedStudentSessionConfig = {
  mode: "enforce",
  activeKeyVersion: "v1",
  keys: new Map([["v1", verifiedKey]])
};

type Fixture = Awaited<ReturnType<typeof createCommercialFixture>>;

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ACC01A_ORDER_ISSUER_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "acc01a_order_issuer_ci") {
    throw new Error("ACC01A_ORDER_ISSUER_REQUIRES_DEDICATED_SCHEMA");
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

async function createCommercialFixture(input: {
  email?: string;
  examMode?: "GENERIC" | "RIKZ_RUSSIAN_2026";
} = {}) {
  const email = input.email ?? `issuer-${randomUUID()}@example.test`;
  const examMode = input.examMode ?? "RIKZ_RUSSIAN_2026";
  const test = await prisma.test.create({
    data: {
      title: `Order issuer ${examMode}`,
      slug: `order-issuer-${randomUUID()}`,
      price: 1000,
      durationMinutes: 120,
      mode: "CE_CT",
      examMode,
      status: "PUBLISHED",
      questionsCount: 1,
      maxRawScore: 1,
      showCorrectAnswers: false
    }
  });
  const question = await prisma.question.create({
    data: {
      testId: test.id,
      questionText: "Integration prompt",
      questionType: "SHORT_ANSWER_TOKEN",
      correctAnswer: "correct",
      acceptedAnswers: ["accepted"],
      explanation: "private explanation",
      topic: "Integration",
      points: 1,
      officialPart: "B",
      officialNumber: 1,
      responseSubtype: "WORD",
      orderIndex: 1
    }
  });
  const product = await prisma.commercialProduct.create({
    data: {
      code: `order-issuer-${randomUUID()}`,
      testId: test.id,
      name: "Order issuer product",
      priceMinor: 1000,
      attemptLimit: 1,
      resultRetentionDays: 365
    }
  });
  const user = await prisma.user.create({ data: { email, role: "STUDENT" } });
  const lookupToken = createLookupToken();
  const now = new Date();
  const order = await prisma.commercialOrder.create({
    data: {
      commercialProductId: product.id,
      testIdSnapshot: test.id,
      productNameSnapshot: product.name,
      priceMinor: product.priceMinor,
      currency: "BYN",
      emailOriginal: email,
      emailNormalized: email,
      status: "PAID",
      offerVersion: "integration-v1",
      privacyVersion: "integration-v1",
      refundPolicyVersion: "integration-v1",
      disclaimerVersion: "integration-v1",
      adultBuyerConfirmedAt: now,
      idempotencyKey: randomUUID(),
      lookupTokenHash: hashLookupToken(lookupToken),
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
      testId: test.id,
      source: "COMMERCIAL",
      attemptsTotal: 1,
      attemptsAvailable: 1,
      expiresAt: deadline,
      commercialProductId: product.id,
      commercialOrderId: order.id,
      commercialPaymentAttemptId: payment.id,
      grantedAt: now,
      startDeadlineAt: deadline
    }
  });
  return { test, question, product, user, order, payment, access, lookupToken };
}

function commercialRequest(fixture: Fixture, operationId = randomUUID()) {
  nextCookieState.values.set(orderTokenCookieName(fixture.order.publicId), fixture.lookupToken);
  return new Request(`${origin}/api/commercial/orders/${fixture.order.publicId}/start-attempt`, {
    method: "POST",
    headers: {
      origin,
      host: "commercial-order-issuer.test",
      "Idempotency-Key": operationId
    }
  });
}

function destinationRequest(method: "GET" | "POST", path: string, rawToken: string, body?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      host: "commercial-order-issuer.test",
      cookie: `verified_student_session=${rawToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function commercialContext(fixture: Fixture) {
  return { params: Promise.resolve({ publicId: fixture.order.publicId }) };
}

function attemptContext(attemptId: string) {
  return { params: Promise.resolve({ attemptId }) };
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? "";
  return new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`).exec(header)?.[1] ?? null;
}

async function businessCounts() {
  return {
    orders: await prisma.commercialOrder.count(),
    payments: await prisma.commercialPaymentAttempt.count(),
    accesses: await prisma.access.count(),
    attempts: await prisma.attempt.count(),
    answers: await prisma.answer.count(),
    eventLogs: await prisma.eventLog.count(),
    analytics: await prisma.analyticsEvent.count()
  };
}

async function expectRejectedWithoutSession(fixture: Fixture, expectedCode = "PAYMENT_NOT_CONFIRMED") {
  const sessionCount = await prisma.verifiedStudentSession.count();
  const before = await businessCounts();
  const response = await startCommercialAttempt(
    commercialRequest(fixture),
    commercialContext(fixture)
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect((await response.clone().json()).error.code).toBe(expectedCode);
  expect(response.headers.get("set-cookie") ?? "").not.toContain("verified_student_session=");
  expect(await prisma.verifiedStudentSession.count()).toBe(sessionCount);
  expect(await businessCounts()).toEqual(before);
}

describeWithDatabase("ACC-01A commercial Order issuer PostgreSQL integration", () => {
  const previousEnvironment = new Map<string, string | undefined>();

  beforeAll(() => {
    assertDedicatedTestSchema();
    const values: Record<string, string> = {
      VERIFIED_COMMERCIAL_SESSION_MODE: "enforce",
      VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v1",
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${verifiedKey.toString("base64url")}`,
      SESSION_SECRET: "commercial_order_issuer_session_secret_123456"
    };
    for (const [name, value] of Object.entries(values)) {
      previousEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }
  });

  beforeEach(async () => {
    await cleanDatabase();
    nextCookieState.values.clear();
    process.env.VERIFIED_COMMERCIAL_SESSION_MODE = "enforce";
  });

  afterAll(async () => {
    if (shouldRun) await cleanDatabase();
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await prisma.$disconnect();
  });

  it("exchanges exact Order proof, guards START/ATT/RES, and rotates a same-operation session", async () => {
    const fixture = await createCommercialFixture();
    const operationId = randomUUID();
    const start = await startCommercialAttempt(
      commercialRequest(fixture, operationId),
      commercialContext(fixture)
    );
    expect(start.status).toBe(200);
    expect(start.headers.get("cache-control")).toBe("no-store");
    expect(start.headers.get("referrer-policy")).toBe("no-referrer");
    const firstRawToken = cookieValue(start, "verified_student_session");
    expect(firstRawToken).toMatch(/^vs1\.v1\./);
    const startText = await start.clone().text();
    expect(startText).not.toContain(firstRawToken!);
    expect(startText).not.toContain(fixture.order.id);
    const startBody = JSON.parse(startText);
    const attemptId = startBody.data.attempt.attemptId as string;
    expect(startBody.data.nextAction).toBe("START_TEST");
    expect(await prisma.attempt.count()).toBe(1);

    const stored = await prisma.verifiedStudentSession.findFirstOrThrow();
    expect(stored).toMatchObject({
      source: "COMMERCIAL_ORDER_CLAIM",
      sourceReferenceId: fixture.order.id,
      issuanceOperationId: operationId,
      userId: fixture.user.id,
      commercialProductId: fixture.product.id,
      testId: fixture.test.id,
      accessId: fixture.access.id,
      tokenGeneration: 1
    });
    const service = createVerifiedStudentSessionService({ client: prisma, config: verifiedConfig });
    expect(await service.resolve(firstRawToken!)).toMatchObject({
      status: "RESOLVED",
      source: "COMMERCIAL_ORDER_CLAIM",
      sourceReferenceId: fixture.order.id,
      issuanceOperationId: operationId,
      scope: {
        userId: fixture.user.id,
        commercialProductId: fixture.product.id,
        testId: fixture.test.id,
        accessId: fixture.access.id
      }
    });

    const retry = await startCommercialAttempt(
      commercialRequest(fixture, operationId),
      commercialContext(fixture)
    );
    expect(retry.status).toBe(200);
    expect((await retry.clone().json()).data).toMatchObject({
      nextAction: "RESUME_TEST",
      nextUrl: `/attempts/${attemptId}`
    });
    const currentRawToken = cookieValue(retry, "verified_student_session");
    expect(currentRawToken).toMatch(/^vs1\.v1\./);
    expect(currentRawToken).not.toBe(firstRawToken);
    const rotated = await prisma.verifiedStudentSession.findFirstOrThrow();
    expect(rotated).toMatchObject({
      id: stored.id,
      tokenGeneration: 2,
      issuedAt: stored.issuedAt,
      expiresAt: stored.expiresAt
    });
    expect(await service.resolve(firstRawToken!)).toMatchObject({ status: "NOT_FOUND" });
    expect(await service.resolve(currentRawToken!)).toMatchObject({ status: "RESOLVED", tokenGeneration: 2 });
    expect(await prisma.attempt.count()).toBe(1);

    const staleRead = await readAttempt(
      destinationRequest("GET", `/api/attempts/${attemptId}`, firstRawToken!),
      attemptContext(attemptId)
    );
    expect(staleRead.status).toBe(401);
    const currentRead = await readAttempt(
      destinationRequest("GET", `/api/attempts/${attemptId}`, currentRawToken!),
      attemptContext(attemptId)
    );
    expect(currentRead.status).toBe(200);
    const currentBody = await currentRead.json();
    const snapshotQuestionId = currentBody.data.attempt.questions[0].snapshotQuestionId as string;
    const saved = await saveAnswer(
      destinationRequest("POST", `/api/attempts/${attemptId}/answers`, currentRawToken!, {
        snapshotQuestionId,
        selectedAnswer: "accepted"
      }),
      attemptContext(attemptId)
    );
    expect(saved.status).toBe(200);
    expect(await prisma.answer.count()).toBe(1);

    const resumeOperation = randomUUID();
    const resume = await startCommercialAttempt(
      commercialRequest(fixture, resumeOperation),
      commercialContext(fixture)
    );
    expect(resume.status).toBe(200);
    expect((await resume.clone().json()).data).toMatchObject({
      nextAction: "RESUME_TEST",
      nextUrl: `/attempts/${attemptId}`
    });
    const resumeToken = cookieValue(resume, "verified_student_session")!;
    expect(await prisma.attempt.count()).toBe(1);
    expect(await prisma.answer.count()).toBe(1);

    const completed = await completeAttempt(
      destinationRequest("POST", `/api/attempts/${attemptId}/complete`, resumeToken),
      attemptContext(attemptId)
    );
    expect(completed.status).toBe(200);
    const result = await readResult(
      destinationRequest("GET", `/api/results/${attemptId}`, resumeToken),
      attemptContext(attemptId)
    );
    expect(result.status).toBe(200);

    const beforeView = await businessCounts();
    const view = await startCommercialAttempt(
      commercialRequest(fixture, randomUUID()),
      commercialContext(fixture)
    );
    expect(view.status).toBe(200);
    expect((await view.clone().json()).data).toMatchObject({
      nextAction: "VIEW_RESULT",
      nextUrl: `/results/${attemptId}`
    });
    expect(await businessCounts()).toEqual(beforeView);
    const eventTypes = (await prisma.eventLog.findMany({ select: { eventType: true } }))
      .map((event) => event.eventType.toLowerCase());
    expect(eventTypes.some((eventType) =>
      eventType.includes("verified") || eventType.includes("session_issuer")
    )).toBe(false);
    expect(await prisma.analyticsEvent.count()).toBe(0);
  });

  it("fails closed for invalid authority, lifecycle, subject, and scope without business writes", async () => {
    const wrongToken = await createCommercialFixture();
    nextCookieState.values.set(orderTokenCookieName(wrongToken.order.publicId), createLookupToken());
    const beforeWrongToken = await businessCounts();
    const denied = await startCommercialAttempt(
      new Request(`${origin}/api/commercial/orders/${wrongToken.order.publicId}/start-attempt`, {
        method: "POST",
        headers: { origin, host: "commercial-order-issuer.test", "Idempotency-Key": randomUUID() }
      }),
      commercialContext(wrongToken)
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("ORDER_TOKEN_REQUIRED");
    expect(await businessCounts()).toEqual(beforeWrongToken);
    expect(await prisma.verifiedStudentSession.count()).toBe(0);

    const unpaid = await createCommercialFixture();
    await prisma.commercialOrder.update({ where: { id: unpaid.order.id }, data: { status: "PENDING", paidAt: null } });
    await expectRejectedWithoutSession(unpaid);

    const missingAccess = await createCommercialFixture();
    await prisma.access.delete({ where: { id: missingAccess.access.id } });
    await expectRejectedWithoutSession(missingAccess);

    const revoked = await createCommercialFixture();
    await prisma.access.update({ where: { id: revoked.access.id }, data: { revokedAt: new Date() } });
    await expectRejectedWithoutSession(revoked);

    const expired = await createCommercialFixture();
    await prisma.access.update({
      where: { id: expired.access.id },
      data: { expiresAt: new Date(Date.now() - 1_000) }
    });
    await expectRejectedWithoutSession(expired);

    const deletedStudent = await createCommercialFixture();
    await prisma.user.update({ where: { id: deletedStudent.user.id }, data: { deletedAt: new Date() } });
    await expectRejectedWithoutSession(deletedStudent);

    const nonStudent = await createCommercialFixture();
    await prisma.user.update({ where: { id: nonStudent.user.id }, data: { role: "ADMIN" } });
    await expectRejectedWithoutSession(nonStudent);

    const mismatchedTest = await createCommercialFixture();
    const otherTest = await prisma.test.create({
      data: {
        title: "Mismatch",
        slug: `mismatch-${randomUUID()}`,
        price: 100,
        durationMinutes: 30,
        status: "PUBLISHED"
      }
    });
    await prisma.commercialOrder.update({
      where: { id: mismatchedTest.order.id },
      data: { testIdSnapshot: otherTest.id }
    });
    await expectRejectedWithoutSession(mismatchedTest);

    const mismatchedProduct = await createCommercialFixture();
    const otherProduct = await prisma.commercialProduct.create({
      data: {
        code: `mismatch-${randomUUID()}`,
        testId: mismatchedProduct.test.id,
        name: "Mismatched product",
        priceMinor: 1000
      }
    });
    await prisma.access.update({
      where: { id: mismatchedProduct.access.id },
      data: { commercialProductId: otherProduct.id }
    });
    await expectRejectedWithoutSession(mismatchedProduct);
  });

  it("preserves off and shadow legacy semantics while enforce remains verified", async () => {
    const fixture = await createCommercialFixture();

    process.env.VERIFIED_COMMERCIAL_SESSION_MODE = "off";
    const off = await startCommercialAttempt(commercialRequest(fixture), commercialContext(fixture));
    expect(off.status).toBe(200);
    expect(cookieValue(off, "verified_student_session")).toBeNull();
    expect(nextCookieState.values.get("student_session")).toBeDefined();
    expect(await prisma.verifiedStudentSession.count()).toBe(0);

    await prisma.attempt.deleteMany();
    await prisma.access.update({ where: { id: fixture.access.id }, data: { attemptsAvailable: 1 } });
    nextCookieState.values.delete("student_session");
    process.env.VERIFIED_COMMERCIAL_SESSION_MODE = "shadow";
    const shadow = await startCommercialAttempt(commercialRequest(fixture), commercialContext(fixture));
    expect(shadow.status).toBe(200);
    expect(cookieValue(shadow, "verified_student_session")).toMatch(/^vs1\.v1\./);
    expect(nextCookieState.values.get("student_session")).toBeDefined();
    expect(await prisma.verifiedStudentSession.count()).toBe(1);

    await prisma.verifiedStudentSession.deleteMany();
    await prisma.attempt.deleteMany();
    await prisma.access.update({ where: { id: fixture.access.id }, data: { attemptsAvailable: 1 } });
    nextCookieState.values.delete("student_session");
    process.env.VERIFIED_COMMERCIAL_SESSION_MODE = "enforce";
    const enforce = await startCommercialAttempt(commercialRequest(fixture), commercialContext(fixture));
    expect(enforce.status).toBe(200);
    expect(cookieValue(enforce, "verified_student_session")).toMatch(/^vs1\.v1\./);
    expect(nextCookieState.values.get("student_session")).toBeUndefined();
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
  });

  it("keeps generic commercial Orders on legacy authority without a verified session", async () => {
    const fixture = await createCommercialFixture({ examMode: "GENERIC" });
    const response = await startCommercialAttempt(
      commercialRequest(fixture),
      commercialContext(fixture)
    );
    expect(response.status).toBe(200);
    expect(cookieValue(response, "verified_student_session")).toBeNull();
    expect(nextCookieState.values.get("student_session")).toBeDefined();
    expect(await prisma.verifiedStudentSession.count()).toBe(0);
    expect((await response.text())).not.toContain("COMMERCIAL_ORDER_CLAIM");
  });

  it("does not expose raw credentials or sensitive claim data in responses or logs", async () => {
    const fixture = await createCommercialFixture();
    const logSpy = vi.spyOn(console, "log");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    const response = await startCommercialAttempt(
      commercialRequest(fixture),
      commercialContext(fixture)
    );
    const rawToken = cookieValue(response, "verified_student_session")!;
    const body = await response.text();
    for (const sensitive of [rawToken, fixture.lookupToken, fixture.user.email, fixture.order.id]) {
      expect(body).not.toContain(sensitive);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(sensitive);
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(sensitive);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(sensitive);
    }
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
