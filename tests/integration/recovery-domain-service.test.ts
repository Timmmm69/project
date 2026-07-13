import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EnabledRecoveryConfig, RecoveryKeyRing } from "@/server/recovery/config";
import { createEmailFingerprint } from "@/server/recovery/crypto";
import { createTestRecoveryMailbox, type RecoveryMailer } from "@/server/recovery/mailer";
import { createRecoveryRateLimitService } from "@/server/recovery/rate-limit";
import {
  createRecoveryDomainService,
  RECOVERY_OTP_TTL_MS,
  RECOVERY_SESSION_ABSOLUTE_TTL_MS,
  type RequestRecoveryChallengeResult,
  type VerifyRecoveryChallengeResult
} from "@/server/recovery/service";

const shouldRun = process.env.RUN_ACC01A_RECOVERY_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();

function ring(byte: number): RecoveryKeyRing {
  return { activeKeyVersion: "v1", keys: new Map([["v1", Buffer.alloc(32, byte)]]) };
}

const recoveryConfig: EnabledRecoveryConfig = {
  enabled: true,
  mailerMode: "test",
  productCode: "acc01a-recovery-product",
  keyRings: {
    emailFingerprint: ring(31),
    challengeToken: ring(32),
    otpMac: ring(33),
    sessionToken: ring(34)
  }
};

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("ACC01A_RECOVERY_INTEGRATION_DATABASE_URL_REQUIRED");
  }
  if (new URL(databaseUrl).searchParams.get("schema") !== "acc01a_recovery_ci") {
    throw new Error("ACC01A_RECOVERY_INTEGRATION_REQUIRES_ACC01A_RECOVERY_CI_SCHEMA");
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

describeWithDatabase("ACC-01A recovery domain service integration", () => {
  let now: Date;
  let productId: string;
  let testId: string;
  let mailbox: ReturnType<typeof createTestRecoveryMailbox>;
  let service: ReturnType<typeof createRecoveryDomainService>;

  function buildService(options: { mailer?: RecoveryMailer; otp?: string } = {}) {
    return createRecoveryDomainService({
      client: prisma,
      config: recoveryConfig,
      mailer: options.mailer ?? mailbox.mailer,
      clock: () => new Date(now),
      otpGenerator: () => options.otp ?? "908172"
    });
  }

  async function requestChallenge(options: {
    email?: string;
    operationId?: string;
    source?: string;
    productCode?: string;
  } = {}) {
    return service.requestChallenge({
      email: options.email ?? "buyer@example.test",
      productCode: options.productCode ?? recoveryConfig.productCode,
      requestOperationId: options.operationId ?? randomUUID(),
      source: options.source ?? "integration-source"
    });
  }

  function expectCreated(result: RequestRecoveryChallengeResult) {
    expect(result.outcome).toBe("CREATED");
    if (result.outcome !== "CREATED") {
      throw new Error(`expected CREATED, received ${result.outcome}`);
    }
    return result;
  }

  function popCode(result: RequestRecoveryChallengeResult) {
    const created = expectCreated(result);
    const message = mailbox.pop(created.correlationId);
    expect(message).not.toBeNull();
    return message?.code ?? "";
  }

  async function verify(
    request: RequestRecoveryChallengeResult,
    options: { otp?: string; operationId?: string; source?: string } = {}
  ) {
    const created = expectCreated(request);
    return service.verifyChallenge({
      rawChallengeToken: created.rawChallengeToken,
      otp: options.otp ?? "908172",
      verificationOperationId: options.operationId ?? randomUUID(),
      source: options.source ?? "verify-source"
    });
  }

  function expectMatch(result: VerifyRecoveryChallengeResult) {
    expect(result.outcome).toBe("MATCH");
    if (result.outcome !== "MATCH") {
      throw new Error(`expected MATCH, received ${result.outcome}`);
    }
    return result;
  }

  beforeAll(() => {
    assertDedicatedTestSchema();
  });

  beforeEach(async () => {
    await cleanDatabase();
    now = new Date("2026-07-13T12:00:00.000Z");
    mailbox = createTestRecoveryMailbox({
      environment: "test",
      clock: () => new Date(now)
    });
    const test = await prisma.test.create({
      data: {
        title: "ACC-01A recovery integration",
        slug: `acc01a-recovery-${randomUUID()}`,
        price: 1000,
        durationMinutes: 120,
        status: "PUBLISHED"
      }
    });
    testId = test.id;
    const product = await prisma.commercialProduct.create({
      data: {
        code: recoveryConfig.productCode,
        testId,
        name: "ACC-01A recovery product",
        priceMinor: 1000
      }
    });
    productId = product.id;
    service = buildService();
  });

  afterAll(async () => {
    if (shouldRun) {
      await cleanDatabase();
    }
    await prisma.$disconnect();
  });

  it("rejects invalid email before any database mutation or delivery", async () => {
    await expect(requestChallenge({ email: "invalid" }))
      .rejects.toMatchObject({ code: "INVALID_EMAIL" });
    expect(await prisma.recoveryChallenge.count()).toBe(0);
    expect(await prisma.recoveryRateLimitEvent.count()).toBe(0);
    expect(mailbox.size()).toBe(0);
  });

  it("creates one ACTIVE challenge and one fake delivery", async () => {
    const created = expectCreated(await requestChallenge());
    const challenge = await prisma.recoveryChallenge.findUniqueOrThrow({ where: { id: created.challengeId } });
    expect(challenge.status).toBe("ACTIVE");
    expect(challenge.commercialProductId).toBe(productId);
    expect(challenge.testId).toBe(testId);
    expect(mailbox.size()).toBe(1);
  });

  it("never persists the raw OTP", async () => {
    const created = await requestChallenge();
    const code = popCode(created);
    const rows = await prisma.recoveryChallenge.findMany();
    expect(code).toBe("908172");
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(Object.keys(rows[0] ?? {})).not.toContain("otp");
  });

  it("never persists the raw challenge token or its secret", async () => {
    const created = expectCreated(await requestChallenge());
    const persisted = JSON.stringify(await prisma.recoveryChallenge.findMany());
    expect(persisted).not.toContain(created.rawChallengeToken);
    expect(persisted).not.toContain(created.rawChallengeToken.split(".")[2]);
  });

  it("reuses the same request operation without another row or delivery", async () => {
    const operationId = randomUUID();
    const first = await requestChallenge({ operationId });
    expectCreated(first);
    const second = await requestChallenge({ operationId });
    expect(second.outcome).toBe("IDEMPOTENT_REPLAY");
    expect(await prisma.recoveryChallenge.count()).toBe(1);
    expect(mailbox.size()).toBe(1);
  });

  it("rejects resend before the sixty-second cooldown", async () => {
    await requestChallenge();
    const second = await requestChallenge();
    expect(second).toMatchObject({ outcome: "COOLDOWN", retryAfterSeconds: 60 });
    expect(await prisma.recoveryChallenge.count()).toBe(1);
    expect(mailbox.size()).toBe(1);
  });

  it("supersedes the old challenge at the cooldown boundary", async () => {
    const first = expectCreated(await requestChallenge());
    now = new Date(now.getTime() + 60_000);
    const second = expectCreated(await requestChallenge());
    const old = await prisma.recoveryChallenge.findUniqueOrThrow({ where: { id: first.challengeId } });
    expect(old).toMatchObject({ status: "SUPERSEDED", supersededById: second.challengeId });
    expect(await prisma.recoveryChallenge.count({ where: { status: "ACTIVE" } })).toBe(1);
  });

  it("does not verify a superseded challenge with its formerly correct OTP", async () => {
    const first = await requestChallenge();
    popCode(first);
    now = new Date(now.getTime() + 60_000);
    await requestChallenge();
    expect(await verify(first)).toMatchObject({ outcome: "REPLAY" });
    expect(await prisma.verifiedRecoverySession.count()).toBe(0);
  });

  it("increments a wrong OTP atomically", async () => {
    const challenge = await requestChallenge();
    expect(await verify(challenge, { otp: "000000" })).toMatchObject({ outcome: "NO_MATCH" });
    expect((await prisma.recoveryChallenge.findFirstOrThrow()).failedVerifyCount).toBe(1);
    expect(await prisma.recoveryVerificationAttempt.count({ where: { outcomeCode: "NO_MATCH" } })).toBe(1);
  });

  it("locks the challenge on the fifth wrong OTP", async () => {
    const challenge = await requestChallenge();
    const outcomes: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      outcomes.push((await verify(challenge, { otp: "000000" })).outcome);
    }
    expect(outcomes).toEqual(["NO_MATCH", "NO_MATCH", "NO_MATCH", "NO_MATCH", "LOCKED"]);
    expect(await prisma.recoveryChallenge.findFirstOrThrow()).toMatchObject({
      status: "LOCKED",
      failedVerifyCount: 5,
      otpMac: null
    });
  });

  it("rejects the correct OTP at the ten-minute expiry boundary", async () => {
    const challenge = await requestChallenge();
    now = new Date(now.getTime() + RECOVERY_OTP_TTL_MS);
    expect(await verify(challenge)).toMatchObject({ outcome: "EXPIRED" });
    expect(await prisma.recoveryChallenge.findFirstOrThrow()).toMatchObject({ status: "EXPIRED", otpMac: null });
  });

  it("issues exactly one ACTIVE recovery session after the first correct verification", async () => {
    const challenge = await requestChallenge();
    const matched = expectMatch(await verify(challenge));
    expect(matched.expiresAt.getTime() - matched.issuedAt.getTime()).toBe(RECOVERY_SESSION_ABSOLUTE_TTL_MS);
    expect(await prisma.verifiedRecoverySession.count({ where: { status: "ACTIVE" } })).toBe(1);
    expect(await prisma.recoveryVerificationAttempt.count({ where: { outcomeCode: "MATCH" } })).toBe(1);
  });

  it("never persists the raw recovery token or its secret", async () => {
    const matched = expectMatch(await verify(await requestChallenge()));
    const persisted = JSON.stringify(await prisma.verifiedRecoverySession.findMany());
    expect(persisted).not.toContain(matched.rawRecoveryToken);
    expect(persisted).not.toContain(matched.rawRecoveryToken.split(".")[2]);
  });

  it("never issues replacement authority when a consumed OTP is replayed", async () => {
    const challenge = await requestChallenge();
    const first = expectMatch(await verify(challenge));
    const replay = await verify(challenge);
    expect(replay).toMatchObject({ outcome: "REPLAY" });
    expect(await prisma.verifiedRecoverySession.count()).toBe(1);
    expect(await service.validateRecoverySession(first.rawRecoveryToken)).toMatchObject({ status: "RESOLVED" });
  });

  it("serializes concurrent correct verifies to one MATCH and one session", async () => {
    const challenge = await requestChallenge();
    const [left, right] = await Promise.all([verify(challenge), verify(challenge)]);
    expect([left.outcome, right.outcome].sort()).toEqual(["MATCH", "REPLAY"]);
    expect(await prisma.verifiedRecoverySession.count()).toBe(1);
    expect(await prisma.recoveryVerificationAttempt.count({ where: { outcomeCode: "MATCH" } })).toBe(1);
  });

  it("rotates the prior ACTIVE recovery session during a later successful verification", async () => {
    const first = expectMatch(await verify(await requestChallenge()));
    now = new Date(now.getTime() + 60_000);
    const second = expectMatch(await verify(await requestChallenge()));
    const rows = await prisma.verifiedRecoverySession.findMany({ orderBy: { issuedAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "ROTATED", revocationCode: "ROTATED" });
    expect(rows[1]).toMatchObject({ status: "ACTIVE", rotatedFromId: rows[0].id });
    expect(await service.validateRecoverySession(first.rawRecoveryToken)).toEqual({ status: "REVOKED" });
    expect(await service.validateRecoverySession(second.rawRecoveryToken)).toMatchObject({ status: "RESOLVED" });
  });

  it("expires a recovery session at exactly thirty minutes", async () => {
    const matched = expectMatch(await verify(await requestChallenge()));
    now = new Date(matched.expiresAt);
    expect(await service.validateRecoverySession(matched.rawRecoveryToken)).toEqual({ status: "EXPIRED" });
    expect(await prisma.verifiedRecoverySession.findFirstOrThrow()).toMatchObject({
      status: "EXPIRED",
      revocationCode: "EXPIRED"
    });
  });

  it("does not slide expiry or mutate the session during validation", async () => {
    const matched = expectMatch(await verify(await requestChallenge()));
    const before = await prisma.verifiedRecoverySession.findFirstOrThrow();
    now = new Date(now.getTime() + 15 * 60_000);
    expect(await service.validateRecoverySession(matched.rawRecoveryToken)).toMatchObject({ status: "RESOLVED" });
    const after = await prisma.verifiedRecoverySession.findFirstOrThrow();
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.lastUsedAt).toBeNull();
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("invalidates a recovery session idempotently", async () => {
    const matched = expectMatch(await verify(await requestChallenge()));
    expect(await service.invalidateRecoverySession(matched.rawRecoveryToken)).toEqual({ status: "REVOKED" });
    expect(await service.invalidateRecoverySession(matched.rawRecoveryToken)).toEqual({ status: "ALREADY_TERMINAL" });
    expect(await service.validateRecoverySession(matched.rawRecoveryToken)).toEqual({ status: "REVOKED" });
  });

  it("enforces email limits at 3/15m and 10/24h", async () => {
    const limiter = createRecoveryRateLimitService({
      client: prisma,
      fingerprintKeyRing: recoveryConfig.keyRings.emailFingerprint,
      clock: () => new Date(now)
    });
    const fingerprint = createEmailFingerprint("limit@example.test", recoveryConfig.keyRings.emailFingerprint);
    for (let index = 0; index < 3; index += 1) {
      expect(await limiter.consumeEmailRequest(fingerprint)).toEqual({ allowed: true });
    }
    expect(await limiter.consumeEmailRequest(fingerprint)).toMatchObject({
      allowed: false,
      safeCode: "EMAIL_REQUEST_LIMIT_15M"
    });
    for (let window = 0; window < 7; window += 1) {
      now = new Date(now.getTime() + 15 * 60_000);
      expect(await limiter.consumeEmailRequest(fingerprint)).toEqual({ allowed: true });
    }
    now = new Date(now.getTime() + 15 * 60_000);
    expect(await limiter.consumeEmailRequest(fingerprint)).toMatchObject({
      allowed: false,
      safeCode: "EMAIL_REQUEST_LIMIT_24H"
    });
  });

  it("enforces source request limits at 20/15m and 100/24h without raw source persistence", async () => {
    const limiter = createRecoveryRateLimitService({
      client: prisma,
      fingerprintKeyRing: recoveryConfig.keyRings.emailFingerprint,
      clock: () => new Date(now)
    });
    const rawSource = "203.0.113.11";
    for (let index = 0; index < 20; index += 1) {
      expect(await limiter.consumeSourceRequest(rawSource)).toEqual({ allowed: true });
    }
    expect(await limiter.consumeSourceRequest(rawSource)).toMatchObject({
      allowed: false,
      safeCode: "SOURCE_REQUEST_LIMIT_15M"
    });
    for (let window = 0; window < 4; window += 1) {
      now = new Date(now.getTime() + 15 * 60_000);
      for (let index = 0; index < 20; index += 1) {
        expect(await limiter.consumeSourceRequest(rawSource)).toEqual({ allowed: true });
      }
    }
    now = new Date(now.getTime() + 15 * 60_000);
    expect(await limiter.consumeSourceRequest(rawSource)).toMatchObject({
      allowed: false,
      safeCode: "SOURCE_REQUEST_LIMIT_24H"
    });
    expect(JSON.stringify(await prisma.recoveryRateLimitEvent.findMany())).not.toContain(rawSource);
  });

  it("enforces twenty failed verifies per source per hour", async () => {
    const limiter = createRecoveryRateLimitService({
      client: prisma,
      fingerprintKeyRing: recoveryConfig.keyRings.emailFingerprint,
      clock: () => new Date(now)
    });
    const rawSource = "failed-verify-source";
    for (let index = 0; index < 20; index += 1) {
      await prisma.$transaction(async (tx) => {
        const permit = await limiter.checkFailedVerifySource(rawSource, tx);
        expect(permit.allowed).toBe(true);
        if (permit.allowed) {
          await limiter.recordFailedVerifySource(permit.keyDigest, tx);
        }
      });
    }
    expect(await limiter.checkFailedVerifySource(rawSource)).toMatchObject({
      allowed: false,
      safeCode: "SOURCE_VERIFY_FAILURE_LIMIT_1H"
    });
    expect(JSON.stringify(await prisma.recoveryRateLimitEvent.findMany())).not.toContain(rawSource);
  });

  it("fails closed when the caller substitutes another product code", async () => {
    await expect(requestChallenge({ productCode: "other-product" }))
      .rejects.toMatchObject({ code: "PRODUCT_SCOPE_MISMATCH" });
    expect(await prisma.recoveryChallenge.count()).toBe(0);
  });

  it("fails session validation closed after Product/Test linkage corruption", async () => {
    const matched = expectMatch(await verify(await requestChallenge()));
    const otherTest = await prisma.test.create({
      data: {
        title: "Other test",
        slug: `other-${randomUUID()}`,
        price: 0,
        durationMinutes: 30
      }
    });
    await prisma.recoveryChallenge.update({
      where: { id: (await prisma.recoveryChallenge.findFirstOrThrow()).id },
      data: { testId: otherTest.id }
    });
    expect(await service.validateRecoverySession(matched.rawRecoveryToken)).toEqual({ status: "SCOPE_MISMATCH" });
  });

  it("creates no User for a valid recovery request or verification", async () => {
    await verify(await requestChallenge());
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates no Order, PaymentAttempt, Access, Attempt or Answer", async () => {
    const before = {
      orders: await prisma.commercialOrder.count(),
      paymentAttempts: await prisma.commercialPaymentAttempt.count(),
      accesses: await prisma.access.count(),
      attempts: await prisma.attempt.count(),
      answers: await prisma.answer.count()
    };
    await verify(await requestChallenge());
    expect({
      orders: await prisma.commercialOrder.count(),
      paymentAttempts: await prisma.commercialPaymentAttempt.count(),
      accesses: await prisma.access.count(),
      attempts: await prisma.attempt.count(),
      answers: await prisma.answer.count()
    }).toEqual(before);
  });

  it("does not mutate generic or verified-student-session rows", async () => {
    const user = await prisma.user.create({ data: { email: "generic@example.test", role: "STUDENT" } });
    const access = await prisma.access.create({
      data: {
        userId: user.id,
        testId,
        source: "COMMERCIAL",
        attemptsTotal: 1,
        attemptsAvailable: 1,
        expiresAt: new Date(now.getTime() + 86_400_000),
        commercialProductId: productId
      }
    });
    const verified = await prisma.verifiedStudentSession.create({
      data: {
        tokenDigest: randomBytes(32).toString("hex"),
        tokenKeyVersion: "v1",
        userId: user.id,
        commercialProductId: productId,
        testId,
        accessId: access.id,
        source: "COMMERCIAL_ORDER_CLAIM",
        sourceReferenceId: randomUUID(),
        issuanceOperationId: randomUUID(),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
        securityCorrelationId: randomUUID()
      }
    });
    const before = await prisma.verifiedStudentSession.findUniqueOrThrow({ where: { id: verified.id } });
    await verify(await requestChallenge());
    expect(await prisma.verifiedStudentSession.findUniqueOrThrow({ where: { id: verified.id } })).toEqual(before);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.access.count()).toBe(1);
  });

  it("stores restricted security events without prohibited fields", async () => {
    await verify(await requestChallenge());
    const events = await prisma.recoverySecurityEvent.findMany();
    expect(events.length).toBeGreaterThan(0);
    const keys = new Set(events.flatMap((event) => Object.keys(event)));
    for (const forbidden of [
      "email", "emailNormalized", "emailFingerprint", "ip", "source", "userAgent",
      "token", "digest", "commercialProductId", "testId", "userId", "accessId", "attemptId", "resultId"
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("keeps the test mailbox entirely outside PostgreSQL", async () => {
    const created = await requestChallenge();
    const code = popCode(created);
    const persisted = JSON.stringify({
      challenges: await prisma.recoveryChallenge.findMany(),
      attempts: await prisma.recoveryVerificationAttempt.findMany(),
      sessions: await prisma.verifiedRecoverySession.findMany(),
      limits: await prisma.recoveryRateLimitEvent.findMany(),
      events: await prisma.recoverySecurityEvent.findMany()
    });
    expect(persisted).not.toContain(code);
    expect(mailbox.size()).toBe(0);
  });

  it("composes verification and invalidation inside caller-owned Prisma transactions", async () => {
    const challenge = expectCreated(await requestChallenge());
    const matched = await prisma.$transaction((tx) => service.verifyChallenge({
      rawChallengeToken: challenge.rawChallengeToken,
      otp: "908172",
      verificationOperationId: randomUUID(),
      source: "caller-owned-transaction"
    }, tx));
    const session = expectMatch(matched);
    expect(await prisma.$transaction((tx) => (
      service.invalidateRecoverySession(session.rawRecoveryToken, "USER_INVALIDATED", tx)
    ))).toEqual({ status: "REVOKED" });
  });

  it("enforces the partial unique ACTIVE challenge index under concurrency", async () => {
    const fingerprint = "a".repeat(64);
    const create = () => prisma.recoveryChallenge.create({
      data: {
        commercialProductId: productId,
        testId,
        emailNormalized: "index@example.test",
        emailFingerprint: fingerprint,
        challengeTokenDigest: randomBytes(32).toString("hex"),
        challengeKeyVersion: "v1",
        otpMac: randomBytes(32).toString("hex"),
        otpKeyVersion: "v1",
        requestOperationId: randomUUID(),
        expiresAt: new Date(now.getTime() + 600_000),
        resendAvailableAt: new Date(now.getTime() + 60_000)
      }
    });
    const results = await Promise.allSettled([create(), create()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.recoveryChallenge.count({ where: { status: "ACTIVE", emailFingerprint: fingerprint } }))
      .toBe(1);
  });

  it("enforces the partial unique ACTIVE recovery-session index under concurrency", async () => {
    const fingerprint = "b".repeat(64);
    async function terminalChallenge() {
      return prisma.recoveryChallenge.create({
        data: {
          commercialProductId: productId,
          testId,
          emailNormalized: "session-index@example.test",
          emailFingerprint: fingerprint,
          challengeTokenDigest: randomBytes(32).toString("hex"),
          challengeKeyVersion: "v1",
          otpMac: null,
          otpKeyVersion: "v1",
          status: "VERIFIED",
          requestOperationId: randomUUID(),
          expiresAt: new Date(now.getTime() + 600_000),
          resendAvailableAt: new Date(now.getTime() + 60_000),
          verifiedAt: now,
          terminalAt: now
        }
      });
    }
    const [left, right] = await Promise.all([terminalChallenge(), terminalChallenge()]);
    const create = (challengeId: string) => prisma.verifiedRecoverySession.create({
      data: {
        challengeId,
        tokenDigest: randomBytes(32).toString("hex"),
        tokenKeyVersion: "v1",
        emailNormalized: "session-index@example.test",
        emailFingerprint: fingerprint,
        commercialProductId: productId,
        testId,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 1_800_000)
      }
    });
    const results = await Promise.allSettled([create(left.id), create(right.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("serializes concurrent resend to one replacement ACTIVE challenge", async () => {
    await requestChallenge();
    now = new Date(now.getTime() + 60_000);
    const results = await Promise.all([requestChallenge(), requestChallenge()]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["COOLDOWN", "CREATED"]);
    expect(await prisma.recoveryChallenge.count({ where: { status: "ACTIVE" } })).toBe(1);
  });

  it("records safe mailer failure without a network provider or business write", async () => {
    const failedMailer: RecoveryMailer = {
      async sendVerificationCode() {
        return { status: "failed", safeCode: "SYNTHETIC_FAILURE" };
      }
    };
    service = buildService({ mailer: failedMailer });
    const result = expectCreated(await requestChallenge());
    expect(result.delivery).toEqual({ status: "failed", safeCode: "SYNTHETIC_FAILURE" });
    expect(await prisma.recoverySecurityEvent.count({ where: { reasonCode: "MAILER_FAILED" } })).toBe(1);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.access.count()).toBe(0);
  });

  it("cleanup removes only eligible recovery records and leaves business scope intact", async () => {
    const matched = expectMatch(await verify(await requestChallenge()));
    const oldChallengeId = (await prisma.recoveryChallenge.findFirstOrThrow()).id;
    const oldSecurityEvent = await prisma.recoverySecurityEvent.create({
      data: {
        correlationId: randomUUID(),
        eventCode: "CHALLENGE_REQUESTED",
        reasonCode: "REQUEST_CREATED",
        occurredAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)
      }
    });
    now = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const recent = expectCreated(await requestChallenge({ email: "recent@example.test", source: "recent-source" }));
    const result = await service.cleanup();
    expect(result.deletedRecoverySessions).toBeGreaterThanOrEqual(1);
    expect(result.deletedChallenges).toBeGreaterThanOrEqual(1);
    expect(result.deletedRateLimitEvents).toBeGreaterThanOrEqual(1);
    expect(result.deletedSecurityEvents).toBeGreaterThanOrEqual(1);
    expect(await prisma.verifiedRecoverySession.findUnique({ where: { id: matched.recoverySessionId } })).toBeNull();
    expect(await prisma.recoveryChallenge.findUnique({ where: { id: oldChallengeId } })).toBeNull();
    expect(await prisma.recoveryChallenge.findUnique({ where: { id: recent.challengeId } })).not.toBeNull();
    expect(await prisma.recoverySecurityEvent.findUnique({ where: { id: oldSecurityEvent.id } })).toBeNull();
    expect(await prisma.commercialProduct.count()).toBe(1);
    expect(await prisma.test.count()).toBe(1);
  });
});
