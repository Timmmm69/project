import { cookies } from "next/headers";
import type {
  Prisma,
  PrismaClient,
  VerifiedStudentSessionSource
} from "@prisma/client";
import {
  parseVerifiedCommercialSessionMode,
  parseVerifiedStudentSessionConfig,
  type VerifiedCommercialSessionMode,
  type VerifiedStudentSessionConfig
} from "@/server/auth/verified-student-session/config";
import {
  createVerifiedStudentSessionService,
  type ResolveVerifiedStudentSessionResult
} from "@/server/auth/verified-student-session/service";
import { VERIFIED_STUDENT_SESSION_COOKIE } from "@/server/auth/verified-student-session/cookies";
import { isAuthenticRikzRussianExamMode } from "@/server/auth/verified-student-session/exam-mode";
import { prisma } from "@/server/db/client";

export type VerifiedDestination = "PRE" | "ATT" | "RES";

export type VerifiedDestinationTarget =
  | Readonly<{ destination: "PRE"; testId: string }>
  | Readonly<{ destination: "PRE"; testSlug: string }>
  | Readonly<{ destination: "ATT" | "RES"; attemptId: string }>;

type DestinationClassification = "AUTHENTIC" | "GENERIC" | "UNKNOWN" | "NOT_EVALUATED";

export type VerifiedDestinationAuthorizationContext = Readonly<{
  destination: VerifiedDestination;
  userId: string;
  userEmail: string;
  commercialProductId: string;
  testId: string;
  accessId: string;
  attemptId: string | null;
  clearRecoveryCookie: boolean;
}>;

export type VerifiedDestinationAuthorization =
  | Readonly<{
      status: "LEGACY";
      mode: "off" | "shadow" | "enforce";
      classification: DestinationClassification;
      shadowResult?: "AUTHORIZED" | "VERIFIED_SESSION_REQUIRED" | "VERIFIED_SCOPE_NOT_ALLOWED";
    }>
  | Readonly<{
      status: "AUTHORIZED";
      mode: "enforce";
      classification: "AUTHENTIC";
      context: VerifiedDestinationAuthorizationContext;
    }>
  | Readonly<{
      status: "REJECTED";
      mode: "enforce";
      classification: "AUTHENTIC" | "UNKNOWN";
      code: "VERIFIED_SESSION_REQUIRED" | "VERIFIED_SCOPE_NOT_ALLOWED";
    }>;

export type VerifiedStudentEntryNextAction = "OPEN_PRE" | "OPEN_ATTEMPT" | "OPEN_RESULT";

export type VerifiedStudentEntryTarget =
  | Readonly<{ testId: string }>
  | Readonly<{ testSlug: string }>;

export type VerifiedStudentEntryResolution =
  | Readonly<{
      status: "LEGACY";
      mode: "off" | "shadow" | "enforce";
      classification: DestinationClassification;
      shadowResult?: "AUTHORIZED" | "VERIFIED_SESSION_REQUIRED" | "VERIFIED_SCOPE_NOT_ALLOWED";
    }>
  | Readonly<{
      status: "AUTHORIZED";
      mode: "enforce";
      classification: "AUTHENTIC";
      nextAction: VerifiedStudentEntryNextAction;
      nextUrl: string;
      context: VerifiedDestinationAuthorizationContext;
    }>
  | Readonly<{
      status: "REJECTED";
      mode: "enforce";
      classification: "AUTHENTIC" | "UNKNOWN";
      code: "VERIFIED_SESSION_REQUIRED" | "VERIFIED_SCOPE_NOT_ALLOWED";
    }>;

type DestinationReadClient = Pick<
  Prisma.TransactionClient,
  "test" | "attempt" | "access" | "verifiedRecoverySession"
>;

type ResolvedSession = Extract<ResolveVerifiedStudentSessionResult, { status: "RESOLVED" }>;
type GuardEvaluation =
  | Readonly<{ status: "AUTHORIZED"; context: VerifiedDestinationAuthorizationContext }>
  | Readonly<{ status: "VERIFIED_SESSION_REQUIRED" | "VERIFIED_SCOPE_NOT_ALLOWED" }>;

type EntryEvaluation =
  | Readonly<{
      status: "AUTHORIZED";
      nextAction: VerifiedStudentEntryNextAction;
      nextUrl: string;
      context: VerifiedDestinationAuthorizationContext;
    }>
  | Readonly<{ status: "VERIFIED_SESSION_REQUIRED" | "VERIFIED_SCOPE_NOT_ALLOWED" }>;

type PreTarget = Readonly<{
  kind: "PRE";
  classification: "AUTHENTIC" | "GENERIC";
  test: {
    id: string;
    slug: string;
    examMode: string;
    commercialProducts: readonly { id: string; testId: string }[];
  };
}>;

type AttemptTarget = Readonly<{
  kind: "ATTEMPT";
  classification: "AUTHENTIC" | "GENERIC";
  attempt: {
    id: string;
    userId: string;
    testId: string;
    accessId: string;
    status: string;
    testSnapshot: Prisma.JsonValue;
    test: {
      id: string;
      examMode: string;
      commercialProducts: readonly { id: string; testId: string }[];
    };
    access: {
      id: string;
      userId: string;
      testId: string;
      source: string;
      commercialProductId: string | null;
      commercialOrderId: string | null;
      commercialPaymentAttemptId: string | null;
      attemptsAvailable: number;
      revokedAt: Date | null;
      expiresAt: Date;
      user: {
        id: string;
        email: string;
        role: string;
        deletedAt: Date | null;
      };
      commercialProduct: { id: string; testId: string } | null;
    };
  };
}>;

type LoadedTarget = PreTarget | AttemptTarget | null;

export type VerifiedStudentEntryState = Readonly<{
  id: string;
  userId: string;
  testId: string;
  source: string;
  commercialProductId: string | null;
  attemptsAvailable: number;
  revokedAt: Date | null;
  expiresAt: Date;
  startDeadlineAt: Date | null;
  user: {
    id: string;
    email: string;
    role: string;
    deletedAt: Date | null;
  };
  commercialProduct: { id: string; testId: string } | null;
  attempts: readonly {
    id: string;
    userId: string;
    testId: string;
    accessId: string;
    status: string;
  }[];
}>;

export type VerifiedDestinationGuardDependencies = Readonly<{
  client?: PrismaClient;
  transaction?: Prisma.TransactionClient;
  environment?: Record<string, string | undefined>;
  verifiedSessionConfig?: VerifiedStudentSessionConfig;
  readCookie?: (request?: Request) => Promise<string | null>;
  resolveSession?: (
    rawToken: string,
    transaction?: Prisma.TransactionClient
  ) => Promise<ResolveVerifiedStudentSessionResult>;
  loadTarget?: (
    client: DestinationReadClient,
    target: VerifiedDestinationTarget
  ) => Promise<LoadedTarget>;
  loadEntryState?: (
    client: DestinationReadClient,
    scope: ResolvedSession["scope"]
  ) => Promise<VerifiedStudentEntryState | null>;
  clock?: () => Date;
}>;

const allowedSources = new Set<VerifiedStudentSessionSource>([
  "COMMERCIAL_ORDER_CLAIM",
  "ACCESS_CODE",
  "EMAIL_OTP_RECOVERY"
]);

function readNamedCookieHeader(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .flatMap((part) => {
      const separator = part.indexOf("=");
      return separator > 0 && part.slice(0, separator) === name
        ? [part.slice(separator + 1)]
        : [];
    });
  return values.length === 1 && values[0] ? values[0] : null;
}

async function readVerifiedCookie(request?: Request) {
  if (request) {
    return readNamedCookieHeader(request, VERIFIED_STUDENT_SESSION_COOKIE);
  }
  return (await cookies()).get(VERIFIED_STUDENT_SESSION_COOKIE)?.value ?? null;
}

function snapshotExamMode(value: Prisma.JsonValue) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const examMode = (value as Record<string, unknown>).examMode;
  return typeof examMode === "string" ? examMode : null;
}

function attemptIsAuthentic(attempt: AttemptTarget["attempt"]) {
  return isAuthenticRikzRussianExamMode(attempt.test.examMode, "CURRENT_TEST") ||
    isAuthenticRikzRussianExamMode(
      snapshotExamMode(attempt.testSnapshot),
      "ATTEMPT_SNAPSHOT"
    );
}

async function loadDestinationTarget(
  client: DestinationReadClient,
  target: VerifiedDestinationTarget
): Promise<LoadedTarget> {
  if (target.destination === "PRE") {
    const tests = await client.test.findMany({
      where: "testId" in target ? { id: target.testId } : { slug: target.testSlug },
      take: 2,
      select: {
        id: true,
        slug: true,
        examMode: true,
        commercialProducts: { select: { id: true, testId: true } }
      }
    });
    if (tests.length !== 1) return null;
    const test = tests[0];
    return {
      kind: "PRE",
      classification: isAuthenticRikzRussianExamMode(test.examMode, "CURRENT_TEST")
        ? "AUTHENTIC"
        : "GENERIC",
      test
    };
  }

  const attempt = await client.attempt.findUnique({
    where: { id: target.attemptId },
    select: {
      id: true,
      userId: true,
      testId: true,
      accessId: true,
      status: true,
      testSnapshot: true,
      test: {
        select: {
          id: true,
          examMode: true,
          commercialProducts: { select: { id: true, testId: true } }
        }
      },
      access: {
        select: {
          id: true,
          userId: true,
          testId: true,
          source: true,
          commercialProductId: true,
          commercialOrderId: true,
          commercialPaymentAttemptId: true,
          attemptsAvailable: true,
          revokedAt: true,
          expiresAt: true,
          user: { select: { id: true, email: true, role: true, deletedAt: true } },
          commercialProduct: { select: { id: true, testId: true } }
        }
      }
    }
  });
  if (!attempt) return null;
  const loaded: AttemptTarget["attempt"] = attempt;
  return {
    kind: "ATTEMPT",
    classification: attemptIsAuthentic(loaded) ? "AUTHENTIC" : "GENERIC",
    attempt: loaded
  };
}

function exactAttemptScopeMatches(
  target: AttemptTarget,
  session: ResolvedSession
) {
  const { attempt } = target;
  const { access, test } = attempt;
  const attemptsAvailable = access.attemptsAvailable ?? 0;
  return attempt.id.length > 0 &&
    attempt.userId === session.scope.userId &&
    attempt.testId === session.scope.testId &&
    attempt.accessId === session.scope.accessId &&
    test.id === session.scope.testId &&
    test.examMode === "RIKZ_RUSSIAN_2026" &&
    snapshotExamMode(attempt.testSnapshot) === "rikz_russian_2026" &&
    test.commercialProducts.some((product) =>
      product.id === session.scope.commercialProductId && product.testId === session.scope.testId
    ) &&
    access.id === session.scope.accessId &&
    access.userId === session.scope.userId &&
    access.testId === session.scope.testId &&
    access.source === "COMMERCIAL" &&
    access.commercialProductId === session.scope.commercialProductId &&
    attemptsAvailable === 0 &&
    access.revokedAt === null &&
    access.user.id === session.scope.userId &&
    access.user.role === "STUDENT" &&
    access.user.deletedAt === null &&
    access.commercialProduct?.id === session.scope.commercialProductId &&
    access.commercialProduct.testId === session.scope.testId;
}

async function recoveryCleanupIsProven(
  client: DestinationReadClient,
  session: ResolvedSession
) {
  if (session.source !== "EMAIL_OTP_RECOVERY") return true;
  const recovery = await client.verifiedRecoverySession.findUnique({
    where: { id: session.sourceReferenceId },
    select: {
      status: true,
      revokedAt: true,
      revocationCode: true,
      continuationVerifiedStudentSessionId: true,
      continuationOperationId: true,
      continuedAt: true
    }
  });
  return recovery?.status === "REVOKED" &&
    recovery.revocationCode === "CONTINUED" &&
    recovery.continuationVerifiedStudentSessionId === session.sessionId &&
    recovery.continuationOperationId === session.issuanceOperationId &&
    recovery.revokedAt !== null &&
    recovery.continuedAt !== null &&
    recovery.revokedAt.getTime() === recovery.continuedAt.getTime();
}

async function exactPreContext(
  client: DestinationReadClient,
  target: PreTarget,
  session: ResolvedSession,
  now: Date
): Promise<VerifiedDestinationAuthorizationContext | null> {
  const access = await client.access.findUnique({
    where: { id: session.scope.accessId },
    select: {
      id: true,
      userId: true,
      testId: true,
      source: true,
      commercialProductId: true,
      attemptsAvailable: true,
      revokedAt: true,
      expiresAt: true,
      startDeadlineAt: true,
      user: { select: { id: true, email: true, role: true, deletedAt: true } },
      commercialProduct: { select: { id: true, testId: true } },
      attempts: {
        take: 2,
        orderBy: { createdAt: "asc" },
        select: { id: true }
      }
    }
  });
  const attemptsAvailable = access?.attemptsAvailable ?? 1;
  const attempts = access?.attempts ?? [];
  const startDeadlineAt = access?.startDeadlineAt ?? null;
  const matches = target.test.id === session.scope.testId &&
    target.test.examMode === "RIKZ_RUSSIAN_2026" &&
    target.test.commercialProducts.some((product) =>
      product.id === session.scope.commercialProductId && product.testId === session.scope.testId
    ) &&
    access?.id === session.scope.accessId &&
    access.userId === session.scope.userId &&
    access.testId === session.scope.testId &&
    access.source === "COMMERCIAL" &&
    access.commercialProductId === session.scope.commercialProductId &&
    access.revokedAt === null &&
    now.getTime() < access.expiresAt.getTime() &&
    (startDeadlineAt === null || now.getTime() < startDeadlineAt.getTime()) &&
    attemptsAvailable === 1 &&
    attempts.length === 0 &&
    access.user.id === session.scope.userId &&
    access.user.role === "STUDENT" &&
    access.user.deletedAt === null &&
    access.commercialProduct?.id === session.scope.commercialProductId &&
    access.commercialProduct.testId === session.scope.testId;
  if (!matches || !access || !await recoveryCleanupIsProven(client, session)) return null;
  return {
    destination: "PRE",
    userId: access.user.id,
    userEmail: access.user.email,
    commercialProductId: session.scope.commercialProductId,
    testId: session.scope.testId,
    accessId: session.scope.accessId,
    attemptId: null,
    clearRecoveryCookie: session.source === "EMAIL_OTP_RECOVERY"
  };
}

async function exactAttemptContext(
  client: DestinationReadClient,
  target: AttemptTarget,
  destination: "ATT" | "RES",
  session: ResolvedSession,
  now: Date
): Promise<VerifiedDestinationAuthorizationContext | null> {
  void now;
  if (!exactAttemptScopeMatches(target, session)) return null;
  if (destination === "ATT" && target.attempt.status !== "STARTED") {
    return null;
  }
  if (destination === "RES" &&
    target.attempt.status !== "COMPLETED" && target.attempt.status !== "EXPIRED") {
    return null;
  }
  if (!await recoveryCleanupIsProven(client, session)) return null;
  return {
    destination,
    userId: target.attempt.access.user.id,
    userEmail: target.attempt.access.user.email,
    commercialProductId: session.scope.commercialProductId,
    testId: session.scope.testId,
    accessId: session.scope.accessId,
    attemptId: target.attempt.id,
    clearRecoveryCookie: session.source === "EMAIL_OTP_RECOVERY"
  };
}

async function evaluateAuthenticTarget(input: {
  client: DestinationReadClient;
  loadedTarget: LoadedTarget;
  target: VerifiedDestinationTarget;
  rawToken: string | null;
  resolveSession: (
    rawToken: string,
    transaction?: Prisma.TransactionClient
  ) => Promise<ResolveVerifiedStudentSessionResult>;
  transaction?: Prisma.TransactionClient;
  now: Date;
}): Promise<GuardEvaluation> {
  if (!input.rawToken) return { status: "VERIFIED_SESSION_REQUIRED" };
  const resolved = await input.resolveSession(input.rawToken, input.transaction);
  if (resolved.status !== "RESOLVED") {
    return { status: "VERIFIED_SESSION_REQUIRED" };
  }
  if (!allowedSources.has(resolved.source)) {
    return { status: "VERIFIED_SCOPE_NOT_ALLOWED" };
  }
  if (!input.loadedTarget) {
    return { status: "VERIFIED_SCOPE_NOT_ALLOWED" };
  }
  const context = input.loadedTarget.kind === "PRE"
    ? await exactPreContext(input.client, input.loadedTarget, resolved, input.now)
    : await exactAttemptContext(
        input.client,
        input.loadedTarget,
        input.target.destination === "RES" ? "RES" : "ATT",
        resolved,
        input.now
      );
  return context
    ? { status: "AUTHORIZED", context }
    : { status: "VERIFIED_SCOPE_NOT_ALLOWED" };
}

async function loadVerifiedStudentEntryState(
  client: DestinationReadClient,
  scope: ResolvedSession["scope"]
): Promise<VerifiedStudentEntryState | null> {
  return client.access.findUnique({
    where: { id: scope.accessId },
    select: {
      id: true,
      userId: true,
      testId: true,
      source: true,
      commercialProductId: true,
      attemptsAvailable: true,
      revokedAt: true,
      expiresAt: true,
      startDeadlineAt: true,
      user: { select: { id: true, email: true, role: true, deletedAt: true } },
      commercialProduct: { select: { id: true, testId: true } },
      attempts: {
        take: 2,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          userId: true,
          testId: true,
          accessId: true,
          status: true
        }
      }
    }
  });
}

function exactEntryStateMatches(
  target: PreTarget,
  session: ResolvedSession,
  state: VerifiedStudentEntryState
) {
  return target.test.id === session.scope.testId &&
    target.test.examMode === "RIKZ_RUSSIAN_2026" &&
    target.test.commercialProducts.some((product) =>
      product.id === session.scope.commercialProductId && product.testId === session.scope.testId
    ) &&
    state.id === session.scope.accessId &&
    state.userId === session.scope.userId &&
    state.testId === session.scope.testId &&
    state.source === "COMMERCIAL" &&
    state.commercialProductId === session.scope.commercialProductId &&
    state.revokedAt === null &&
    state.user.id === session.scope.userId &&
    state.user.role === "STUDENT" &&
    state.user.deletedAt === null &&
    state.commercialProduct?.id === session.scope.commercialProductId &&
    state.commercialProduct.testId === session.scope.testId;
}

function entryContext(
  session: ResolvedSession,
  state: VerifiedStudentEntryState,
  destination: VerifiedDestination,
  attemptId: string | null
): VerifiedDestinationAuthorizationContext {
  return {
    destination,
    userId: state.user.id,
    userEmail: state.user.email,
    commercialProductId: session.scope.commercialProductId,
    testId: session.scope.testId,
    accessId: session.scope.accessId,
    attemptId,
    clearRecoveryCookie: session.source === "EMAIL_OTP_RECOVERY"
  };
}

function exactEntryDecision(
  target: PreTarget,
  session: ResolvedSession,
  state: VerifiedStudentEntryState,
  now: Date
): Extract<EntryEvaluation, { status: "AUTHORIZED" }> | null {
  if (!exactEntryStateMatches(target, session, state) || state.attempts.length > 1) return null;

  const attempt = state.attempts[0] ?? null;
  if (attempt) {
    const exactAttempt = attempt.userId === session.scope.userId &&
      attempt.testId === session.scope.testId &&
      attempt.accessId === session.scope.accessId;
    if (!exactAttempt || state.attemptsAvailable !== 0) return null;
    if (attempt.status === "STARTED") {
      return {
        status: "AUTHORIZED",
        nextAction: "OPEN_ATTEMPT",
        nextUrl: `/attempts/${attempt.id}`,
        context: entryContext(session, state, "ATT", attempt.id)
      };
    }
    if (attempt.status === "COMPLETED" || attempt.status === "EXPIRED") {
      return {
        status: "AUTHORIZED",
        nextAction: "OPEN_RESULT",
        nextUrl: `/results/${attempt.id}`,
        context: entryContext(session, state, "RES", attempt.id)
      };
    }
    return null;
  }

  const startWindowOpen = now.getTime() < state.expiresAt.getTime() &&
    (state.startDeadlineAt === null || now.getTime() < state.startDeadlineAt.getTime());
  if (!startWindowOpen || state.attemptsAvailable !== 1) return null;
  return {
    status: "AUTHORIZED",
    nextAction: "OPEN_PRE",
    nextUrl: `/tests/${target.test.slug}`,
    context: entryContext(session, state, "PRE", null)
  };
}

async function evaluateAuthenticEntry(input: {
  client: DestinationReadClient;
  loadedTarget: LoadedTarget;
  rawToken: string | null;
  resolveSession: (
    rawToken: string,
    transaction?: Prisma.TransactionClient
  ) => Promise<ResolveVerifiedStudentSessionResult>;
  loadEntryState: (
    client: DestinationReadClient,
    scope: ResolvedSession["scope"]
  ) => Promise<VerifiedStudentEntryState | null>;
  transaction?: Prisma.TransactionClient;
  now: Date;
}): Promise<EntryEvaluation> {
  if (!input.rawToken) return { status: "VERIFIED_SESSION_REQUIRED" };
  const resolved = await input.resolveSession(input.rawToken, input.transaction);
  if (resolved.status !== "RESOLVED") return { status: "VERIFIED_SESSION_REQUIRED" };
  if (!allowedSources.has(resolved.source)) return { status: "VERIFIED_SCOPE_NOT_ALLOWED" };
  if (!input.loadedTarget || input.loadedTarget.kind !== "PRE") {
    return { status: "VERIFIED_SCOPE_NOT_ALLOWED" };
  }
  const state = await input.loadEntryState(input.client, resolved.scope);
  if (!state || !await recoveryCleanupIsProven(input.client, resolved)) {
    return { status: "VERIFIED_SCOPE_NOT_ALLOWED" };
  }
  return exactEntryDecision(input.loadedTarget, resolved, state, input.now) ??
    { status: "VERIFIED_SCOPE_NOT_ALLOWED" };
}

export async function resolveVerifiedStudentEntryDestination(
  target: VerifiedStudentEntryTarget,
  request?: Request,
  dependencies: VerifiedDestinationGuardDependencies = {}
): Promise<VerifiedStudentEntryResolution> {
  const environment = dependencies.environment ?? process.env;
  const mode: VerifiedCommercialSessionMode = dependencies.verifiedSessionConfig?.mode ??
    parseVerifiedCommercialSessionMode(environment.VERIFIED_COMMERCIAL_SESSION_MODE);
  if (mode === "off") {
    return { status: "LEGACY", mode, classification: "NOT_EVALUATED" };
  }

  const client = dependencies.client ?? prisma;
  const activeClient: DestinationReadClient = dependencies.transaction ?? client;
  const destinationTarget: VerifiedDestinationTarget = "testId" in target
    ? { destination: "PRE", testId: target.testId }
    : { destination: "PRE", testSlug: target.testSlug };
  let loadedTarget: LoadedTarget;
  try {
    loadedTarget = await (dependencies.loadTarget ?? loadDestinationTarget)(activeClient, destinationTarget);
  } catch (error) {
    if (mode === "shadow") return { status: "LEGACY", mode, classification: "UNKNOWN" };
    throw error;
  }
  if (loadedTarget?.classification === "GENERIC") {
    return { status: "LEGACY", mode, classification: "GENERIC" };
  }

  let evaluation: EntryEvaluation;
  try {
    const config = dependencies.verifiedSessionConfig ?? parseVerifiedStudentSessionConfig(environment);
    const service = dependencies.resolveSession
      ? null
      : createVerifiedStudentSessionService({ client, config });
    const resolveSession = dependencies.resolveSession ??
      ((rawToken: string, transaction?: Prisma.TransactionClient) =>
        service!.resolve(rawToken, transaction));
    evaluation = await evaluateAuthenticEntry({
      client: activeClient,
      loadedTarget,
      rawToken: await (dependencies.readCookie ?? readVerifiedCookie)(request),
      resolveSession,
      loadEntryState: dependencies.loadEntryState ?? loadVerifiedStudentEntryState,
      transaction: dependencies.transaction,
      now: (dependencies.clock ?? (() => new Date()))()
    });
  } catch (error) {
    if (mode === "shadow") {
      return {
        status: "LEGACY",
        mode,
        classification: loadedTarget?.classification ?? "UNKNOWN"
      };
    }
    throw error;
  }

  if (mode === "shadow") {
    return {
      status: "LEGACY",
      mode,
      classification: loadedTarget?.classification ?? "UNKNOWN",
      shadowResult: evaluation.status
    };
  }
  if (evaluation.status !== "AUTHORIZED") {
    return {
      status: "REJECTED",
      mode,
      classification: loadedTarget?.classification ?? "UNKNOWN",
      code: evaluation.status
    };
  }
  return {
    status: "AUTHORIZED",
    mode,
    classification: "AUTHENTIC",
    nextAction: evaluation.nextAction,
    nextUrl: evaluation.nextUrl,
    context: evaluation.context
  };
}

export async function authorizeVerifiedStudentDestination(
  target: VerifiedDestinationTarget,
  request?: Request,
  dependencies: VerifiedDestinationGuardDependencies = {}
): Promise<VerifiedDestinationAuthorization> {
  const environment = dependencies.environment ?? process.env;
  const mode: VerifiedCommercialSessionMode = dependencies.verifiedSessionConfig?.mode ??
    parseVerifiedCommercialSessionMode(environment.VERIFIED_COMMERCIAL_SESSION_MODE);
  if (mode === "off") {
    return { status: "LEGACY", mode, classification: "NOT_EVALUATED" };
  }

  const client = dependencies.client ?? prisma;
  const activeClient: DestinationReadClient = dependencies.transaction ?? client;
  let loadedTarget: LoadedTarget;
  try {
    loadedTarget = await (dependencies.loadTarget ?? loadDestinationTarget)(activeClient, target);
  } catch (error) {
    if (mode === "shadow") {
      return { status: "LEGACY", mode, classification: "UNKNOWN" };
    }
    throw error;
  }
  if (loadedTarget?.classification === "GENERIC") {
    return { status: "LEGACY", mode, classification: "GENERIC" };
  }

  let evaluation: GuardEvaluation;
  try {
    const config = dependencies.verifiedSessionConfig ?? parseVerifiedStudentSessionConfig(environment);
    const service = dependencies.resolveSession
      ? null
      : createVerifiedStudentSessionService({ client, config });
    const resolveSession = dependencies.resolveSession ??
      ((rawToken: string, transaction?: Prisma.TransactionClient) =>
        service!.resolve(rawToken, transaction));
    const rawToken = await (dependencies.readCookie ?? readVerifiedCookie)(request);
    evaluation = await evaluateAuthenticTarget({
      client: activeClient,
      loadedTarget,
      target,
      rawToken,
      resolveSession,
      transaction: dependencies.transaction,
      now: (dependencies.clock ?? (() => new Date()))()
    });
  } catch (error) {
    if (mode === "shadow") {
      return {
        status: "LEGACY",
        mode,
        classification: loadedTarget?.classification ?? "UNKNOWN"
      };
    }
    throw error;
  }

  if (mode === "shadow") {
    return {
      status: "LEGACY",
      mode,
      classification: loadedTarget?.classification ?? "UNKNOWN",
      shadowResult: evaluation.status
    };
  }
  if (evaluation.status !== "AUTHORIZED") {
    return {
      status: "REJECTED",
      mode,
      classification: loadedTarget?.classification ?? "UNKNOWN",
      code: evaluation.status
    };
  }
  return {
    status: "AUTHORIZED",
    mode,
    classification: "AUTHENTIC",
    context: evaluation.context
  };
}
