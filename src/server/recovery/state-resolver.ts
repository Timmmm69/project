import type {
  AccessSource,
  AttemptStatus,
  CommercialOrderStatus,
  CommercialPaymentAttemptStatus,
  Prisma,
  PrismaClient,
  UserRole
} from "@prisma/client";
import { z } from "zod";

export const RECOVERY_RESOLVED_STATES = [
  "access_unstarted",
  "attempt_active",
  "result_available",
  "start_window_expired",
  "no_access",
  "support_required"
] as const;

export type RecoveryResolvedState = (typeof RECOVERY_RESOLVED_STATES)[number];
export type RecoveryNextAction = "CONTINUE" | null;

export const recoveryStateResponseSchema = z.object({
  state: z.enum(RECOVERY_RESOLVED_STATES),
  screen: z.literal("REC-01"),
  nextAction: z.literal("CONTINUE").nullable()
}).strict();

export type RecoveryStateResponse = z.infer<typeof recoveryStateResponseSchema>;

export class RecoveryStateResolverError extends Error {
  constructor(readonly code: "SCOPE_NOT_ALLOWED") {
    super(`RECOVERY_STATE_RESOLUTION_REJECTED:${code}`);
    this.name = "RecoveryStateResolverError";
  }
}

type ProductCandidate = Readonly<{
  id: string;
  code: string;
  testId: string;
  attemptLimit: number;
  resultRetentionDays: number;
  test: Readonly<{
    id: string;
    examMode: string;
    deletedAt: Date | null;
  }>;
}>;

type UserCandidate = Readonly<{
  id: string;
  role: UserRole;
  deletedAt: Date | null;
}>;

type PaymentAttemptCandidate = Readonly<{
  id: string;
  status: CommercialPaymentAttemptStatus;
}>;

type OrderCandidate = Readonly<{
  id: string;
  commercialProductId: string;
  testIdSnapshot: string;
  emailNormalized: string;
  status: CommercialOrderStatus;
  paymentAttempts: readonly PaymentAttemptCandidate[];
}>;

type AccessCandidate = Readonly<{
  id: string;
  userId: string;
  testId: string;
  source: AccessSource;
  attemptsTotal: number;
  attemptsAvailable: number;
  expiresAt: Date;
  revokedAt: Date | null;
  commercialProductId: string | null;
  commercialOrderId: string | null;
  commercialPaymentAttemptId: string | null;
  grantedAt: Date | null;
  startDeadlineAt: Date | null;
}>;

type AttemptCandidate = Readonly<{
  id: string;
  userId: string;
  testId: string;
  accessId: string;
  status: AttemptStatus;
  finishedAt: Date | null;
  durationSeconds: number | null;
  rawScore: number | null;
  maxRawScore: number | null;
  percent: unknown;
  testSnapshot: Prisma.JsonValue;
}>;

export type RecoveryStateSnapshot = Readonly<{
  emailNormalized: string;
  commercialProductId: string;
  testId: string;
  product: ProductCandidate | null;
  users: readonly UserCandidate[];
  orders: readonly OrderCandidate[];
  accesses: readonly AccessCandidate[];
  attempts: readonly AttemptCandidate[];
}>;

const terminalSnapshotSchema = z.object({
  testId: z.string().min(1),
  examMode: z.literal("rikz_russian_2026"),
  durationMinutes: z.number().int().positive(),
  questions: z.array(z.unknown()).min(1)
}).passthrough();

function state(state: RecoveryResolvedState): RecoveryStateResponse {
  return recoveryStateResponseSchema.parse({
    state,
    screen: "REC-01",
    nextAction: state === "access_unstarted" ||
      state === "attempt_active" ||
      state === "result_available"
      ? "CONTINUE"
      : null
  });
}

function uniqueById<T extends { id: string }>(values: readonly T[]) {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function paymentStateIsStructurallySafeWithoutAccess(orders: readonly OrderCandidate[]) {
  for (const order of orders) {
    if (order.status === "PAID" || order.status === "CREATED" || order.status === "PENDING") {
      return false;
    }
    for (const payment of order.paymentAttempts) {
      if (payment.status === "PAID" || payment.status === "CREATED" || payment.status === "PENDING") {
        return false;
      }
    }
  }
  return true;
}

function terminalProjectionIsReadable(
  attempt: AttemptCandidate,
  testId: string,
  resultRetentionDays: number,
  now: Date
) {
  if (!attempt.finishedAt || attempt.durationSeconds === null || attempt.durationSeconds < 0 ||
    attempt.rawScore === null || attempt.maxRawScore === null || attempt.maxRawScore < 0 ||
    attempt.rawScore < 0 || attempt.rawScore > attempt.maxRawScore || attempt.percent === null) {
    return false;
  }
  const percent = Number(attempt.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return false;
  const snapshot = terminalSnapshotSchema.safeParse(attempt.testSnapshot);
  if (!snapshot.success || snapshot.data.testId !== testId) return false;
  const retentionEndsAt = new Date(attempt.finishedAt);
  retentionEndsAt.setUTCDate(retentionEndsAt.getUTCDate() + resultRetentionDays);
  return resultRetentionDays > 0 && now.getTime() < retentionEndsAt.getTime();
}

export function resolveRecoveryStateSnapshot(
  snapshot: RecoveryStateSnapshot,
  now: Date
): RecoveryStateResponse {
  const product = snapshot.product;
  if (!product || product.id !== snapshot.commercialProductId ||
    product.testId !== snapshot.testId || product.test.id !== snapshot.testId ||
    product.test.deletedAt || product.test.examMode !== "RIKZ_RUSSIAN_2026" ||
    product.attemptLimit !== 1) {
    return state("support_required");
  }

  const users = uniqueById(snapshot.users);
  const accesses = uniqueById(snapshot.accesses);
  const attempts = uniqueById(snapshot.attempts);
  if (users.length > 1 || accesses.length > 1 || attempts.length > 1) {
    return state("support_required");
  }

  const user = users[0] ?? null;
  if (user && (user.role !== "STUDENT" || user.deletedAt !== null)) {
    return state("support_required");
  }

  const access = accesses[0] ?? null;
  const attempt = attempts[0] ?? null;
  if (!access) {
    if (attempt || !paymentStateIsStructurallySafeWithoutAccess(snapshot.orders)) {
      return state("support_required");
    }
    return state("no_access");
  }

  if (!user || access.userId !== user.id || access.testId !== snapshot.testId ||
    access.source !== "COMMERCIAL" || access.commercialProductId !== product.id ||
    !access.commercialOrderId || !access.commercialPaymentAttemptId ||
    !access.grantedAt || !access.startDeadlineAt || access.revokedAt ||
    access.expiresAt.getTime() !== access.startDeadlineAt.getTime() ||
    access.attemptsTotal !== product.attemptLimit ||
    access.attemptsAvailable < 0 || access.attemptsAvailable > access.attemptsTotal) {
    return state("support_required");
  }

  const linkedOrders = snapshot.orders.filter((order) => order.id === access.commercialOrderId);
  const paidOrders = snapshot.orders.filter((order) => order.status === "PAID");
  if (linkedOrders.length !== 1 || paidOrders.length !== 1 || paidOrders[0]?.id !== access.commercialOrderId) {
    return state("support_required");
  }
  const linkedOrder = linkedOrders[0];
  if (linkedOrder.commercialProductId !== product.id ||
    linkedOrder.testIdSnapshot !== snapshot.testId ||
    linkedOrder.emailNormalized !== snapshot.emailNormalized) {
    return state("support_required");
  }
  const linkedPayments = linkedOrder.paymentAttempts.filter(
    (payment) => payment.id === access.commercialPaymentAttemptId
  );
  if (linkedPayments.length !== 1 || linkedPayments[0]?.status !== "PAID" ||
    linkedOrder.paymentAttempts.some((payment) =>
      (payment.status === "CREATED" || payment.status === "PENDING") &&
      payment.id !== access.commercialPaymentAttemptId
    )) {
    return state("support_required");
  }

  if (!attempt) {
    if (access.attemptsAvailable === 0) return state("support_required");
    if (access.startDeadlineAt.getTime() <= now.getTime()) {
      return state("start_window_expired");
    }
    return state("access_unstarted");
  }

  if (attempt.userId !== user.id || attempt.testId !== snapshot.testId ||
    attempt.accessId !== access.id || access.attemptsAvailable !== 0) {
    return state("support_required");
  }
  if (attempt.status === "STARTED") return state("attempt_active");
  if (attempt.status === "COMPLETED" || attempt.status === "EXPIRED") {
    return terminalProjectionIsReadable(
      attempt,
      snapshot.testId,
      product.resultRetentionDays,
      now
    ) ? state("result_available") : state("support_required");
  }
  return state("support_required");
}

export function createRecoveryStateResolver(input: {
  client: PrismaClient;
  productCode: string;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());

  return async function resolveState(scope: {
    emailNormalized: string;
    commercialProductId: string;
    testId: string;
  }): Promise<RecoveryStateResponse> {
    const product = await input.client.commercialProduct.findUnique({
      where: { id: scope.commercialProductId },
      select: {
        id: true,
        code: true,
        testId: true,
        attemptLimit: true,
        resultRetentionDays: true,
        test: { select: { id: true, examMode: true, deletedAt: true } }
      }
    });
    if (product && product.code !== input.productCode) {
      throw new RecoveryStateResolverError("SCOPE_NOT_ALLOWED");
    }
    if (product && (product.id !== scope.commercialProductId || product.testId !== scope.testId ||
      product.test.id !== scope.testId)) {
      throw new RecoveryStateResolverError("SCOPE_NOT_ALLOWED");
    }

    const [users, orders] = await Promise.all([
      input.client.user.findMany({
        where: { email: scope.emailNormalized },
        select: { id: true, role: true, deletedAt: true },
        take: 2
      }),
      input.client.commercialOrder.findMany({
        where: {
          commercialProductId: scope.commercialProductId,
          emailNormalized: scope.emailNormalized
        },
        select: {
          id: true,
          commercialProductId: true,
          testIdSnapshot: true,
          emailNormalized: true,
          status: true,
          paymentAttempts: { select: { id: true, status: true } }
        }
      })
    ]);

    const userId = users[0]?.id;
    const orderIds = orders.map((order) => order.id);
    const accessOr: Prisma.AccessWhereInput[] = [];
    if (userId) {
      accessOr.push(
        { userId, testId: scope.testId },
        { userId, commercialProductId: scope.commercialProductId }
      );
    }
    if (orderIds.length > 0) accessOr.push({ commercialOrderId: { in: orderIds } });
    const accesses = accessOr.length === 0 ? [] : await input.client.access.findMany({
      where: { OR: accessOr },
      select: {
        id: true,
        userId: true,
        testId: true,
        source: true,
        attemptsTotal: true,
        attemptsAvailable: true,
        expiresAt: true,
        revokedAt: true,
        commercialProductId: true,
        commercialOrderId: true,
        commercialPaymentAttemptId: true,
        grantedAt: true,
        startDeadlineAt: true
      },
      take: 2
    });

    const accessIds = accesses.map((access) => access.id);
    const attemptOr: Prisma.AttemptWhereInput[] = [];
    if (accessIds.length > 0) attemptOr.push({ accessId: { in: accessIds } });
    if (userId) attemptOr.push({ userId, testId: scope.testId });
    const attempts = attemptOr.length === 0 ? [] : await input.client.attempt.findMany({
      where: { OR: attemptOr },
      select: {
        id: true,
        userId: true,
        testId: true,
        accessId: true,
        status: true,
        finishedAt: true,
        durationSeconds: true,
        rawScore: true,
        maxRawScore: true,
        percent: true,
        testSnapshot: true
      },
      take: 2
    });

    return resolveRecoveryStateSnapshot({
      ...scope,
      product,
      users,
      orders,
      accesses,
      attempts
    }, clock());
  };
}
