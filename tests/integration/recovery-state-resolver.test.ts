import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnabledRecoveryConfig, RecoveryKeyRing } from "@/server/recovery/config";
import { createRecoveryHttpHandlers } from "@/server/recovery/http-handlers";
import {
  RECOVERY_HTTP_GLOBAL_SOURCE,
  RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
} from "@/server/recovery/http-runtime";
import type { RecoveryMail } from "@/server/recovery/mailer";
import { createRecoveryDomainService } from "@/server/recovery/service";
import { createRecoveryStateResolver } from "@/server/recovery/state-resolver";

const shouldRun = process.env.RUN_ACC01A_STATE_RESOLVER_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();
const writerPrisma = new PrismaClient();
const origin = "http://recovery-state.test";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function authenticQuestions() {
  return Array.from({ length: 40 }, (_, index) => ({
    snapshotQuestionId: `q_${index + 1}`,
    orderIndex: index,
    questionType: index < 18 ? "multi_select_five" : "short_answer_token",
    points: 2,
    correctAnswer: "SECRET_CORRECT",
    acceptedAnswers: ["SECRET_ACCEPTED"],
    explanation: "SECRET_EXPLANATION"
  }));
}

function authenticSnapshot(testId: string) {
  return {
    testId,
    subject: "russian",
    mode: "ce_ct",
    examMode: "rikz_russian_2026",
    durationMinutes: 120,
    maxRawScore: 80,
    questions: authenticQuestions()
  };
}

function ring(byte: number): RecoveryKeyRing {
  return { activeKeyVersion: "v1", keys: new Map([["v1", Buffer.alloc(32, byte)]]) };
}

const config: EnabledRecoveryConfig = {
  enabled: true,
  mailerMode: "test",
  productCode: "acc01a-state-product",
  keyRings: {
    emailFingerprint: ring(71),
    challengeToken: ring(72),
    otpMac: ring(73),
    sessionToken: ring(74)
  }
};

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ACC01A_STATE_RESOLVER_DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).searchParams.get("schema") !== "acc01a_recovery_ci") {
    throw new Error("ACC01A_STATE_RESOLVER_REQUIRES_ACC01A_RECOVERY_CI_SCHEMA");
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

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? "";
  return new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`).exec(header)?.[1] ?? null;
}

function post(path: string, body: unknown, cookie?: string) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      host: "recovery-state.test",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

function get(cookie?: string, query = "") {
  return new Request(`${origin}/api/recovery/state${query}`, {
    method: "GET",
    headers: cookie ? { cookie } : {}
  });
}

describeWithDatabase("ACC-01A recovery state resolver PostgreSQL integration", () => {
  let now: Date;
  let testId: string;
  let productId: string;
  let deliveries: RecoveryMail[];
  let domain: ReturnType<typeof createRecoveryDomainService>;
  let resolver: ReturnType<typeof createRecoveryStateResolver>;
  let handlers: ReturnType<typeof createRecoveryHttpHandlers>;

  function buildHandlers(resolveState = resolver) {
    return createRecoveryHttpHandlers({
      getRuntime: () => ({
        config,
        service: domain,
        resolveState,
        trustedOrigin: origin,
        sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE,
        resolverLimiterInput: RECOVERY_STATE_RESOLVER_GLOBAL_SOURCE
      }),
      clock: () => new Date(now),
      normalizeRequestTiming: async () => {},
      cookieSecure: false
    });
  }

  function buildInterleavingResolver(stage: "PRODUCT_READ" | "ACCESSES_READ") {
    const entered = deferred();
    const release = deferred();
    const transactionFacts: Array<{ isolation: string; readOnly: string }> = [];
    let blocked = false;
    const resolveState = createRecoveryStateResolver({
      client: prisma,
      productCode: config.productCode,
      clock: () => new Date(now),
      snapshotReadHook: async ({ stage: currentStage, transaction }) => {
        if (blocked || currentStage !== stage) return;
        blocked = true;
        const isolation = await transaction.$queryRaw<Array<{ transaction_isolation: string }>>(
          Prisma.sql`SHOW transaction_isolation`
        );
        const readOnly = await transaction.$queryRaw<Array<{ transaction_read_only: string }>>(
          Prisma.sql`SHOW transaction_read_only`
        );
        transactionFacts.push({
          isolation: isolation[0]?.transaction_isolation ?? "",
          readOnly: readOnly[0]?.transaction_read_only ?? ""
        });
        entered.resolve();
        await release.promise;
      }
    });
    return { resolveState, entered, release, transactionFacts };
  }

  async function issueRecoveryCookie(email: string) {
    const challenge = await handlers.requestChallenge(post("/api/recovery/challenges", {
      email,
      productCode: config.productCode,
      intent: "recovery",
      idempotencyKey: randomUUID()
    }));
    expect(challenge.status).toBe(202);
    const challengeToken = cookieValue(challenge, "acc01a_recovery_challenge");
    expect(challengeToken).not.toBeNull();
    const delivery = deliveries.at(-1);
    expect(delivery).toBeDefined();
    const verified = await handlers.verifyChallenge(post("/api/recovery/challenges/verify", {
      code: delivery!.code,
      operationId: randomUUID()
    }, `acc01a_recovery_challenge=${challengeToken}`));
    expect(verified.status).toBe(200);
    const token = cookieValue(verified, "acc01a_recovery");
    expect(token).not.toBeNull();
    return `acc01a_recovery=${token}`;
  }

  async function createPaidAccess(email: string, options: {
    deadline?: Date;
    revoked?: boolean;
    attemptsAvailable?: number;
  } = {}, client: Prisma.TransactionClient | PrismaClient = prisma) {
    const user = await client.user.upsert({
      where: { email },
      update: {},
      create: { email, role: "STUDENT" }
    });
    const order = await client.commercialOrder.create({
      data: {
        commercialProductId: productId,
        testIdSnapshot: testId,
        productNameSnapshot: "ACC-01A product",
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
    const payment = await client.commercialPaymentAttempt.create({
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
    const deadline = options.deadline ?? new Date(now.getTime() + 90 * 86_400_000);
    const access = await client.access.create({
      data: {
        userId: user.id,
        testId,
        source: "COMMERCIAL",
        attemptsTotal: 1,
        attemptsAvailable: options.attemptsAvailable ?? 1,
        expiresAt: deadline,
        revokedAt: options.revoked ? now : null,
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
    status: "STARTED" | "COMPLETED" | "EXPIRED" | "CANCELLED",
    client: Prisma.TransactionClient | PrismaClient = prisma
  ) {
    const terminal = status === "COMPLETED" || status === "EXPIRED";
    const startedAt = new Date(now.getTime() - 7_200_000);
    const finishedAt = terminal
      ? status === "EXPIRED" ? now : new Date(now.getTime() - 60_000)
      : null;
    const attempt = await client.attempt.create({
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
        rawScore: terminal ? 60 : null,
        maxRawScore: terminal ? 80 : null,
        percent: terminal ? new Prisma.Decimal(75) : null,
        testSnapshot: authenticSnapshot(testId)
      }
    });
    await client.access.update({
      where: { id: fixture.access.id },
      data: { attemptsAvailable: 0 }
    });
    return attempt;
  }

  async function businessSnapshot() {
    return {
      users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
      orders: await prisma.commercialOrder.findMany({ orderBy: { id: "asc" } }),
      payments: await prisma.commercialPaymentAttempt.findMany({ orderBy: { id: "asc" } }),
      accesses: await prisma.access.findMany({ orderBy: { id: "asc" } }),
      attempts: await prisma.attempt.findMany({ orderBy: { id: "asc" } }),
      answers: await prisma.answer.findMany({ orderBy: { id: "asc" } }),
      verifiedStudentSessions: await prisma.verifiedStudentSession.findMany({ orderBy: { id: "asc" } })
    };
  }

  beforeAll(() => assertDedicatedTestSchema());

  beforeEach(async () => {
    await cleanDatabase();
    now = new Date("2026-07-14T12:00:00.000Z");
    deliveries = [];
    const test = await prisma.test.create({
      data: {
        title: "ACC-01A state integration",
        slug: `acc01a-state-${randomUUID()}`,
        price: 1000,
        durationMinutes: 120,
        examMode: "RIKZ_RUSSIAN_2026",
        status: "PUBLISHED"
      }
    });
    testId = test.id;
    const product = await prisma.commercialProduct.create({
      data: {
        code: config.productCode,
        testId,
        name: "ACC-01A state product",
        priceMinor: 1000,
        attemptLimit: 1,
        resultRetentionDays: 365
      }
    });
    productId = product.id;
    domain = createRecoveryDomainService({
      client: prisma,
      config,
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
      productCode: config.productCode,
      clock: () => new Date(now)
    });
    handlers = buildHandlers();
  });

  afterAll(async () => {
    if (shouldRun) await cleanDatabase();
    await writerPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it("runs challenge → OTP → recovery cookie → resolver and returns only the closed body", async () => {
    const email = "full-flow@example.test";
    await createPaidAccess(email);
    const response = await handlers.resolveState(get(await issueRecoveryCookie(email)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ state: "access_unstarted", screen: "REC-01", nextAction: "CONTINUE" });
    expect(Object.keys(body).sort()).toEqual(["nextAction", "screen", "state"]);
    expect(JSON.stringify(body)).not.toMatch(/id|score|email|order|payment|timer|answer|question|correct/i);
  });

  it("validates recovery authority before invoking any business resolver lookup", async () => {
    const guardedResolver = vi.fn(resolver);
    handlers = buildHandlers(guardedResolver);
    const missing = await handlers.resolveState(get());
    expect(missing.status).toBe(401);
    expect(guardedResolver).not.toHaveBeenCalled();
    const invalid = await handlers.resolveState(get("acc01a_recovery=malformed"));
    expect(invalid.status).toBe(401);
    expect(guardedResolver).not.toHaveBeenCalled();
  });

  it("resolves open, expired and clean no-Access truth canonically without writes", async () => {
    for (const fixture of [
      { email: "open@example.test", setup: () => createPaidAccess("open@example.test"), state: "access_unstarted" },
      { email: "expired@example.test", setup: () => createPaidAccess("expired@example.test", { deadline: now }), state: "start_window_expired" },
      { email: "none@example.test", setup: async () => {}, state: "no_access" }
    ]) {
      await fixture.setup();
      const cookie = await issueRecoveryCookie(fixture.email);
      const before = await businessSnapshot();
      const response = await handlers.resolveState(get(cookie));
      expect((await response.json()).state).toBe(fixture.state);
      expect(await businessSnapshot()).toEqual(before);
      await cleanDatabase();
      const test = await prisma.test.create({
        data: { id: testId, title: "reset", slug: `reset-${randomUUID()}`, price: 1000, durationMinutes: 120, examMode: "RIKZ_RUSSIAN_2026", status: "PUBLISHED" }
      });
      await prisma.commercialProduct.create({
        data: { id: productId, code: config.productCode, testId: test.id, name: "reset", priceMinor: 1000, attemptLimit: 1, resultRetentionDays: 365 }
      });
    }
  });

  it("resolves an active Attempt without changing timer, snapshot, status or availability", async () => {
    const email = "active@example.test";
    const fixture = await createPaidAccess(email, { deadline: new Date(now.getTime() - 60_000) });
    const attempt = await createAttempt(fixture, "STARTED");
    const before = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    const accessBefore = await prisma.access.findUniqueOrThrow({ where: { id: fixture.access.id } });
    const response = await handlers.resolveState(get(await issueRecoveryCookie(email)));
    expect(await response.json()).toEqual({ state: "attempt_active", screen: "REC-01", nextAction: "CONTINUE" });
    expect(await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } })).toEqual(before);
    expect(await prisma.access.findUniqueOrThrow({ where: { id: fixture.access.id } })).toEqual(accessBefore);
  });

  it.each(["COMPLETED", "EXPIRED"] as const)(
    "reopens a readable %s projection without scoring/completion or Answer mutation",
    async (status) => {
      const email = `${status.toLowerCase()}@example.test`;
      const fixture = await createPaidAccess(email, { deadline: new Date(now.getTime() - 60_000) });
      const attempt = await createAttempt(fixture, status);
      const answer = await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          snapshotQuestionId: "q_1",
          questionSnapshot: { correctAnswer: "SECRET_CORRECT" },
          selectedAnswer: "selected",
          isCorrect: true,
          pointsEarned: 60,
          maxPoints: 80
        }
      });
      const before = {
        attempt: await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } }),
        answer: await prisma.answer.findUniqueOrThrow({ where: { id: answer.id } })
      };
      const response = await handlers.resolveState(get(await issueRecoveryCookie(email)));
      const body = await response.json();
      expect(body.state).toBe("result_available");
      expect(JSON.stringify(body)).not.toMatch(/SECRET|score|answer|correct|accepted|explanation/i);
      expect({
        attempt: await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } }),
        answer: await prisma.answer.findUniqueOrThrow({ where: { id: answer.id } })
      }).toEqual(before);
    }
  );

  it("keeps existing Access, active Attempt and readable Result recoverable while Product is inactive", async () => {
    const email = "inactive-existing-entitlement@example.test";
    const fixture = await createPaidAccess(email);
    const cookie = await issueRecoveryCookie(email);
    await prisma.commercialProduct.update({ where: { id: productId }, data: { isActive: false } });

    expect((await (await handlers.resolveState(get(cookie))).json()).state)
      .toBe("access_unstarted");
    const attempt = await createAttempt(fixture, "STARTED");
    expect((await (await handlers.resolveState(get(cookie))).json()).state)
      .toBe("attempt_active");
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        status: "EXPIRED",
        finishedAt: now,
        durationSeconds: 7_200,
        rawScore: 60,
        maxRawScore: 80,
        percent: new Prisma.Decimal(75)
      }
    });
    expect((await (await handlers.resolveState(get(cookie))).json()).state)
      .toBe("result_available");
  });

  it("requires active published canonical Product/Test configuration before no_access", async () => {
    const cookie = await issueRecoveryCookie("fresh-checkout-policy@example.test");
    const cases = [
      async () => prisma.commercialProduct.update({
        where: { id: productId }, data: { isActive: false }
      }),
      async () => prisma.test.update({ where: { id: testId }, data: { status: "HIDDEN" } }),
      async () => prisma.test.update({ where: { id: testId }, data: { deletedAt: now } }),
      async () => prisma.commercialProduct.update({
        where: { id: productId }, data: { priceMinor: 999 }
      }),
      async () => prisma.commercialProduct.update({
        where: { id: productId }, data: { currency: "USD" }
      })
    ];
    for (const mutate of cases) {
      await mutate();
      expect((await (await handlers.resolveState(get(cookie))).json()).state)
        .toBe("support_required");
      await prisma.commercialProduct.update({
        where: { id: productId },
        data: { isActive: true, priceMinor: 1000, currency: "BYN" }
      });
      await prisma.test.update({
        where: { id: testId }, data: { status: "PUBLISHED", deletedAt: null }
      });
    }
    expect((await (await handlers.resolveState(get(cookie))).json()).state).toBe("no_access");
  });

  it("maps PAID-without-Access, revoked, zero availability and broken linkage to support_required", async () => {
    const cases = [
      async (email: string) => {
        const fixture = await createPaidAccess(email);
        await prisma.access.delete({ where: { id: fixture.access.id } });
      },
      async (email: string) => { await createPaidAccess(email, { revoked: true }); },
      async (email: string) => { await createPaidAccess(email, { attemptsAvailable: 0 }); },
      async (email: string) => {
        const fixture = await createPaidAccess(email);
        const other = await prisma.user.create({ data: { email: `other-${email}`, role: "STUDENT" } });
        await prisma.access.update({ where: { id: fixture.access.id }, data: { userId: other.id } });
      }
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const email = `support-${index}@example.test`;
      await cases[index]!(email);
      expect((await (await handlers.resolveState(get(await issueRecoveryCookie(email)))).json()).state)
        .toBe("support_required");
      await cleanDatabase();
      await prisma.test.create({ data: { id: testId, title: "reset", slug: `support-reset-${index}`, price: 1000, durationMinutes: 120, examMode: "RIKZ_RUSSIAN_2026", status: "PUBLISHED" } });
      await prisma.commercialProduct.create({ data: { id: productId, code: config.productCode, testId, name: "reset", priceMinor: 1000, attemptLimit: 1, resultRetentionDays: 365 } });
    }
  });

  it("detects multiple conflicting Accesses and Attempts without arbitrary first-row selection", async () => {
    const email = "conflict-access@example.test";
    await createPaidAccess(email);
    await createPaidAccess(email);
    expect((await (await handlers.resolveState(get(await issueRecoveryCookie(email)))).json()).state)
      .toBe("support_required");

    await cleanDatabase();
    await prisma.test.create({ data: { id: testId, title: "reset", slug: "attempt-conflict-reset", price: 1000, durationMinutes: 120, examMode: "RIKZ_RUSSIAN_2026", status: "PUBLISHED" } });
    await prisma.commercialProduct.create({ data: { id: productId, code: config.productCode, testId, name: "reset", priceMinor: 1000, attemptLimit: 1, resultRetentionDays: 365 } });
    const secondEmail = "conflict-attempt@example.test";
    const fixture = await createPaidAccess(secondEmail);
    await createAttempt(fixture, "COMPLETED");
    await createAttempt(fixture, "EXPIRED");
    expect((await (await handlers.resolveState(get(await issueRecoveryCookie(secondEmail)))).json()).state)
      .toBe("support_required");
  });

  it("keeps CREATED/PENDING or active PaymentAttempt out of no_access and permits terminal non-paid truth", async () => {
    async function createOrder(email: string, status: "CREATED" | "PENDING" | "FAILED") {
      return prisma.commercialOrder.create({
        data: {
          commercialProductId: productId,
          testIdSnapshot: testId,
          productNameSnapshot: "product",
          priceMinor: 1000,
          emailOriginal: email,
          emailNormalized: email,
          status,
          offerVersion: "v1",
          privacyVersion: "v1",
          refundPolicyVersion: "v1",
          disclaimerVersion: "v1",
          adultBuyerConfirmedAt: now,
          idempotencyKey: randomUUID(),
          lookupTokenHash: randomUUID()
        }
      });
    }
    for (const status of ["CREATED", "PENDING"] as const) {
      const email = `${status.toLowerCase()}-order@example.test`;
      await createOrder(email, status);
      expect((await (await handlers.resolveState(get(await issueRecoveryCookie(email)))).json()).state)
        .toBe("support_required");
    }
    const failedEmail = "failed-order@example.test";
    const failed = await createOrder(failedEmail, "FAILED");
    await prisma.commercialPaymentAttempt.create({
      data: {
        commercialOrderId: failed.id,
        provider: "LOCAL_FAKE",
        merchantReference: randomUUID(),
        status: "FAILED",
        amountMinor: 1000
      }
    });
    expect((await (await handlers.resolveState(get(await issueRecoveryCookie(failedEmail)))).json()).state)
      .toBe("no_access");
  });

  it("returns compatible repeated/concurrent reads and creates no business records", async () => {
    const email = "concurrent@example.test";
    await createPaidAccess(email);
    const cookie = await issueRecoveryCookie(email);
    const before = await businessSnapshot();
    const responses = await Promise.all(Array.from({ length: 8 }, () => handlers.resolveState(get(cookie))));
    expect(await Promise.all(responses.map((response) => response.json())))
      .toEqual(Array.from({ length: 8 }, () => ({
        state: "access_unstarted", screen: "REC-01", nextAction: "CONTINUE"
      })));
    expect(await businessSnapshot()).toEqual(before);
  });

  it("keeps no Access → paid Access interleaving on one read-only snapshot", async () => {
    const email = "interleave-paid-access@example.test";
    const cookie = await issueRecoveryCookie(email);
    const interleaving = buildInterleavingResolver("PRODUCT_READ");
    const firstResponse = buildHandlers(interleaving.resolveState).resolveState(get(cookie));
    await interleaving.entered.promise;
    try {
      await writerPrisma.$transaction(async (transaction) => {
        await createPaidAccess(email, {}, transaction);
      });
    } finally {
      interleaving.release.resolve();
    }

    expect((await (await firstResponse).json()).state).toBe("no_access");
    expect(interleaving.transactionFacts).toEqual([{
      isolation: "repeatable read",
      readOnly: "on"
    }]);
    expect((await (await handlers.resolveState(get(cookie))).json()).state)
      .toBe("access_unstarted");
  });

  it("keeps Access → active Attempt interleaving on one snapshot", async () => {
    const email = "interleave-active-attempt@example.test";
    const fixture = await createPaidAccess(email);
    const cookie = await issueRecoveryCookie(email);
    const interleaving = buildInterleavingResolver("ACCESSES_READ");
    const firstResponse = buildHandlers(interleaving.resolveState).resolveState(get(cookie));
    await interleaving.entered.promise;
    try {
      await writerPrisma.$transaction(async (transaction) => {
        await createAttempt(fixture, "STARTED", transaction);
      });
    } finally {
      interleaving.release.resolve();
    }

    expect((await (await firstResponse).json()).state).toBe("access_unstarted");
    expect((await (await handlers.resolveState(get(cookie))).json()).state)
      .toBe("attempt_active");
  });

  it("keeps active Attempt → terminal Result interleaving on one snapshot", async () => {
    const email = "interleave-terminal-result@example.test";
    const fixture = await createPaidAccess(email);
    const attempt = await createAttempt(fixture, "STARTED");
    const cookie = await issueRecoveryCookie(email);
    const interleaving = buildInterleavingResolver("PRODUCT_READ");
    const firstResponse = buildHandlers(interleaving.resolveState).resolveState(get(cookie));
    await interleaving.entered.promise;
    try {
      await writerPrisma.$transaction(async (transaction) => {
        await transaction.attempt.update({
          where: { id: attempt.id },
          data: {
            status: "EXPIRED",
            finishedAt: now,
            durationSeconds: 7_200,
            rawScore: 60,
            maxRawScore: 80,
            percent: new Prisma.Decimal(75)
          }
        });
      });
    } finally {
      interleaving.release.resolve();
    }

    expect((await (await firstResponse).json()).state).toBe("attempt_active");
    expect((await (await handlers.resolveState(get(cookie))).json()).state)
      .toBe("result_available");
  });

  it("allows only adjacent committed truth across resolver reads", async () => {
    const email = "adjacent@example.test";
    const cookie = await issueRecoveryCookie(email);
    expect((await (await handlers.resolveState(get(cookie))).json()).state).toBe("no_access");
    const fixture = await createPaidAccess(email);
    expect((await (await handlers.resolveState(get(cookie))).json()).state).toBe("access_unstarted");
    await createAttempt(fixture, "STARTED");
    expect((await (await handlers.resolveState(get(cookie))).json()).state).toBe("attempt_active");
  });

  it("does not treat generic records as commercial recovery authority", async () => {
    const email = "generic@example.test";
    const user = await prisma.user.create({ data: { email, role: "STUDENT" } });
    await prisma.access.create({
      data: {
        userId: user.id,
        testId,
        source: "MANUAL",
        attemptsTotal: 1,
        attemptsAvailable: 1,
        expiresAt: new Date(now.getTime() + 86_400_000)
      }
    });
    expect((await (await handlers.resolveState(get(await issueRecoveryCookie(email)))).json()).state)
      .toBe("support_required");
  });

  it("returns 503 instead of no_access on resolver failure and preserves the cookie", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("synthetic read failure"));
    handlers = buildHandlers(failing);
    const cookie = await issueRecoveryCookie("temporary@example.test");
    const response = await handlers.resolveState(get(cookie));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("RESOLUTION_TEMPORARY_ERROR");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps feature-off and query-override paths free of business writes", async () => {
    const before = await businessSnapshot();
    const disabled = createRecoveryHttpHandlers({
      getRuntime: () => ({ config: { enabled: false } })
    });
    expect((await disabled.resolveState(get("acc01a_recovery=ignored"))).status).toBe(404);
    expect((await handlers.resolveState(get("acc01a_recovery=ignored", "?attemptId=override"))).status)
      .toBe(400);
    expect(await businessSnapshot()).toEqual(before);
  });
});
