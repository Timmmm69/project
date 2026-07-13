import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import {
  createVerifiedStudentSessionService,
  VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS,
  type IssueVerifiedStudentSessionInput,
  VerifiedStudentSessionServiceError
} from "@/server/auth/verified-student-session/service";
import { createVerifiedStudentSessionToken } from "@/server/auth/verified-student-session/token";

const shouldRun = process.env.RUN_ACC01A_INTEGRATION === "true";
const describeWithDatabase = shouldRun ? describe.sequential : describe.skip;
const prisma = new PrismaClient();
const keyV1 = Buffer.alloc(32, 11);
const keyV2 = Buffer.alloc(32, 22);
const keys = new Map([
  ["v1", keyV1],
  ["v2", keyV2]
]);

function config(activeKeyVersion = "v1"): VerifiedStudentSessionConfig {
  return { mode: "off", activeKeyVersion, keys };
}

function assertDedicatedTestSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("ACC01A_INTEGRATION_DATABASE_URL_REQUIRED");
  }
  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema?.startsWith("acc01a_")) {
    throw new Error("ACC01A_INTEGRATION_REQUIRES_DEDICATED_SCHEMA");
  }
}

async function cleanDatabase() {
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

describeWithDatabase("verified student session service integration", () => {
  let now: Date;
  let service: ReturnType<typeof createVerifiedStudentSessionService>;
  let issueInput: IssueVerifiedStudentSessionInput;

  beforeAll(() => {
    assertDedicatedTestSchema();
  });

  beforeEach(async () => {
    await cleanDatabase();
    now = new Date("2026-07-13T12:00:00.000Z");
    service = createVerifiedStudentSessionService({
      client: prisma,
      config: config(),
      clock: () => new Date(now)
    });

    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, role: "STUDENT" }
    });
    const test = await prisma.test.create({
      data: {
        title: "ACC-01A integration test",
        slug: `acc01a-${randomUUID()}`,
        price: 1000,
        durationMinutes: 120,
        status: "PUBLISHED"
      }
    });
    const product = await prisma.commercialProduct.create({
      data: {
        code: `acc01a-${randomUUID()}`,
        testId: test.id,
        name: "ACC-01A product",
        priceMinor: 1000
      }
    });
    const access = await prisma.access.create({
      data: {
        userId: user.id,
        testId: test.id,
        source: "COMMERCIAL",
        attemptsTotal: 1,
        attemptsAvailable: 1,
        expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        commercialProductId: product.id,
        grantedAt: now,
        startDeadlineAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
      }
    });

    issueInput = {
      userId: user.id,
      commercialProductId: product.id,
      testId: test.id,
      accessId: access.id,
      source: "COMMERCIAL_ORDER_CLAIM",
      sourceReferenceId: randomUUID(),
      issuanceOperationId: randomUUID()
    };
  });

  afterAll(async () => {
    if (shouldRun) {
      await cleanDatabase();
    }
    await prisma.$disconnect();
  });

  it("initial issue creates exactly one generation-one row", async () => {
    const issued = await service.issue(issueInput);
    expect(issued.outcome).toBe("ISSUED");
    expect(issued.tokenGeneration).toBe(1);
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
  });

  it("persists only the digest and never the raw token", async () => {
    const issued = await service.issue(issueInput);
    const row = await prisma.verifiedStudentSession.findFirstOrThrow();
    const secret = issued.rawToken.split(".")[2];
    const persisted = JSON.stringify(row);
    expect(row.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted).not.toContain(issued.rawToken);
    expect(persisted).not.toContain(secret);
    expect(Object.keys(row)).not.toContain("rawToken");
  });

  it("resolves a valid token to the exact stored scope", async () => {
    const issued = await service.issue(issueInput);
    expect(await service.resolve(issued.rawToken)).toMatchObject({
      status: "RESOLVED",
      scope: {
        userId: issueInput.userId,
        commercialProductId: issueInput.commercialProductId,
        testId: issueInput.testId,
        accessId: issueInput.accessId
      },
      source: issueInput.source,
      tokenGeneration: 1
    });
  });

  it("does not resolve a wrong token", async () => {
    await service.issue(issueInput);
    expect(await service.resolve(createVerifiedStudentSessionToken("v1"))).toEqual({ status: "NOT_FOUND" });
  });

  it("same logical retry keeps one business row", async () => {
    await service.issue(issueInput);
    await service.issue(issueInput);
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
  });

  it("same logical retry increments token generation", async () => {
    await service.issue(issueInput);
    const retried = await service.issue(issueInput);
    expect(retried.outcome).toBe("ROTATED");
    expect(retried.tokenGeneration).toBe(2);
    expect((await prisma.verifiedStudentSession.findFirstOrThrow()).tokenGeneration).toBe(2);
  });

  it("rejects the old token after same-operation rotation", async () => {
    const first = await service.issue(issueInput);
    await service.issue(issueInput);
    expect(await service.resolve(first.rawToken)).toEqual({ status: "NOT_FOUND" });
  });

  it("accepts the new token after same-operation rotation", async () => {
    await service.issue(issueInput);
    const retried = await service.issue(issueInput);
    expect(await service.resolve(retried.rawToken)).toMatchObject({ status: "RESOLVED", tokenGeneration: 2 });
  });

  it("does not change issuedAt or absolute expiry during rotation", async () => {
    const first = await service.issue(issueInput);
    now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const retried = await service.issue(issueInput);
    expect(retried.issuedAt).toEqual(first.issuedAt);
    expect(retried.expiresAt).toEqual(first.expiresAt);
    expect(retried.expiresAt.getTime() - retried.issuedAt.getTime()).toBe(VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS);
  });

  it("rejects same-operation scope mismatch without rotating the credential", async () => {
    const issued = await service.issue(issueInput);
    const before = await prisma.verifiedStudentSession.findFirstOrThrow();
    await expect(service.issue({ ...issueInput, accessId: randomUUID() }))
      .rejects.toMatchObject({ code: "SCOPE_MISMATCH" } satisfies Partial<VerifiedStudentSessionServiceError>);
    const after = await prisma.verifiedStudentSession.findFirstOrThrow();
    expect(after.tokenDigest).toBe(before.tokenDigest);
    expect(after.tokenGeneration).toBe(1);
    expect(await service.resolve(issued.rawToken)).toMatchObject({ status: "RESOLVED" });
  });

  it("serializes parallel same-operation issue to one row and one current digest", async () => {
    const [first, second] = await Promise.all([
      service.issue(issueInput),
      service.issue(issueInput)
    ]);
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
    expect((await prisma.verifiedStudentSession.findFirstOrThrow()).tokenGeneration).toBe(2);
    const resolutions = await Promise.all([service.resolve(first.rawToken), service.resolve(second.rawToken)]);
    expect(resolutions.filter((result) => result.status === "RESOLVED")).toHaveLength(1);
    expect(resolutions.filter((result) => result.status === "NOT_FOUND")).toHaveLength(1);
  });

  it("revokes the current row idempotently", async () => {
    const issued = await service.issue(issueInput);
    expect(await service.revokeCurrent(issued.rawToken)).toEqual({ status: "REVOKED" });
    expect(await service.revokeCurrent(issued.rawToken)).toEqual({ status: "ALREADY_REVOKED" });
    expect(await service.resolve(issued.rawToken)).toEqual({ status: "REVOKED" });
  });

  it("revokes every active session for one Access idempotently", async () => {
    const first = await service.issue(issueInput);
    const second = await service.issue({
      ...issueInput,
      sourceReferenceId: randomUUID(),
      issuanceOperationId: randomUUID()
    });
    expect(await service.revokeActiveByAccess(issueInput.accessId)).toEqual({ revokedCount: 2 });
    expect(await service.revokeActiveByAccess(issueInput.accessId)).toEqual({ revokedCount: 0 });
    expect(await service.resolve(first.rawToken)).toEqual({ status: "REVOKED" });
    expect(await service.resolve(second.rawToken)).toEqual({ status: "REVOKED" });
  });

  it("revokes only active rows for the selected key version", async () => {
    const first = await service.issue(issueInput);
    const v2Service = createVerifiedStudentSessionService({
      client: prisma,
      config: config("v2"),
      clock: () => new Date(now)
    });
    const second = await v2Service.issue({
      ...issueInput,
      sourceReferenceId: randomUUID(),
      issuanceOperationId: randomUUID()
    });
    expect(await service.revokeActiveByKeyVersion("v1")).toEqual({ revokedCount: 1 });
    expect(await service.resolve(first.rawToken)).toEqual({ status: "REVOKED" });
    expect(await v2Service.resolve(second.rawToken)).toMatchObject({ status: "RESOLVED" });
  });

  it("makes a session unusable when its Access is revoked", async () => {
    const issued = await service.issue(issueInput);
    await prisma.access.update({ where: { id: issueInput.accessId }, data: { revokedAt: now } });
    expect(await service.resolve(issued.rawToken)).toEqual({ status: "ACCESS_REVOKED" });
  });

  it("makes a session unusable for deleted and non-STUDENT users", async () => {
    const issued = await service.issue(issueInput);
    await prisma.user.update({ where: { id: issueInput.userId }, data: { deletedAt: now } });
    expect(await service.resolve(issued.rawToken)).toEqual({ status: "SUBJECT_INVALID" });
    await prisma.user.update({
      where: { id: issueInput.userId },
      data: { deletedAt: null, role: "ADMIN" }
    });
    expect(await service.resolve(issued.rawToken)).toEqual({ status: "SUBJECT_INVALID" });
  });

  it("does not mutate generic User, Access or terminal Attempt result projection", async () => {
    const genericUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, role: "STUDENT" }
    });
    const genericTest = await prisma.test.create({
      data: {
        title: "Generic test",
        slug: `generic-${randomUUID()}`,
        price: 0,
        durationMinutes: 30,
        status: "PUBLISHED"
      }
    });
    const genericAccess = await prisma.access.create({
      data: {
        userId: genericUser.id,
        testId: genericTest.id,
        source: "MANUAL",
        attemptsTotal: 1,
        attemptsAvailable: 0,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      }
    });
    const genericAttempt = await prisma.attempt.create({
      data: {
        userId: genericUser.id,
        testId: genericTest.id,
        accessId: genericAccess.id,
        status: "COMPLETED",
        startedAt: new Date(now.getTime() - 60_000),
        finishedAt: now,
        rawScore: 1,
        maxRawScore: 1,
        testSnapshot: { mode: "training", questions: [] }
      }
    });
    const before = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: genericUser.id } }),
      access: await prisma.access.findUniqueOrThrow({ where: { id: genericAccess.id } }),
      resultProjection: await prisma.attempt.findUniqueOrThrow({ where: { id: genericAttempt.id } })
    };
    await service.issue(issueInput);
    const after = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: genericUser.id } }),
      access: await prisma.access.findUniqueOrThrow({ where: { id: genericAccess.id } }),
      resultProjection: await prisma.attempt.findUniqueOrThrow({ where: { id: genericAttempt.id } })
    };
    expect(after).toEqual(before);
  });

  it("creates no Order, PaymentAttempt, Access, Attempt or Answer", async () => {
    const before = {
      orders: await prisma.commercialOrder.count(),
      paymentAttempts: await prisma.commercialPaymentAttempt.count(),
      accesses: await prisma.access.count(),
      attempts: await prisma.attempt.count(),
      answers: await prisma.answer.count()
    };
    await service.issue(issueInput);
    const after = {
      orders: await prisma.commercialOrder.count(),
      paymentAttempts: await prisma.commercialPaymentAttempt.count(),
      accesses: await prisma.access.count(),
      attempts: await prisma.attempt.count(),
      answers: await prisma.answer.count()
    };
    expect(after).toEqual(before);
  });

  it("composes issuance inside a caller-owned Prisma transaction", async () => {
    const issued = await prisma.$transaction((tx) => service.issue(issueInput, tx));
    expect(issued.outcome).toBe("ISSUED");
    expect(await prisma.verifiedStudentSession.count()).toBe(1);
  });

  it("does not reactivate or rotate an expired logical session", async () => {
    const issued = await service.issue(issueInput);
    now = new Date(issued.expiresAt.getTime());
    await expect(service.issue(issueInput))
      .rejects.toMatchObject({ code: "SESSION_INACTIVE" } satisfies Partial<VerifiedStudentSessionServiceError>);
    const row = await prisma.verifiedStudentSession.findFirstOrThrow();
    expect(row.tokenGeneration).toBe(1);
    expect(row.expiresAt).toEqual(issued.expiresAt);
    expect(await service.resolve(issued.rawToken)).toEqual({ status: "EXPIRED" });
  });

  it("does not extend TTL or mutate the row on read", async () => {
    const issued = await service.issue(issueInput);
    const before = await prisma.verifiedStudentSession.findFirstOrThrow();
    now = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(await service.resolve(issued.rawToken)).toMatchObject({ status: "RESOLVED" });
    const after = await prisma.verifiedStudentSession.findFirstOrThrow();
    expect(after.issuedAt).toEqual(before.issuedAt);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
