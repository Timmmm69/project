import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type RecoveryContinuationAction
} from "@prisma/client";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import {
  createVerifiedStudentSessionService,
  VerifiedStudentSessionServiceError
} from "@/server/auth/verified-student-session/service";
import type { EnabledRecoveryConfig } from "@/server/recovery/config";
import {
  digestRecoverySessionToken,
  RecoveryCryptoError,
  secretDigestsEqual
} from "@/server/recovery/crypto";
import {
  resolveRecoveryStateInTransaction,
  RecoveryStateResolverError,
  type RecoveryContinuationAuthority
} from "@/server/recovery/state-resolver";

export type RecoveryContinuationSuccess = Readonly<{
  status: "SUCCESS";
  nextAction: RecoveryContinuationAction;
  nextUrl: string;
  rawVerifiedToken: string;
  verifiedSessionExpiresAt: Date;
}>;

export type RecoveryContinuationResult = RecoveryContinuationSuccess | Readonly<{
  status:
    | "RECOVERY_SESSION_REQUIRED"
    | "SCOPE_NOT_ALLOWED"
    | "STATE_CHANGED_RETRY_RESOLVE"
    | "CONTINUATION_OPERATION_CONFLICT";
}>;

export class RecoveryContinuationError extends Error {
  constructor(readonly code: "CONTINUATION_OUTCOME_UNKNOWN") {
    super(`RECOVERY_CONTINUATION_FAILED:${code}`);
    this.name = "RecoveryContinuationError";
  }
}

type ContinuationTestHooks = Readonly<{
  /** @internal Test-only fault injection after a proven commit and before HTTP serialization. */
  afterCommit?: () => Promise<void>;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prePathPattern = /^\/tests\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function hasSafeRelativeShape(value: string) {
  return value.startsWith("/") && !value.startsWith("//") &&
    !value.slice(1).includes("//") && !value.includes("\\") &&
    !value.includes("?") && !value.includes("#") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value.slice(1));
}

export function isAllowedRecoveryDestination(
  action: RecoveryContinuationAction,
  value: string
) {
  if (!hasSafeRelativeShape(value)) return false;
  if (action === "OPEN_PRE") return prePathPattern.test(value);
  const prefix = action === "OPEN_ATTEMPT" ? "/attempts/" : "/results/";
  return value.startsWith(prefix) && uuidPattern.test(value.slice(prefix.length));
}

export function createRecoveryDestination(authority: RecoveryContinuationAuthority): {
  nextAction: RecoveryContinuationAction;
  nextUrl: string;
} {
  const destination = authority.state === "access_unstarted"
    ? { nextAction: "OPEN_PRE" as const, nextUrl: `/tests/${authority.testSlug}` }
    : authority.state === "attempt_active"
      ? { nextAction: "OPEN_ATTEMPT" as const, nextUrl: `/attempts/${authority.attemptId}` }
      : { nextAction: "OPEN_RESULT" as const, nextUrl: `/results/${authority.attemptId}` };
  if (!isAllowedRecoveryDestination(destination.nextAction, destination.nextUrl)) {
    throw new RecoveryContinuationError("CONTINUATION_OUTCOME_UNKNOWN");
  }
  return destination;
}

function continuationFieldsAreEmpty(session: {
  continuationOperationId: string | null;
  continuationNextAction: RecoveryContinuationAction | null;
  continuationNextUrl: string | null;
  continuationVerifiedStudentSessionId: string | null;
  continuedAt: Date | null;
}) {
  return session.continuationOperationId === null &&
    session.continuationNextAction === null &&
    session.continuationNextUrl === null &&
    session.continuationVerifiedStudentSessionId === null &&
    session.continuedAt === null;
}

function continuationFieldsAreComplete(session: {
  continuationOperationId: string | null;
  continuationNextAction: RecoveryContinuationAction | null;
  continuationNextUrl: string | null;
  continuationVerifiedStudentSessionId: string | null;
  continuedAt: Date | null;
}) {
  return session.continuationOperationId !== null &&
    session.continuationNextAction !== null &&
    session.continuationNextUrl !== null &&
    session.continuationVerifiedStudentSessionId !== null &&
    session.continuedAt !== null;
}

function isProvenRollbackConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const metadata = error.meta as Record<string, unknown> | undefined;
  const databaseCode = metadata?.code ?? metadata?.sqlState ?? metadata?.sql_state;
  return databaseCode === "40001" || databaseCode === "40P01";
}

export function createRecoveryContinuationService(input: {
  client: PrismaClient;
  recoveryConfig: EnabledRecoveryConfig;
  verifiedSessionConfig: VerifiedStudentSessionConfig;
  clock?: () => Date;
  testHooks?: ContinuationTestHooks;
}) {
  const clock = input.clock ?? (() => new Date());
  const verifiedSessions = createVerifiedStudentSessionService({
    client: input.client,
    config: input.verifiedSessionConfig,
    clock
  });

  async function exchangeInTransaction(
    transaction: Prisma.TransactionClient,
    rawRecoveryToken: string,
    operationId: string
  ): Promise<RecoveryContinuationResult> {
    let token: { digest: string; keyVersion: string };
    try {
      token = digestRecoverySessionToken(
        rawRecoveryToken,
        input.recoveryConfig.keyRings.sessionToken
      );
    } catch (error) {
      if (error instanceof RecoveryCryptoError) {
        return { status: "RECOVERY_SESSION_REQUIRED" };
      }
      throw error;
    }

    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "verified_recovery_sessions"
      WHERE "token_digest" = ${token.digest}
      FOR UPDATE
    `;
    const recoverySessionId = locked[0]?.id;
    if (!recoverySessionId) return { status: "RECOVERY_SESSION_REQUIRED" };

    const session = await transaction.verifiedRecoverySession.findUniqueOrThrow({
      where: { id: recoverySessionId },
      include: {
        challenge: true,
        product: { select: { id: true, testId: true } },
        test: { select: { id: true } }
      }
    });
    if (session.tokenKeyVersion !== token.keyVersion ||
      !secretDigestsEqual(token.digest, session.tokenDigest)) {
      return { status: "RECOVERY_SESSION_REQUIRED" };
    }
    const now = clock();
    if (now.getTime() >= session.expiresAt.getTime()) {
      return { status: "RECOVERY_SESSION_REQUIRED" };
    }
    const scopeIsConsistent =
      session.product.id === session.commercialProductId &&
      session.product.testId === session.testId &&
      session.test.id === session.testId &&
      session.challenge.status === "VERIFIED" &&
      session.challenge.emailNormalized === session.emailNormalized &&
      session.challenge.emailFingerprint === session.emailFingerprint &&
      session.challenge.commercialProductId === session.commercialProductId &&
      session.challenge.testId === session.testId;
    if (!scopeIsConsistent) return { status: "SCOPE_NOT_ALLOWED" };

    const emptyOutcome = continuationFieldsAreEmpty(session);
    const completeOutcome = continuationFieldsAreComplete(session);
    if (!emptyOutcome && !completeOutcome) return { status: "SCOPE_NOT_ALLOWED" };

    if (completeOutcome) {
      if (session.status !== "REVOKED" || session.revocationCode !== "CONTINUED" ||
        !session.revokedAt || session.revokedAt.getTime() !== session.continuedAt!.getTime()) {
        return { status: "RECOVERY_SESSION_REQUIRED" };
      }
      if (session.continuationOperationId !== operationId) {
        return { status: "CONTINUATION_OPERATION_CONFLICT" };
      }
      if (!isAllowedRecoveryDestination(
        session.continuationNextAction!,
        session.continuationNextUrl!
      )) {
        throw new RecoveryContinuationError("CONTINUATION_OUTCOME_UNKNOWN");
      }
      const committedVerifiedSession = await transaction.verifiedStudentSession.findUnique({
        where: { id: session.continuationVerifiedStudentSessionId! }
      });
      if (!committedVerifiedSession ||
        committedVerifiedSession.source !== "EMAIL_OTP_RECOVERY" ||
        committedVerifiedSession.sourceReferenceId !== session.id ||
        committedVerifiedSession.issuanceOperationId !== operationId) {
        return { status: "SCOPE_NOT_ALLOWED" };
      }
      const issued = await verifiedSessions.issue({
        userId: committedVerifiedSession.userId,
        commercialProductId: committedVerifiedSession.commercialProductId,
        testId: committedVerifiedSession.testId,
        accessId: committedVerifiedSession.accessId,
        source: "EMAIL_OTP_RECOVERY",
        sourceReferenceId: session.id,
        issuanceOperationId: operationId
      }, transaction);
      await transaction.recoverySecurityEvent.create({
        data: {
          correlationId: randomUUID(),
          eventCode: "VERIFIED_SESSION_ROTATED",
          recoverySessionId: session.id,
          reasonCode: "SESSION_CONTINUED",
          occurredAt: now
        }
      });
      return {
        status: "SUCCESS",
        nextAction: session.continuationNextAction!,
        nextUrl: session.continuationNextUrl!,
        rawVerifiedToken: issued.rawToken,
        verifiedSessionExpiresAt: issued.expiresAt
      };
    }

    if (session.status !== "ACTIVE" || session.revokedAt || session.revocationCode) {
      return { status: "RECOVERY_SESSION_REQUIRED" };
    }
    const operationOwner = await transaction.verifiedRecoverySession.findUnique({
      where: { continuationOperationId: operationId },
      select: { id: true }
    });
    if (operationOwner && operationOwner.id !== session.id) {
      return { status: "CONTINUATION_OPERATION_CONFLICT" };
    }

    const resolution = await resolveRecoveryStateInTransaction({
      transaction,
      productCode: input.recoveryConfig.productCode,
      scope: {
        emailNormalized: session.emailNormalized,
        commercialProductId: session.commercialProductId,
        testId: session.testId
      },
      now
    });
    if (!resolution.authority) return { status: "STATE_CHANGED_RETRY_RESOLVE" };
    const destination = createRecoveryDestination(resolution.authority);
    const issued = await verifiedSessions.issue({
      userId: resolution.authority.userId,
      commercialProductId: resolution.authority.commercialProductId,
      testId: resolution.authority.testId,
      accessId: resolution.authority.accessId,
      source: "EMAIL_OTP_RECOVERY",
      sourceReferenceId: session.id,
      issuanceOperationId: operationId
    }, transaction);

    const updated = await transaction.verifiedRecoverySession.updateMany({
      where: {
        id: session.id,
        status: "ACTIVE",
        continuationOperationId: null,
        continuationNextAction: null,
        continuationNextUrl: null,
        continuationVerifiedStudentSessionId: null,
        continuedAt: null
      },
      data: {
        continuationOperationId: operationId,
        continuationNextAction: destination.nextAction,
        continuationNextUrl: destination.nextUrl,
        continuationVerifiedStudentSessionId: issued.sessionId,
        continuedAt: now,
        status: "REVOKED",
        revocationCode: "CONTINUED",
        revokedAt: now
      }
    });
    if (updated.count !== 1) return { status: "STATE_CHANGED_RETRY_RESOLVE" };
    await transaction.recoverySecurityEvent.createMany({
      data: [
        {
          correlationId: randomUUID(),
          eventCode: issued.outcome === "ISSUED"
            ? "VERIFIED_SESSION_ISSUED"
            : "VERIFIED_SESSION_ROTATED",
          recoverySessionId: session.id,
          reasonCode: "SESSION_CONTINUED",
          occurredAt: now
        },
        {
          correlationId: randomUUID(),
          eventCode: "SESSION_REVOKED",
          recoverySessionId: session.id,
          reasonCode: "SESSION_CONTINUED",
          occurredAt: now
        }
      ]
    });
    return {
      status: "SUCCESS",
      ...destination,
      rawVerifiedToken: issued.rawToken,
      verifiedSessionExpiresAt: issued.expiresAt
    };
  }

  return {
    async exchange(rawRecoveryToken: string, operationId: string): Promise<RecoveryContinuationResult> {
      let result: RecoveryContinuationResult | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          result = await input.client.$transaction(
            (transaction) => exchangeInTransaction(transaction, rawRecoveryToken, operationId),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          );
          break;
        } catch (error) {
          if (error instanceof RecoveryStateResolverError && error.code === "SCOPE_NOT_ALLOWED") {
            return { status: "SCOPE_NOT_ALLOWED" };
          }
          if (error instanceof VerifiedStudentSessionServiceError) {
            return error.code === "SCOPE_MISMATCH"
              ? { status: "SCOPE_NOT_ALLOWED" }
              : { status: "STATE_CHANGED_RETRY_RESOLVE" };
          }
          if (isProvenRollbackConflict(error)) {
            if (attempt === 0) continue;
            return { status: "STATE_CHANGED_RETRY_RESOLVE" };
          }
          throw error;
        }
      }
      if (!result) return { status: "STATE_CHANGED_RETRY_RESOLVE" };
      if (result.status === "SUCCESS" && input.testHooks?.afterCommit) {
        try {
          await input.testHooks.afterCommit();
        } catch {
          throw new RecoveryContinuationError("CONTINUATION_OUTCOME_UNKNOWN");
        }
      }
      return result;
    }
  };
}
