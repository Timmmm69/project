import { randomUUID } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  VerifiedStudentSessionRevocationReason,
  VerifiedStudentSessionSource
} from "@prisma/client";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import {
  createVerifiedStudentSessionToken,
  digestVerifiedStudentSessionToken,
  parseVerifiedStudentSessionToken,
  verifiedStudentSessionDigestsEqual,
  VerifiedStudentSessionTokenError
} from "@/server/auth/verified-student-session/token";

export const VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Clock = () => Date;
type Tx = Prisma.TransactionClient;

export type VerifiedStudentSessionScope = Readonly<{
  userId: string;
  commercialProductId: string;
  testId: string;
  accessId: string;
}>;

export type IssueVerifiedStudentSessionInput = VerifiedStudentSessionScope & Readonly<{
  source: VerifiedStudentSessionSource;
  sourceReferenceId: string;
  issuanceOperationId: string;
}>;

export type IssueVerifiedStudentSessionResult = VerifiedStudentSessionScope & Readonly<{
  outcome: "ISSUED" | "ROTATED";
  source: VerifiedStudentSessionSource;
  rawToken: string;
  tokenGeneration: number;
  issuedAt: Date;
  expiresAt: Date;
}>;

export type ResolveVerifiedStudentSessionResult =
  | Readonly<{ status: "INVALID_TOKEN" | "UNKNOWN_KEY" | "NOT_FOUND" | "REVOKED" | "EXPIRED" | "SUBJECT_INVALID" | "ACCESS_REVOKED" | "SCOPE_MISMATCH" }>
  | Readonly<{
      status: "RESOLVED";
      scope: VerifiedStudentSessionScope;
      source: VerifiedStudentSessionSource;
      tokenGeneration: number;
      issuedAt: Date;
      expiresAt: Date;
    }>;

export type RevokeCurrentVerifiedStudentSessionResult = Readonly<{
  status: "REVOKED" | "ALREADY_REVOKED" | "NOT_FOUND";
}>;

export type VerifiedStudentSessionServiceErrorCode =
  | "SUBJECT_INVALID"
  | "ACCESS_REVOKED"
  | "SCOPE_MISMATCH"
  | "SESSION_INACTIVE"
  | "CONCURRENT_STATE_CHANGE";

export class VerifiedStudentSessionServiceError extends Error {
  constructor(readonly code: VerifiedStudentSessionServiceErrorCode) {
    super(`VERIFIED_STUDENT_SESSION_OPERATION_REJECTED:${code}`);
    this.name = "VerifiedStudentSessionServiceError";
  }
}

export function verifiedStudentSessionExpiresAt(issuedAt: Date) {
  return new Date(issuedAt.getTime() + VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS);
}

export function isVerifiedStudentSessionActive(
  session: Readonly<{ revokedAt: Date | null; expiresAt: Date }>,
  now: Date
) {
  return session.revokedAt === null && now.getTime() < session.expiresAt.getTime();
}

function scopeMatches(left: VerifiedStudentSessionScope, right: VerifiedStudentSessionScope) {
  return left.userId === right.userId &&
    left.commercialProductId === right.commercialProductId &&
    left.testId === right.testId &&
    left.accessId === right.accessId;
}

function scopeFromInput(input: VerifiedStudentSessionScope): VerifiedStudentSessionScope {
  return {
    userId: input.userId,
    commercialProductId: input.commercialProductId,
    testId: input.testId,
    accessId: input.accessId
  };
}

async function validateVerifiedStudentSessionScope(tx: Tx, scope: VerifiedStudentSessionScope) {
  const users = await tx.$queryRaw<Array<{ role: string; deletedAt: Date | null }>>`
    SELECT "role"::text AS "role", "deleted_at" AS "deletedAt"
    FROM "users"
    WHERE "id" = ${scope.userId}::uuid
    FOR SHARE
  `;
  const user = users[0];
  if (!user || user.role !== "student" || user.deletedAt) {
    throw new VerifiedStudentSessionServiceError("SUBJECT_INVALID");
  }

  const tests = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "tests"
    WHERE "id" = ${scope.testId}::uuid
    FOR SHARE
  `;
  const products = await tx.$queryRaw<Array<{ testId: string }>>`
    SELECT "test_id" AS "testId"
    FROM "commercial_products"
    WHERE "id" = ${scope.commercialProductId}::uuid
    FOR SHARE
  `;
  const accesses = await tx.$queryRaw<Array<{
    userId: string;
    testId: string;
    commercialProductId: string | null;
    revokedAt: Date | null;
  }>>`
    SELECT
      "user_id" AS "userId",
      "test_id" AS "testId",
      "commercial_product_id" AS "commercialProductId",
      "revoked_at" AS "revokedAt"
    FROM "accesses"
    WHERE "id" = ${scope.accessId}::uuid
    FOR SHARE
  `;

  const product = products[0];
  const access = accesses[0];
  const scopeIsConsistent =
    tests.length === 1 &&
    product?.testId === scope.testId &&
    access?.userId === scope.userId &&
    access?.testId === scope.testId &&
    access?.commercialProductId === scope.commercialProductId;
  if (!scopeIsConsistent) {
    throw new VerifiedStudentSessionServiceError("SCOPE_MISMATCH");
  }
  if (access?.revokedAt) {
    throw new VerifiedStudentSessionServiceError("ACCESS_REVOKED");
  }
}

export function createVerifiedStudentSessionService(input: {
  client: PrismaClient;
  config: VerifiedStudentSessionConfig;
  clock?: Clock;
}) {
  const clock = input.clock ?? (() => new Date());

  async function withTransaction<T>(tx: Tx | undefined, operation: (activeTx: Tx) => Promise<T>) {
    return tx ? operation(tx) : input.client.$transaction(operation);
  }

  async function issueWithinTransaction(tx: Tx, issueInput: IssueVerifiedStudentSessionInput) {
    const logicalKey = `${issueInput.source}:${issueInput.sourceReferenceId}:${issueInput.issuanceOperationId}`;
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${logicalKey}, 0))) AS acquired
    `;

    const existing = await tx.verifiedStudentSession.findUnique({
      where: {
        source_sourceReferenceId_issuanceOperationId: {
          source: issueInput.source,
          sourceReferenceId: issueInput.sourceReferenceId,
          issuanceOperationId: issueInput.issuanceOperationId
        }
      }
    });
    const requestedScope = scopeFromInput(issueInput);
    const now = clock();

    if (existing && !scopeMatches(existing, requestedScope)) {
      throw new VerifiedStudentSessionServiceError("SCOPE_MISMATCH");
    }
    await validateVerifiedStudentSessionScope(tx, requestedScope);

    if (!existing) {
      const rawToken = createVerifiedStudentSessionToken(input.config.activeKeyVersion);
      const tokenDigest = digestVerifiedStudentSessionToken(rawToken, input.config);
      const issuedAt = now;
      const expiresAt = verifiedStudentSessionExpiresAt(issuedAt);
      const created = await tx.verifiedStudentSession.create({
        data: {
          tokenDigest,
          tokenKeyVersion: input.config.activeKeyVersion,
          tokenGeneration: 1,
          ...requestedScope,
          source: issueInput.source,
          sourceReferenceId: issueInput.sourceReferenceId,
          issuanceOperationId: issueInput.issuanceOperationId,
          issuedAt,
          expiresAt,
          securityCorrelationId: randomUUID()
        }
      });
      return {
        outcome: "ISSUED" as const,
        ...requestedScope,
        source: created.source,
        rawToken,
        tokenGeneration: created.tokenGeneration,
        issuedAt: created.issuedAt,
        expiresAt: created.expiresAt
      };
    }

    if (!isVerifiedStudentSessionActive(existing, now)) {
      throw new VerifiedStudentSessionServiceError("SESSION_INACTIVE");
    }

    const rawToken = createVerifiedStudentSessionToken(input.config.activeKeyVersion);
    const tokenDigest = digestVerifiedStudentSessionToken(rawToken, input.config);
    const rotated = await tx.verifiedStudentSession.updateMany({
      where: {
        id: existing.id,
        tokenGeneration: existing.tokenGeneration,
        revokedAt: null,
        expiresAt: { gt: now }
      },
      data: {
        tokenDigest,
        tokenKeyVersion: input.config.activeKeyVersion,
        tokenGeneration: { increment: 1 },
        lastRotatedAt: now
      }
    });
    if (rotated.count !== 1) {
      throw new VerifiedStudentSessionServiceError("CONCURRENT_STATE_CHANGE");
    }

    return {
      outcome: "ROTATED" as const,
      ...requestedScope,
      source: existing.source,
      rawToken,
      tokenGeneration: existing.tokenGeneration + 1,
      issuedAt: existing.issuedAt,
      expiresAt: existing.expiresAt
    };
  }

  return {
    issue(
      issueInput: IssueVerifiedStudentSessionInput,
      tx?: Tx
    ): Promise<IssueVerifiedStudentSessionResult> {
      return withTransaction(tx, (activeTx) => issueWithinTransaction(activeTx, issueInput));
    },

    async resolve(rawToken: string): Promise<ResolveVerifiedStudentSessionResult> {
      let parsed;
      try {
        parsed = parseVerifiedStudentSessionToken(rawToken, input.config.keys);
      } catch (error) {
        if (error instanceof VerifiedStudentSessionTokenError) {
          return { status: error.code === "UNKNOWN_KEY_VERSION" ? "UNKNOWN_KEY" : "INVALID_TOKEN" };
        }
        throw error;
      }

      const tokenDigest = digestVerifiedStudentSessionToken(rawToken, input.config);
      const session = await input.client.verifiedStudentSession.findUnique({
        where: { tokenDigest },
        include: {
          user: { select: { id: true, role: true, deletedAt: true } },
          product: { select: { id: true, testId: true } },
          test: { select: { id: true } },
          access: {
            select: {
              id: true,
              userId: true,
              testId: true,
              commercialProductId: true,
              revokedAt: true
            }
          }
        }
      });
      if (!session || !verifiedStudentSessionDigestsEqual(tokenDigest, session.tokenDigest)) {
        return { status: "NOT_FOUND" };
      }
      if (session.tokenKeyVersion !== parsed.keyVersion) {
        return { status: "SCOPE_MISMATCH" };
      }
      if (session.revokedAt) {
        return { status: "REVOKED" };
      }
      if (clock().getTime() >= session.expiresAt.getTime()) {
        return { status: "EXPIRED" };
      }
      if (session.user.deletedAt || session.user.role !== "STUDENT") {
        return { status: "SUBJECT_INVALID" };
      }
      if (session.access.revokedAt) {
        return { status: "ACCESS_REVOKED" };
      }

      const scope = scopeFromInput(session);
      const scopeIsConsistent =
        session.user.id === scope.userId &&
        session.product.id === scope.commercialProductId &&
        session.product.testId === scope.testId &&
        session.test.id === scope.testId &&
        session.access.id === scope.accessId &&
        session.access.userId === scope.userId &&
        session.access.testId === scope.testId &&
        session.access.commercialProductId === scope.commercialProductId;
      if (!scopeIsConsistent) {
        return { status: "SCOPE_MISMATCH" };
      }

      return {
        status: "RESOLVED",
        scope,
        source: session.source,
        tokenGeneration: session.tokenGeneration,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt
      };
    },

    async revokeCurrent(
      rawToken: string,
      reason: VerifiedStudentSessionRevocationReason = "LOGOUT",
      tx?: Tx
    ): Promise<RevokeCurrentVerifiedStudentSessionResult> {
      let tokenDigest: string;
      try {
        tokenDigest = digestVerifiedStudentSessionToken(rawToken, input.config);
      } catch (error) {
        if (error instanceof VerifiedStudentSessionTokenError) {
          return { status: "NOT_FOUND" };
        }
        throw error;
      }

      return withTransaction(tx, async (activeTx) => {
        const session = await activeTx.verifiedStudentSession.findUnique({
          where: { tokenDigest },
          select: { id: true, tokenDigest: true, revokedAt: true }
        });
        if (!session || !verifiedStudentSessionDigestsEqual(tokenDigest, session.tokenDigest)) {
          return { status: "NOT_FOUND" };
        }
        if (session.revokedAt) {
          return { status: "ALREADY_REVOKED" };
        }

        const revoked = await activeTx.verifiedStudentSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: clock(), revocationReason: reason }
        });
        return { status: revoked.count === 1 ? "REVOKED" : "ALREADY_REVOKED" };
      });
    },

    revokeActiveByAccess(
      accessId: string,
      reason: VerifiedStudentSessionRevocationReason = "ACCESS_REVOKED",
      tx?: Tx
    ) {
      return withTransaction(tx, async (activeTx) => {
        const now = clock();
        const result = await activeTx.verifiedStudentSession.updateMany({
          where: { accessId, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now, revocationReason: reason }
        });
        return { revokedCount: result.count };
      });
    },

    revokeActiveByKeyVersion(
      tokenKeyVersion: string,
      reason: VerifiedStudentSessionRevocationReason = "KEY_RETIRED",
      tx?: Tx
    ) {
      return withTransaction(tx, async (activeTx) => {
        const now = clock();
        const result = await activeTx.verifiedStudentSession.updateMany({
          where: { tokenKeyVersion, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now, revocationReason: reason }
        });
        return { revokedCount: result.count };
      });
    }
  };
}
