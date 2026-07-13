import type { Prisma, PrismaClient, RecoveryRateLimitKind } from "@prisma/client";
import type { RecoveryKeyRing } from "@/server/recovery/config";
import { createRecoverySourceDigest } from "@/server/recovery/crypto";

export const RECOVERY_RATE_LIMIT_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

const minute = 60 * 1000;
const hour = 60 * minute;

const limits = {
  EMAIL_REQUEST: [
    { windowMs: 15 * minute, maximum: 3, safeCode: "EMAIL_REQUEST_LIMIT_15M" },
    { windowMs: 24 * hour, maximum: 10, safeCode: "EMAIL_REQUEST_LIMIT_24H" }
  ],
  SOURCE_REQUEST: [
    { windowMs: 15 * minute, maximum: 20, safeCode: "SOURCE_REQUEST_LIMIT_15M" },
    { windowMs: 24 * hour, maximum: 100, safeCode: "SOURCE_REQUEST_LIMIT_24H" }
  ],
  SOURCE_VERIFY_FAILURE: [
    { windowMs: hour, maximum: 20, safeCode: "SOURCE_VERIFY_FAILURE_LIMIT_1H" }
  ]
} as const satisfies Record<RecoveryRateLimitKind, readonly RateLimitWindow[]>;

type Tx = Prisma.TransactionClient;
type Clock = () => Date;

type RateLimitWindow = Readonly<{
  windowMs: number;
  maximum: number;
  safeCode: string;
}>;

export type RecoveryRateLimitResult =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; safeCode: string; retryAfterSeconds: number }>;

export type RecoveryVerifySourcePermit = Readonly<{
  allowed: true;
  keyDigest: string;
}> | Readonly<{
  allowed: false;
  safeCode: string;
  retryAfterSeconds: number;
}>;

function secondsUntil(now: Date, target: Date) {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

export function createRecoveryRateLimitService(input: {
  client: PrismaClient;
  fingerprintKeyRing: RecoveryKeyRing;
  clock?: Clock;
}) {
  const clock = input.clock ?? (() => new Date());

  async function withTransaction<T>(tx: Tx | undefined, operation: (activeTx: Tx) => Promise<T>) {
    return tx ? operation(tx) : input.client.$transaction(operation);
  }

  async function acquireLock(tx: Tx, kind: RecoveryRateLimitKind, keyDigest: string) {
    const lockKey = `acc01a-rate-limit:${kind}:${keyDigest}`;
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
    `;
  }

  async function evaluate(
    tx: Tx,
    kind: RecoveryRateLimitKind,
    keyDigest: string,
    shouldRecord: boolean
  ): Promise<RecoveryRateLimitResult> {
    await acquireLock(tx, kind, keyDigest);
    const now = clock();
    let denial: { safeCode: string; retryAfterSeconds: number } | null = null;

    for (const window of limits[kind]) {
      const since = new Date(now.getTime() - window.windowMs);
      const count = await tx.recoveryRateLimitEvent.count({
        where: { kind, keyDigest, occurredAt: { gt: since } }
      });
      if (count < window.maximum) {
        continue;
      }
      const oldest = await tx.recoveryRateLimitEvent.findFirst({
        where: { kind, keyDigest, occurredAt: { gt: since } },
        orderBy: { occurredAt: "asc" },
        select: { occurredAt: true }
      });
      const retryAfterSeconds = oldest
        ? secondsUntil(now, new Date(oldest.occurredAt.getTime() + window.windowMs))
        : 1;
      if (!denial || retryAfterSeconds > denial.retryAfterSeconds) {
        denial = { safeCode: window.safeCode, retryAfterSeconds };
      }
    }

    if (denial) {
      return { allowed: false, ...denial };
    }
    if (shouldRecord) {
      await tx.recoveryRateLimitEvent.create({
        data: {
          kind,
          keyDigest,
          occurredAt: now,
          expiresAt: new Date(now.getTime() + RECOVERY_RATE_LIMIT_EVENT_RETENTION_MS)
        }
      });
    }
    return { allowed: true };
  }

  return {
    consumeEmailRequest(emailFingerprint: string, tx?: Tx) {
      return withTransaction(tx, (activeTx) => evaluate(activeTx, "EMAIL_REQUEST", emailFingerprint, true));
    },

    consumeSourceRequest(rawSource: string, tx?: Tx) {
      const keyDigest = createRecoverySourceDigest(rawSource, input.fingerprintKeyRing, "request");
      return withTransaction(tx, (activeTx) => evaluate(activeTx, "SOURCE_REQUEST", keyDigest, true));
    },

    async checkFailedVerifySource(rawSource: string, tx?: Tx): Promise<RecoveryVerifySourcePermit> {
      const keyDigest = createRecoverySourceDigest(rawSource, input.fingerprintKeyRing, "verify");
      const result = await withTransaction(tx, (activeTx) => (
        evaluate(activeTx, "SOURCE_VERIFY_FAILURE", keyDigest, false)
      ));
      return result.allowed ? { allowed: true, keyDigest } : result;
    },

    consumeFailedVerifySource(rawSource: string, tx?: Tx) {
      const keyDigest = createRecoverySourceDigest(rawSource, input.fingerprintKeyRing, "verify");
      return withTransaction(tx, (activeTx) => (
        evaluate(activeTx, "SOURCE_VERIFY_FAILURE", keyDigest, true)
      ));
    },

    recordFailedVerifySource(keyDigest: string, tx?: Tx) {
      return withTransaction(tx, async (activeTx) => {
        const now = clock();
        await activeTx.recoveryRateLimitEvent.create({
          data: {
            kind: "SOURCE_VERIFY_FAILURE",
            keyDigest,
            occurredAt: now,
            expiresAt: new Date(now.getTime() + RECOVERY_RATE_LIMIT_EVENT_RETENTION_MS)
          }
        });
      });
    },

    cleanupExpired(tx?: Tx) {
      return withTransaction(tx, async (activeTx) => {
        const deleted = await activeTx.recoveryRateLimitEvent.deleteMany({
          where: { expiresAt: { lte: clock() } }
        });
        return { deletedCount: deleted.count };
      });
    }
  };
}
