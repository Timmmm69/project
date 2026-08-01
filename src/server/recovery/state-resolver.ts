import {
  Prisma,
  type AccessSource,
  type AttemptStatus,
  type CommercialOrderStatus,
  type CommercialPaymentAttemptStatus,
  type PrismaClient,
  type TestStatus,
  type UserRole
} from "@prisma/client";
import {
  COMMERCIAL_CURRENCY,
  COMMERCIAL_PRICE_MINOR
} from "@/lib/commercial/config";
import {
  canOpenNewPaymentAttempt,
  isActivePaymentAttempt,
  isTerminalPaymentAttempt
} from "@/lib/commercial/state-machine";
import { z } from "zod";

const AUTHENTIC_DURATION_MINUTES = 120;
const AUTHENTIC_MAX_RAW_SCORE = 80;
const AUTHENTIC_QUESTION_COUNT = 40;
const RESULT_RETENTION_DAYS = 365;

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
  priceMinor: number;
  currency: string;
  isActive: boolean;
  test: Readonly<{
    id: string;
    slug?: string;
    examMode: string;
    status: TestStatus;
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
  amountMinor: number;
  currency: string;
  paidAt: Date | null;
  createdAt: Date;
}>;

type OrderCandidate = Readonly<{
  id: string;
  commercialProductId: string;
  testIdSnapshot: string;
  emailNormalized: string;
  status: CommercialOrderStatus;
  priceMinor: number;
  currency: string;
  paidAt: Date | null;
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
  startedAt: Date;
  finishedAt: Date | null;
  durationSeconds: number | null;
  rawScore: number | null;
  maxRawScore: number | null;
  percent: unknown;
  testSnapshot: Prisma.JsonValue;
}>;

export type RecoveryStateSnapshot = Readonly<{
  emailNormalized: string;
  configuredProductCode: string;
  commercialProductId: string;
  testId: string;
  product: ProductCandidate | null;
  users: readonly UserCandidate[];
  orders: readonly OrderCandidate[];
  accesses: readonly AccessCandidate[];
  attempts: readonly AttemptCandidate[];
}>;

type RecoveryContinuationScope = Readonly<{
  userId: string;
  commercialProductId: string;
  testId: string;
  testSlug: string;
  accessId: string;
}>;

export type RecoveryContinuationAuthority =
  | (RecoveryContinuationScope & Readonly<{ state: "access_unstarted" }>)
  | (RecoveryContinuationScope & Readonly<{
      state: "attempt_active" | "result_available";
      attemptId: string;
    }>);

export type RecoveryStateResolution = Readonly<{
  response: RecoveryStateResponse;
  authority: RecoveryContinuationAuthority | null;
}>;

const terminalSnapshotQuestionSchema = z.object({
  snapshotQuestionId: z.string().trim().min(1),
  orderIndex: z.number().int().nonnegative(),
  questionType: z.enum(["multi_select_five", "short_answer_token"]),
  points: z.number().int().positive()
}).passthrough();

const terminalSnapshotSchema = z.object({
  testId: z.string().min(1),
  subject: z.literal("russian"),
  mode: z.enum(["training", "ce_ct"]),
  examMode: z.literal("rikz_russian_2026"),
  durationMinutes: z.literal(AUTHENTIC_DURATION_MINUTES),
  maxRawScore: z.literal(AUTHENTIC_MAX_RAW_SCORE),
  questions: z.array(terminalSnapshotQuestionSchema).length(AUTHENTIC_QUESTION_COUNT)
}).passthrough();

export type RecoveryStateSnapshotReadStage = "PRODUCT_READ" | "ACCESSES_READ";

type RecoveryStateSnapshotReadHook = (input: Readonly<{
  stage: RecoveryStateSnapshotReadStage;
  transaction: Prisma.TransactionClient;
}>) => Promise<void>;

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

function isTerminalNonPaidPayment(status: CommercialPaymentAttemptStatus) {
  return isTerminalPaymentAttempt(status) && status !== "PAID";
}

function terminalOrderAllowsFreshCheckout(order: OrderCandidate, snapshot: RecoveryStateSnapshot) {
  if (order.commercialProductId !== snapshot.commercialProductId ||
    order.testIdSnapshot !== snapshot.testId ||
    order.emailNormalized !== snapshot.emailNormalized ||
    order.priceMinor !== COMMERCIAL_PRICE_MINOR || order.currency !== COMMERCIAL_CURRENCY ||
    order.paidAt !== null || order.status === "PAID" ||
    order.status === "CREATED" || order.status === "PENDING" ||
    !canOpenNewPaymentAttempt(order.status) || order.paymentAttempts.length === 0) {
    return false;
  }

  const paymentIds = new Set<string>();
  for (const payment of order.paymentAttempts) {
    if (paymentIds.has(payment.id) || isActivePaymentAttempt(payment.status) ||
      !isTerminalNonPaidPayment(payment.status) || payment.paidAt !== null ||
      payment.amountMinor !== order.priceMinor || payment.currency !== order.currency) {
      return false;
    }
    paymentIds.add(payment.id);
  }

  const latestPayment = [...order.paymentAttempts].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
  ).at(-1);
  return latestPayment?.status === order.status;
}

function freshCheckoutIsEligible(snapshot: RecoveryStateSnapshot, product: ProductCandidate) {
  if (!product.isActive || product.priceMinor !== COMMERCIAL_PRICE_MINOR ||
    product.currency !== COMMERCIAL_CURRENCY || product.test.status !== "PUBLISHED") {
    return false;
  }
  return snapshot.orders.every((order) => terminalOrderAllowsFreshCheckout(order, snapshot));
}

function terminalProjectionIsReadable(
  attempt: AttemptCandidate,
  testId: string,
  resultRetentionDays: number,
  now: Date
) {
  if (resultRetentionDays !== RESULT_RETENTION_DAYS || !attempt.finishedAt ||
    attempt.finishedAt.getTime() > now.getTime() || attempt.durationSeconds === null ||
    attempt.rawScore === null || attempt.maxRawScore !== AUTHENTIC_MAX_RAW_SCORE ||
    attempt.rawScore < 0 || attempt.rawScore > attempt.maxRawScore || attempt.percent === null) {
    return false;
  }

  const snapshot = terminalSnapshotSchema.safeParse(attempt.testSnapshot);
  if (!snapshot.success || snapshot.data.testId !== testId) return false;

  const snapshotQuestionIds = new Set<string>();
  const snapshotOrderIndexes = new Set<number>();
  let snapshotPoints = 0;
  for (const question of snapshot.data.questions) {
    if (snapshotQuestionIds.has(question.snapshotQuestionId) ||
      snapshotOrderIndexes.has(question.orderIndex)) {
      return false;
    }
    snapshotQuestionIds.add(question.snapshotQuestionId);
    snapshotOrderIndexes.add(question.orderIndex);
    snapshotPoints += question.points;
  }
  if (snapshotPoints !== snapshot.data.maxRawScore ||
    attempt.maxRawScore !== snapshot.data.maxRawScore) {
    return false;
  }

  try {
    const persistedPercent = new Prisma.Decimal(String(attempt.percent));
    const expectedPercent = new Prisma.Decimal(
      Math.round((attempt.rawScore / attempt.maxRawScore) * 10_000)
    ).dividedBy(100);
    if (!persistedPercent.equals(expectedPercent)) return false;
  } catch {
    return false;
  }

  const elapsedMs = attempt.finishedAt.getTime() - attempt.startedAt.getTime();
  const timerDurationMs = snapshot.data.durationMinutes * 60 * 1_000;
  const timerDeadline = attempt.startedAt.getTime() + timerDurationMs;
  if (elapsedMs < 0 || elapsedMs > timerDurationMs ||
    attempt.durationSeconds !== Math.floor(elapsedMs / 1_000)) {
    return false;
  }
  if (attempt.status === "COMPLETED" && attempt.finishedAt.getTime() >= timerDeadline) {
    return false;
  }
  if (attempt.status === "EXPIRED" &&
    (attempt.finishedAt.getTime() !== timerDeadline ||
      attempt.durationSeconds !== snapshot.data.durationMinutes * 60)) {
    return false;
  }

  const retentionEndsAt = new Date(attempt.finishedAt);
  retentionEndsAt.setUTCDate(retentionEndsAt.getUTCDate() + RESULT_RETENTION_DAYS);
  return now.getTime() < retentionEndsAt.getTime();
}

export function resolveRecoveryStateSnapshot(
  snapshot: RecoveryStateSnapshot,
  now: Date
): RecoveryStateResponse {
  const product = snapshot.product;
  if (!product || product.id !== snapshot.commercialProductId ||
    product.code !== snapshot.configuredProductCode ||
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
    if (attempt || !freshCheckoutIsEligible(snapshot, product)) {
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
    linkedOrder.emailNormalized !== snapshot.emailNormalized ||
    linkedOrder.priceMinor !== COMMERCIAL_PRICE_MINOR ||
    linkedOrder.currency !== COMMERCIAL_CURRENCY || !linkedOrder.paidAt) {
    return state("support_required");
  }
  const linkedPayments = linkedOrder.paymentAttempts.filter(
    (payment) => payment.id === access.commercialPaymentAttemptId
  );
  if (linkedPayments.length !== 1 || linkedPayments[0]?.status !== "PAID" ||
    linkedPayments[0].amountMinor !== linkedOrder.priceMinor ||
    linkedPayments[0].currency !== linkedOrder.currency || !linkedPayments[0].paidAt ||
    linkedOrder.paymentAttempts.some((payment) =>
      (payment.status === "CREATED" || payment.status === "PENDING" || payment.status === "PAID") &&
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

async function loadRecoveryStateSnapshot(input: {
  transaction: Prisma.TransactionClient;
  productCode: string;
  scope: {
    emailNormalized: string;
    commercialProductId: string;
    testId: string;
  };
  snapshotReadHook?: RecoveryStateSnapshotReadHook;
}): Promise<RecoveryStateSnapshot> {
  const { transaction, scope } = input;
  const product = await transaction.commercialProduct.findUnique({
    where: { id: scope.commercialProductId },
    select: {
      id: true,
      code: true,
      testId: true,
      attemptLimit: true,
      resultRetentionDays: true,
      priceMinor: true,
      currency: true,
      isActive: true,
      test: { select: { id: true, slug: true, examMode: true, status: true, deletedAt: true } }
    }
  });
  await input.snapshotReadHook?.({ stage: "PRODUCT_READ", transaction });
  if (product && product.code !== input.productCode) {
    throw new RecoveryStateResolverError("SCOPE_NOT_ALLOWED");
  }
  if (product && (product.id !== scope.commercialProductId || product.testId !== scope.testId ||
    product.test.id !== scope.testId)) {
    throw new RecoveryStateResolverError("SCOPE_NOT_ALLOWED");
  }

  const [users, orders] = await Promise.all([
    transaction.user.findMany({
      where: { email: scope.emailNormalized },
      select: { id: true, role: true, deletedAt: true },
      take: 2
    }),
    transaction.commercialOrder.findMany({
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
        priceMinor: true,
        currency: true,
        paidAt: true,
        paymentAttempts: {
          select: {
            id: true,
            status: true,
            amountMinor: true,
            currency: true,
            paidAt: true,
            createdAt: true
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        }
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
  const accesses = accessOr.length === 0 ? [] : await transaction.access.findMany({
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
  await input.snapshotReadHook?.({ stage: "ACCESSES_READ", transaction });

  const accessIds = accesses.map((access) => access.id);
  const attemptOr: Prisma.AttemptWhereInput[] = [];
  if (accessIds.length > 0) attemptOr.push({ accessId: { in: accessIds } });
  if (userId) attemptOr.push({ userId, testId: scope.testId });
  const attempts = attemptOr.length === 0 ? [] : await transaction.attempt.findMany({
    where: { OR: attemptOr },
    select: {
      id: true,
      userId: true,
      testId: true,
      accessId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      durationSeconds: true,
      rawScore: true,
      maxRawScore: true,
      percent: true,
      testSnapshot: true
    },
    take: 2
  });

  return {
    ...scope,
    configuredProductCode: input.productCode,
    product,
    users,
    orders,
    accesses,
    attempts
  };
}

export async function resolveRecoveryStateInTransaction(input: {
  transaction: Prisma.TransactionClient;
  productCode: string;
  scope: {
    emailNormalized: string;
    commercialProductId: string;
    testId: string;
  };
  now: Date;
  /** @internal Deterministic PostgreSQL snapshot synchronization for tests only. */
  snapshotReadHook?: RecoveryStateSnapshotReadHook;
}): Promise<RecoveryStateResolution> {
  const snapshot = await loadRecoveryStateSnapshot({
    transaction: input.transaction,
    productCode: input.productCode,
    scope: input.scope,
    snapshotReadHook: input.snapshotReadHook
  });
  const response = resolveRecoveryStateSnapshot(snapshot, input.now);
  if (response.nextAction !== "CONTINUE") {
    return { response, authority: null };
  }

  const product = snapshot.product;
  const user = uniqueById(snapshot.users)[0];
  const access = uniqueById(snapshot.accesses)[0];
  const attempt = uniqueById(snapshot.attempts)[0];
  if (!product || !product.test.slug || !user || !access) {
    return { response, authority: null };
  }
  const scope = {
    userId: user.id,
    commercialProductId: product.id,
    testId: product.test.id,
    testSlug: product.test.slug,
    accessId: access.id
  };
  if (response.state === "access_unstarted") {
    return { response, authority: { state: response.state, ...scope } };
  }
  if (!attempt || (response.state !== "attempt_active" && response.state !== "result_available")) {
    return { response, authority: null };
  }
  return {
    response,
    authority: { state: response.state, ...scope, attemptId: attempt.id }
  };
}

export function createRecoveryStateResolver(input: {
  client: PrismaClient;
  productCode: string;
  clock?: () => Date;
  /** @internal Deterministic PostgreSQL snapshot synchronization for tests only. */
  snapshotReadHook?: RecoveryStateSnapshotReadHook;
}) {
  const clock = input.clock ?? (() => new Date());

  return async function resolveState(scope: {
    emailNormalized: string;
    commercialProductId: string;
    testId: string;
  }): Promise<RecoveryStateResponse> {
    const now = clock();
    return input.client.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const resolution = await resolveRecoveryStateInTransaction({
        transaction,
        productCode: input.productCode,
        scope,
        now,
        snapshotReadHook: input.snapshotReadHook
      });
      return resolution.response;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
  };
}
