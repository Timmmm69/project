import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readAttempt } from "@/app/api/attempts/[attemptId]/route";
import { POST as saveAnswer } from "@/app/api/attempts/[attemptId]/answers/route";
import { POST as completeAttempt } from "@/app/api/attempts/[attemptId]/complete/route";
import { POST as expireAttempt } from "@/app/api/attempts/[attemptId]/expire/route";
import { POST as startAttempt } from "@/app/api/attempts/start/route";
import { POST as claimCommercialAccess } from "@/app/api/commercial/orders/[publicId]/claim-access/route";
import { GET as readResult } from "@/app/api/results/[attemptId]/route";
import { orderTokenCookieName } from "@/lib/commercial/commercial-service";
import { createLookupToken, hashLookupToken } from "@/lib/commercial/security";
import { serializeResult } from "@/lib/scoring/result-serialize";
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

const shouldRun = process.env.RUN_PROD03_PRIMARY_RESULT_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();
const origin = "http://prod03-primary-result.test";
const verifiedKey = Buffer.alloc(32, 103);
const verifiedConfig: VerifiedStudentSessionConfig = {
  mode: "enforce",
  activeKeyVersion: "v1",
  keys: new Map([["v1", verifiedKey]])
};

type Fixture = Awaited<ReturnType<typeof createCommercialFixture>>;

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("PROD03_PRIMARY_RESULT_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "prod03_primary_result_ci") {
    throw new Error("PROD03_PRIMARY_RESULT_REQUIRES_DEDICATED_SCHEMA");
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
  await prisma.scoringScale.deleteMany();
  await prisma.scoringScheme.deleteMany();
  await prisma.user.deleteMany();
}

function authenticQuestions() {
  return [
    ...Array.from({ length: 18 }, (_, index) => ({
      questionText: `Part A ${index + 1}`,
      questionType: "MULTI_SELECT_FIVE" as const,
      optionA: "A",
      optionB: "B",
      optionC: "C",
      optionD: "D",
      optionE: "E",
      correctAnswer: "A,C",
      explanation: `private Part A explanation ${index + 1}`,
      topic: "Part A integration",
      points: 2,
      officialPart: "A" as const,
      officialNumber: index + 1,
      orderIndex: index + 1
    })),
    ...Array.from({ length: 22 }, (_, index) => ({
      questionText: `Part B ${index + 1}`,
      questionType: "SHORT_ANSWER_TOKEN" as const,
      correctAnswer: `token${index + 1}`,
      acceptedAnswers: [`token${index + 1}`],
      explanation: `private Part B explanation ${index + 1}`,
      topic: "Part B integration",
      points: 2,
      officialPart: "B" as const,
      officialNumber: index + 1,
      responseSubtype: "ALNUM" as const,
      orderIndex: index + 19
    }))
  ];
}

async function createCommercialFixture(email = `prod03-${randomUUID()}@example.test`) {
  const scoringScheme = await prisma.scoringScheme.create({
    data: {
      name: `PROD-03 RIKZ 2026 ${randomUUID()}`,
      subject: "RUSSIAN",
      examType: "ce_ct",
      year: 2026,
      maxRawScore: 80,
      maxScaledScore: 100,
      scales: {
        create: [
          { rawScore: 0, scaledScore: 0 },
          { rawScore: 80, scaledScore: 100 }
        ]
      }
    }
  });
  const test = await prisma.test.create({
    data: {
      title: "PROD-03 authentic result",
      slug: `prod03-${randomUUID()}`,
      price: 1000,
      durationMinutes: 120,
      mode: "CE_CT",
      examMode: "RIKZ_RUSSIAN_2026",
      subjectCode: "russian",
      officialYear: 2026,
      status: "PUBLISHED",
      questionsCount: 40,
      maxRawScore: 80,
      scoringSchemeId: scoringScheme.id,
      showCorrectAnswers: false,
      questions: { create: authenticQuestions() }
    }
  });
  const product = await prisma.commercialProduct.create({
    data: {
      code: `prod03-${randomUUID()}`,
      testId: test.id,
      name: "PROD-03 commercial product",
      priceMinor: 1000,
      attemptLimit: 1,
      startWindowDays: 90,
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
      offerVersion: "prod03-v1",
      privacyVersion: "prod03-v1",
      refundPolicyVersion: "prod03-v1",
      disclaimerVersion: "prod03-v1",
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
  return { test, product, user, order, payment, access, lookupToken };
}

function commercialRequest(fixture: Fixture) {
  nextCookieState.values.set(orderTokenCookieName(fixture.order.publicId), fixture.lookupToken);
  return new Request(`${origin}/api/commercial/orders/${fixture.order.publicId}/claim-access`, {
    method: "POST",
    headers: {
      origin,
      host: "prod03-primary-result.test",
      "Idempotency-Key": randomUUID()
    }
  });
}

function destinationRequest(method: "GET" | "POST", path: string, rawToken?: string, body?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      host: "prod03-primary-result.test",
      ...(rawToken ? { cookie: `verified_student_session=${rawToken}` } : {}),
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

async function startFixture(fixture: Fixture) {
  const claim = await claimCommercialAccess(commercialRequest(fixture), commercialContext(fixture));
  expect(claim.status).toBe(200);
  const rawToken = cookieValue(claim, "verified_student_session");
  expect(rawToken).toMatch(/^vs1\.v1\./);
  expect((await claim.clone().json()).data).toMatchObject({
    nextAction: "OPEN_PRE",
    nextUrl: `/tests/${fixture.test.slug}`
  });
  expect(await prisma.attempt.count()).toBe(0);
  expect((await prisma.access.findUniqueOrThrow({ where: { id: fixture.access.id } })).attemptsAvailable).toBe(1);
  expect(await prisma.eventLog.count({ where: { eventType: "attempt_started" } })).toBe(0);

  const response = await startAttempt(destinationRequest("POST", "/api/attempts/start", rawToken!, {
    testId: fixture.test.id
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  return { attemptId: body.data.attempt.attemptId as string, rawToken: rawToken! };
}

async function resultReadCounts() {
  return {
    attempts: await prisma.attempt.count(),
    answers: await prisma.answer.count(),
    eventLogs: await prisma.eventLog.count(),
    analytics: await prisma.analyticsEvent.count()
  };
}

function expectPrimaryOnlyResult(result: Record<string, unknown>) {
  expect(result).toMatchObject({
    status: "completed",
    exam_mode: "rikz_russian_2026",
    raw_score: 80,
    max_raw_score: 80
  });
  expect("scaled_score" in result).toBe(false);
  expect("max_scaled_score" in result).toBe(false);
  expect("scaled_score_note" in result).toBe(false);
}

describeWithDatabase("PROD-03 primary-only authentic Result PostgreSQL integration", () => {
  const previousEnvironment = new Map<string, string | undefined>();

  beforeAll(() => {
    assertDedicatedTestSchema();
    const values: Record<string, string> = {
      VERIFIED_COMMERCIAL_SESSION_MODE: "enforce",
      VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v1",
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${verifiedKey.toString("base64url")}`,
      SESSION_SECRET: "prod03_primary_result_session_secret_123456"
    };
    for (const [name, value] of Object.entries(values)) {
      previousEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }
  });

  beforeEach(async () => {
    await cleanDatabase();
    nextCookieState.values.clear();
  });

  afterAll(async () => {
    if (shouldRun) await cleanDatabase();
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await prisma.$disconnect();
  });

  it("keeps stored 100 internal while public completion, recovery and reopen stay primary-only", async () => {
    const fixture = await createCommercialFixture();
    const started = await startFixture(fixture);
    const active = await readAttempt(
      destinationRequest("GET", `/api/attempts/${started.attemptId}`, started.rawToken),
      attemptContext(started.attemptId)
    );
    expect(active.status).toBe(200);
    const questions = (await active.json()).data.attempt.questions as Array<{
      snapshotQuestionId: string;
      questionType: "multi_select_five" | "short_answer_token";
      officialNumber: number;
    }>;
    expect(questions).toHaveLength(40);

    for (const question of questions) {
      const selectedAnswer = question.questionType === "multi_select_five"
        ? "A,C"
        : `token${question.officialNumber}`;
      const saved = await saveAnswer(
        destinationRequest("POST", `/api/attempts/${started.attemptId}/answers`, started.rawToken, {
          snapshotQuestionId: question.snapshotQuestionId,
          selectedAnswer
        }),
        attemptContext(started.attemptId)
      );
      expect(saved.status).toBe(200);
    }

    const completed = await completeAttempt(
      destinationRequest("POST", `/api/attempts/${started.attemptId}/complete`, started.rawToken),
      attemptContext(started.attemptId)
    );
    expect(completed.status).toBe(200);
    const completionText = await completed.clone().text();
    expect(completionText).not.toContain("scaled_score");
    expect(completionText).not.toContain("max_scaled_score");
    expect(completionText).not.toContain("scaled_score_note");

    const storedBeforeGet = await prisma.attempt.findUniqueOrThrow({
      where: { id: started.attemptId },
      include: {
        test: { select: { title: true, slug: true, mode: true, showCorrectAnswers: true } },
        answers: { orderBy: { createdAt: "asc" } }
      }
    });
    expect(storedBeforeGet).toMatchObject({ rawScore: 80, maxRawScore: 80, scaledScore: 100, maxScaledScore: 100 });
    const adminResult = serializeResult(storedBeforeGet, { audience: "admin" });
    expect(adminResult.scaled_score).toBe(100);
    expect(adminResult.max_scaled_score).toBe(100);
    expect(adminResult.scaled_score_note).toContain("таблице соответствия");

    const beforeRead = await resultReadCounts();
    const response = await readResult(
      destinationRequest("GET", `/api/results/${started.attemptId}`, started.rawToken),
      attemptContext(started.attemptId)
    );
    expect(response.status).toBe(200);
    const responseText = await response.clone().text();
    const result = (await response.json()).data.result as Record<string, unknown>;
    expectPrimaryOnlyResult(result);
    for (const key of ["scaled_score", "max_scaled_score", "scaled_score_note"]) {
      expect(responseText).not.toContain(`"${key}"`);
    }
    expect(responseText.toLowerCase()).not.toContain("lookup");
    expect(responseText.toLowerCase()).not.toContain("таблиц");
    const details = result.answer_details as Array<Record<string, unknown>>;
    expect(details).toHaveLength(40);
    expect(details.filter((detail) => detail.official_part === "A")).toHaveLength(18);
    expect(details.filter((detail) => detail.official_part === "B")).toHaveLength(22);
    for (const detail of details) {
      expect(detail.points_earned).toBe(2);
      expect(detail.max_points).toBe(2);
      expect(detail.correct_answer).toBeNull();
      expect(detail.accepted_answers).toBeNull();
      expect(detail.explanation).toBeNull();
    }

    const reopened = await readResult(
      destinationRequest("GET", `/api/results/${started.attemptId}`, started.rawToken),
      attemptContext(started.attemptId)
    );
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).data.result).toEqual(result);
    expect(await resultReadCounts()).toEqual(beforeRead);
    const storedAfterGet = await prisma.attempt.findUniqueOrThrow({ where: { id: started.attemptId } });
    expect(storedAfterGet.updatedAt).toEqual(storedBeforeGet.updatedAt);
    expect(storedAfterGet.testSnapshot).toEqual(storedBeforeGet.testSnapshot);
    expect(storedAfterGet.scoringSchemeSnapshot).toEqual(storedBeforeGet.scoringSchemeSnapshot);
    expect(storedAfterGet).toMatchObject({ rawScore: 80, maxRawScore: 80, scaledScore: 100, maxScaledScore: 100 });

    const verifiedSessions = createVerifiedStudentSessionService({ client: prisma, config: verifiedConfig });
    const recoverySessionId = randomUUID();
    const recoveryOperationId = randomUUID();
    const recoverySession = await verifiedSessions.issue({
      userId: fixture.user.id,
      commercialProductId: fixture.product.id,
      testId: fixture.test.id,
      accessId: fixture.access.id,
      source: "EMAIL_OTP_RECOVERY",
      sourceReferenceId: recoverySessionId,
      issuanceOperationId: recoveryOperationId
    });
    const recoveryNow = new Date();
    const fingerprint = randomUUID().replaceAll("-", "").repeat(2);
    const challenge = await prisma.recoveryChallenge.create({
      data: {
        commercialProductId: fixture.product.id,
        testId: fixture.test.id,
        emailNormalized: fixture.user.email,
        emailFingerprint: fingerprint,
        challengeTokenDigest: randomUUID().replaceAll("-", "").repeat(2),
        challengeKeyVersion: "v1",
        otpKeyVersion: "v1",
        status: "VERIFIED",
        requestOperationId: randomUUID(),
        expiresAt: new Date(recoveryNow.getTime() + 10 * 60 * 1000),
        resendAvailableAt: recoveryNow,
        verifiedAt: recoveryNow,
        terminalAt: recoveryNow
      }
    });
    await prisma.verifiedRecoverySession.create({
      data: {
        id: recoverySessionId,
        challengeId: challenge.id,
        tokenDigest: randomUUID().replaceAll("-", "").repeat(2),
        tokenKeyVersion: "v1",
        emailNormalized: fixture.user.email,
        emailFingerprint: fingerprint,
        commercialProductId: fixture.product.id,
        testId: fixture.test.id,
        status: "REVOKED",
        issuedAt: recoveryNow,
        expiresAt: new Date(recoveryNow.getTime() + 10 * 60 * 1000),
        revokedAt: recoveryNow,
        revocationCode: "CONTINUED",
        continuationOperationId: recoveryOperationId,
        continuationNextAction: "OPEN_RESULT",
        continuationNextUrl: `/results/${started.attemptId}`,
        continuationVerifiedStudentSessionId: recoverySession.sessionId,
        continuedAt: recoveryNow
      }
    });
    const recoveryRead = await readResult(
      destinationRequest("GET", `/api/results/${started.attemptId}`, recoverySession.rawToken),
      attemptContext(started.attemptId)
    );
    expect(recoveryRead.status).toBe(200);
    expectPrimaryOnlyResult((await recoveryRead.json()).data.result);

    const foreign = await createCommercialFixture();
    const foreignSession = await verifiedSessions.issue({
      userId: foreign.user.id,
      commercialProductId: foreign.product.id,
      testId: foreign.test.id,
      accessId: foreign.access.id,
      source: "COMMERCIAL_ORDER_CLAIM",
      sourceReferenceId: foreign.order.id,
      issuanceOperationId: randomUUID()
    });
    const denied = await readResult(
      destinationRequest("GET", `/api/results/${started.attemptId}`, foreignSession.rawToken),
      attemptContext(started.attemptId)
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("VERIFIED_SCOPE_NOT_ALLOWED");

    nextCookieState.values.set("student_session", "legacy-authentic-authority-is-not-accepted");
    const legacyDenied = await readResult(
      destinationRequest("GET", `/api/results/${started.attemptId}`),
      attemptContext(started.attemptId)
    );
    expect(legacyDenied.status).toBe(401);
    expect((await legacyDenied.json()).error.code).toBe("VERIFIED_SESSION_REQUIRED");

    const genericSnapshot = {
      ...(storedBeforeGet.testSnapshot as Prisma.JsonObject),
      examMode: "generic"
    } as Prisma.JsonObject;
    const genericResult = serializeResult({ ...storedBeforeGet, testSnapshot: genericSnapshot });
    expect(genericResult.scaled_score).toBe(100);
    expect(genericResult.max_scaled_score).toBe(100);
    expect("scaled_score_note" in genericResult).toBe(true);
  });

  it("keeps expiry response primary-only", async () => {
    const fixture = await createCommercialFixture();
    const started = await startFixture(fixture);
    await prisma.attempt.update({
      where: { id: started.attemptId },
      data: { startedAt: new Date(Date.now() - 121 * 60 * 1000) }
    });

    const expired = await expireAttempt(
      destinationRequest("POST", `/api/attempts/${started.attemptId}/expire`, started.rawToken),
      attemptContext(started.attemptId)
    );
    expect(expired.status).toBe(200);
    const text = await expired.text();
    expect(text).not.toContain("scaled_score");
    expect(text).not.toContain("max_scaled_score");
    expect(text).not.toContain("scaled_score_note");
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: started.attemptId } })).status).toBe("EXPIRED");
  });
});
