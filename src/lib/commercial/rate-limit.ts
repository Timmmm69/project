import type { Prisma, PrismaClient, CommercialRateLimitKind } from "@prisma/client";
import { prisma } from "@/server/db/client";

export const COMMERCIAL_RATE_LIMIT_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

const minute = 60 * 1000;

const limits = {
  ORDER_CREATE: [
    { windowMs: minute, maximum: 5, safeCode: "ORDER_CREATE_LIMIT_1M" }
  ],
  PAYMENT_SESSION_CREATE: [
    { windowMs: minute, maximum: 10, safeCode: "PAYMENT_SESSION_CREATE_LIMIT_1M" }
  ],
  STATUS_REFRESH: [
    { windowMs: minute, maximum: 10, safeCode: "STATUS_REFRESH_LIMIT_1M" }
  ],
  CHECKOUT_FLOW: [
    { windowMs: minute, maximum: 5, safeCode: "CHECKOUT_FLOW_LIMIT_1M" }
  ],
  BRUTE_FORCE: [
    { windowMs: 15 * minute, maximum: 20, safeCode: "BRUTE_FORCE_LIMIT_15M" }
  ]
} as const satisfies Record<CommercialRateLimitKind, readonly RateLimitWindow[]>;

type Tx = Prisma.TransactionClient;
type Clock = () => Date;

type RateLimitWindow = Readonly<{
  windowMs: number;
  maximum: number;
  safeCode: string;
}>;

export type CommercialRateLimitResult =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; safeCode: string; retryAfterSeconds: number }>;

function secondsUntil(now: Date, target: Date) {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

export function createCommercialRateLimitService(input: {
  client?: PrismaClient;
  clock?: Clock;
} = {}) {
  const client = input.client ?? prisma;
  const clock = input.clock ?? (() => new Date());

  async function withTransaction<T>(tx: Tx | undefined, operation: (activeTx: Tx) => Promise<T>) {
    return tx ? operation(tx) : client.$transaction(operation);
  }

  async function acquireLock(tx: Tx, kind: CommercialRateLimitKind, keyDigest: string) {
    const lockKey = `commercial-rate-limit:${kind}:${keyDigest}`;
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
    `;
  }

  async function evaluate(
    tx: Tx,
    kind: CommercialRateLimitKind,
    keyDigest: string,
    shouldRecord: boolean
  ): Promise<CommercialRateLimitResult> {
    await acquireLock(tx, kind, keyDigest);
    const now = clock();
    let denial: { safeCode: string; retryAfterSeconds: number } | null = null;

    for (const window of limits[kind]) {
      const since = new Date(now.getTime() - window.windowMs);
      const count = await tx.commercialRateLimitEvent.count({
        where: { kind, keyDigest, occurredAt: { gt: since } }
      });
      if (count < window.maximum) {
        continue;
      }
      const oldest = await tx.commercialRateLimitEvent.findFirst({
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
      await tx.commercialRateLimitEvent.create({
        data: {
          kind,
          keyDigest,
          occurredAt: now,
          expiresAt: new Date(now.getTime() + COMMERCIAL_RATE_LIMIT_EVENT_RETENTION_MS)
        }
      });
    }
    return { allowed: true };
  }

  return {
    consume(kind: CommercialRateLimitKind, keyDigest: string, tx?: Tx) {
      return withTransaction(tx, (activeTx) => evaluate(activeTx, kind, keyDigest, true));
    },

    cleanupExpired(tx?: Tx) {
      return withTransaction(tx, async (activeTx) => {
        const deleted = await activeTx.commercialRateLimitEvent.deleteMany({
          where: { expiresAt: { lte: clock() } }
        });
        return { deletedCount: deleted.count };
      });
    }
  };
}

export const commercialRateLimiter = createCommercialRateLimitService();

export function deriveCommercialClientKey(request: Request): string {
  if (process.env.TRUSTED_PROXY === "true") {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
      const first = forwardedFor.split(",")[0]!.trim();
      if (first) return `proxy:${first}`;
    }
  }
  const host = request.headers.get("host") ?? "unknown";
  return `host:${host}`;
}
