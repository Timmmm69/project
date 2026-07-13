import { randomUUID } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  RecoverySecurityEventCode,
  RecoverySecurityReasonCode,
  RecoveryVerificationOutcome,
  VerifiedRecoverySessionRevocationCode
} from "@prisma/client";
import { z } from "zod";
import { normalizedEmailSchema } from "@/lib/validation/email";
import type { EnabledRecoveryConfig, RecoveryConfig } from "@/server/recovery/config";
import {
  createEmailFingerprint,
  createRecoveryChallengeToken,
  createRecoveryOtpMac,
  createRecoverySessionToken,
  digestRecoveryChallengeToken,
  digestRecoverySessionToken,
  generateRecoveryOtp,
  RECOVERY_OTP_PATTERN,
  RecoveryCryptoError,
  secretDigestsEqual
} from "@/server/recovery/crypto";
import type { RecoveryMailer, RecoveryMailResult } from "@/server/recovery/mailer";
import { createRecoveryRateLimitService } from "@/server/recovery/rate-limit";

export const RECOVERY_OTP_TTL_MS = 10 * 60 * 1000;
export const RECOVERY_RESEND_COOLDOWN_MS = 60 * 1000;
export const RECOVERY_FAILED_VERIFY_LIMIT = 5;
export const RECOVERY_SESSION_ABSOLUTE_TTL_MS = 30 * 60 * 1000;
export const RECOVERY_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_SECURITY_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function recoveryOtpExpiresAt(issuedAt: Date) {
  return new Date(issuedAt.getTime() + RECOVERY_OTP_TTL_MS);
}

export function recoveryResendAvailableAt(issuedAt: Date) {
  return new Date(issuedAt.getTime() + RECOVERY_RESEND_COOLDOWN_MS);
}

export function recoverySessionExpiresAt(issuedAt: Date) {
  return new Date(issuedAt.getTime() + RECOVERY_SESSION_ABSOLUTE_TTL_MS);
}

export function isBeforeRecoveryExpiry(now: Date, expiresAt: Date) {
  return now.getTime() < expiresAt.getTime();
}

type Tx = Prisma.TransactionClient;
type Clock = () => Date;

export type RecoveryDomainServiceTestHooks = Readonly<{
  beforeRequestSubjectLock?: () => Promise<void>;
  beforeVerifyOperationLock?: () => Promise<void>;
  beforeVerifySubjectLock?: () => Promise<void>;
}>;

const noopRecoveryTestHook = async () => {};

export const NOOP_RECOVERY_DOMAIN_SERVICE_TEST_HOOKS = Object.freeze({
  beforeRequestSubjectLock: noopRecoveryTestHook,
  beforeVerifyOperationLock: noopRecoveryTestHook,
  beforeVerifySubjectLock: noopRecoveryTestHook
});

export type RecoverySourceFailureClassification =
  | "MALFORMED_OTP"
  | "MALFORMED_TOKEN"
  | "UNKNOWN_TOKEN"
  | "WRONG_OTP"
  | "REPLAY"
  | "EXPIRED"
  | "LOCKED"
  | "MATCH"
  | "OPERATION_CONFLICT";

export function isRecoverySourceVerificationFailure(
  classification: RecoverySourceFailureClassification
) {
  return classification === "MALFORMED_OTP"
    || classification === "MALFORMED_TOKEN"
    || classification === "UNKNOWN_TOKEN"
    || classification === "WRONG_OTP";
}

export function recoveryVerificationOperationLockKey(operationId: string) {
  return `acc01a-verify-operation:${operationId}`;
}

export function recoveryDomainServiceUsesTestHooks(config: RecoveryConfig) {
  return config.enabled && config.mailerMode === "test";
}

const operationIdSchema = z.string().uuid();
const sourceSchema = z.string().trim().min(1).max(1024);

export type RecoveryDomainServiceErrorCode =
  | "FEATURE_DISABLED"
  | "INVALID_EMAIL"
  | "INVALID_OPERATION_ID"
  | "INVALID_SOURCE"
  | "INVALID_OTP"
  | "PRODUCT_SCOPE_MISMATCH"
  | "PRODUCT_SCOPE_INVALID"
  | "DETERMINISTIC_OTP_FORBIDDEN";

export class RecoveryDomainServiceError extends Error {
  constructor(readonly code: RecoveryDomainServiceErrorCode) {
    super(`RECOVERY_DOMAIN_OPERATION_REJECTED:${code}`);
    this.name = "RecoveryDomainServiceError";
  }
}

export type RequestRecoveryChallengeInput = Readonly<{
  email: string;
  productCode: string;
  requestOperationId: string;
  source: string;
}>;

export type RequestRecoveryChallengeResult =
  | Readonly<{
      outcome: "CREATED";
      challengeId: string;
      rawChallengeToken: string;
      expiresAt: Date;
      resendAvailableAt: Date;
      correlationId: string;
      delivery: RecoveryMailResult;
    }>
  | Readonly<{
      outcome: "IDEMPOTENT_REPLAY";
      challengeId: string;
      expiresAt: Date;
      resendAvailableAt: Date;
      correlationId: string;
    }>
  | Readonly<{
      outcome: "IDEMPOTENCY_CONFLICT";
      correlationId: string;
    }>
  | Readonly<{
      outcome: "COOLDOWN";
      retryAfterSeconds: number;
      correlationId: string;
    }>
  | Readonly<{
      outcome: "RATE_LIMITED";
      safeCode: string;
      retryAfterSeconds: number;
      correlationId: string;
    }>;

export type VerifyRecoveryChallengeInput = Readonly<{
  rawChallengeToken: string;
  otp: string;
  verificationOperationId: string;
  source: string;
}>;

export type VerifyRecoveryChallengeResult =
  | Readonly<{
      outcome: "MATCH";
      rawRecoveryToken: string;
      recoverySessionId: string;
      issuedAt: Date;
      expiresAt: Date;
      correlationId: string;
    }>
  | Readonly<{
      outcome: "NO_MATCH" | "LOCKED" | "EXPIRED" | "REPLAY" | "ERROR" | "INVALID_TOKEN";
      correlationId: string;
    }>
  | Readonly<{
      outcome: "RATE_LIMITED";
      safeCode: string;
      retryAfterSeconds: number;
      correlationId: string;
    }>
  | Readonly<{
      outcome: "OPERATION_CONFLICT";
      correlationId: string;
    }>;

export type ValidateRecoverySessionResult =
  | Readonly<{
      status: "RESOLVED";
      emailNormalized: string;
      emailFingerprint: string;
      commercialProductId: string;
      testId: string;
      sessionId: string;
      issuedAt: Date;
      expiresAt: Date;
    }>
  | Readonly<{
      status: "INVALID_TOKEN" | "UNKNOWN_KEY" | "NOT_FOUND" | "REVOKED" | "EXPIRED" | "SCOPE_MISMATCH";
    }>;

export type InvalidateRecoverySessionResult = Readonly<{
  status: "REVOKED" | "ALREADY_TERMINAL" | "NOT_FOUND";
}>;

function retryAfterSeconds(now: Date, availableAt: Date) {
  return Math.max(1, Math.ceil((availableAt.getTime() - now.getTime()) / 1000));
}

function validateOperationId(value: string) {
  if (!operationIdSchema.safeParse(value).success) {
    throw new RecoveryDomainServiceError("INVALID_OPERATION_ID");
  }
}

function validateSource(value: string) {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) {
    throw new RecoveryDomainServiceError("INVALID_SOURCE");
  }
  return parsed.data;
}

function normalizeAndValidateEmail(value: string) {
  const parsed = normalizedEmailSchema.safeParse(value);
  if (!parsed.success) {
    throw new RecoveryDomainServiceError("INVALID_EMAIL");
  }
  return parsed.data;
}

function requireEnabled(config: RecoveryConfig): EnabledRecoveryConfig {
  if (!config.enabled) {
    throw new RecoveryDomainServiceError("FEATURE_DISABLED");
  }
  return config;
}

function verificationReplayOutcome(outcome: RecoveryVerificationOutcome) {
  return outcome === "MATCH" ? "REPLAY" : outcome;
}

function invalidationState(reason: VerifiedRecoverySessionRevocationCode) {
  if (reason === "EXPIRED") {
    return "EXPIRED" as const;
  }
  if (reason === "ROTATED") {
    return "ROTATED" as const;
  }
  return "REVOKED" as const;
}

function invalidationReasonCode(reason: VerifiedRecoverySessionRevocationCode): RecoverySecurityReasonCode {
  const map = {
    USER_INVALIDATED: "USER_INVALIDATED",
    EXPIRED: "SESSION_EXPIRED",
    ROTATED: "SESSION_ROTATED",
    CONTINUED: "SESSION_CONTINUED",
    SECURITY_REVOKED: "SECURITY_REVOKED",
    KEY_RETIRED: "KEY_RETIRED"
  } as const satisfies Record<VerifiedRecoverySessionRevocationCode, RecoverySecurityReasonCode>;
  return map[reason];
}

export function createRecoveryDomainService(input: {
  client: PrismaClient;
  config: RecoveryConfig;
  mailer: RecoveryMailer;
  clock?: Clock;
  otpGenerator?: () => string;
  testHooks?: RecoveryDomainServiceTestHooks;
}) {
  const clock = input.clock ?? (() => new Date());
  const configuredOtpGenerator = input.otpGenerator;
  const testHooks = recoveryDomainServiceUsesTestHooks(input.config)
    ? {
        ...NOOP_RECOVERY_DOMAIN_SERVICE_TEST_HOOKS,
        ...input.testHooks
      }
    : NOOP_RECOVERY_DOMAIN_SERVICE_TEST_HOOKS;

  function enabledConfig() {
    const config = requireEnabled(input.config);
    if (configuredOtpGenerator && config.mailerMode !== "test") {
      throw new RecoveryDomainServiceError("DETERMINISTIC_OTP_FORBIDDEN");
    }
    return config;
  }

  function otpGenerator() {
    const otp = configuredOtpGenerator ? configuredOtpGenerator() : generateRecoveryOtp();
    if (!RECOVERY_OTP_PATTERN.test(otp)) {
      throw new RecoveryDomainServiceError("INVALID_OTP");
    }
    return otp;
  }

  function rateLimiter(config: EnabledRecoveryConfig) {
    return createRecoveryRateLimitService({
      client: input.client,
      fingerprintKeyRing: config.keyRings.emailFingerprint,
      clock
    });
  }

  async function withTransaction<T>(tx: Tx | undefined, operation: (activeTx: Tx) => Promise<T>) {
    return tx ? operation(tx) : input.client.$transaction(operation);
  }

  async function audit(
    tx: Tx,
    event: {
      correlationId: string;
      eventCode: RecoverySecurityEventCode;
      reasonCode?: RecoverySecurityReasonCode;
      challengeId?: string;
      recoverySessionId?: string;
      occurredAt: Date;
    }
  ) {
    await tx.recoverySecurityEvent.create({ data: event });
  }

  async function acquireSubjectLock(
    tx: Tx,
    emailFingerprint: string,
    commercialProductId: string,
    testId: string
  ) {
    const lockKey = `acc01a-subject:${emailFingerprint}:${commercialProductId}:${testId}`;
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
    `;
  }

  async function acquireOperationLock(tx: Tx, operationId: string) {
    const lockKey = `acc01a-request-operation:${operationId}`;
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
    `;
  }

  async function acquireVerificationOperationLock(tx: Tx, operationId: string) {
    const lockKey = recoveryVerificationOperationLockKey(operationId);
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
    `;
  }

  return {
    async requestChallenge(request: RequestRecoveryChallengeInput): Promise<RequestRecoveryChallengeResult> {
      const config = enabledConfig();
      const emailNormalized = normalizeAndValidateEmail(request.email);
      validateOperationId(request.requestOperationId);
      const transientSource = validateSource(request.source);
      if (request.productCode !== config.productCode) {
        throw new RecoveryDomainServiceError("PRODUCT_SCOPE_MISMATCH");
      }
      const emailFingerprint = createEmailFingerprint(
        emailNormalized,
        config.keyRings.emailFingerprint
      );
      const correlationId = randomUUID();
      const limiter = rateLimiter(config);

      const transactionResult = await input.client.$transaction(async (tx) => {
        await acquireOperationLock(tx, request.requestOperationId);
        const existingOperation = await tx.recoveryChallenge.findUnique({
          where: { requestOperationId: request.requestOperationId }
        });
        const now = clock();
        if (existingOperation) {
          if (existingOperation.emailNormalized !== emailNormalized) {
            await audit(tx, {
              correlationId,
              eventCode: "CHALLENGE_REUSED",
              reasonCode: "OPERATION_CONFLICT",
              challengeId: existingOperation.id,
              occurredAt: now
            });
            return { kind: "conflict" as const };
          }
          await audit(tx, {
            correlationId,
            eventCode: "CHALLENGE_REUSED",
            reasonCode: "IDEMPOTENT_RETRY",
            challengeId: existingOperation.id,
            occurredAt: now
          });
          return { kind: "reused" as const, challenge: existingOperation };
        }

        const product = await tx.commercialProduct.findUnique({
          where: { code: config.productCode },
          include: { test: { select: { id: true } } }
        });
        if (!product || product.test.id !== product.testId) {
          throw new RecoveryDomainServiceError("PRODUCT_SCOPE_INVALID");
        }

        await testHooks.beforeRequestSubjectLock();

        const emailLimit = await limiter.consumeEmailRequest(emailFingerprint, tx);
        if (!emailLimit.allowed) {
          await audit(tx, {
            correlationId,
            eventCode: "RATE_LIMITED",
            reasonCode: "EMAIL_LIMIT",
            occurredAt: now
          });
          return { kind: "rate_limited" as const, limit: emailLimit };
        }
        const sourceLimit = await limiter.consumeSourceRequest(transientSource, tx);
        if (!sourceLimit.allowed) {
          await audit(tx, {
            correlationId,
            eventCode: "RATE_LIMITED",
            reasonCode: "SOURCE_LIMIT",
            occurredAt: now
          });
          return { kind: "rate_limited" as const, limit: sourceLimit };
        }

        await acquireSubjectLock(tx, emailFingerprint, product.id, product.testId);
        const active = await tx.recoveryChallenge.findFirst({
          where: {
            emailFingerprint,
            commercialProductId: product.id,
            testId: product.testId,
            status: "ACTIVE"
          }
        });
        if (active && now.getTime() < active.resendAvailableAt.getTime()) {
          await audit(tx, {
            correlationId,
            eventCode: "RATE_LIMITED",
            reasonCode: "COOLDOWN",
            challengeId: active.id,
            occurredAt: now
          });
          return {
            kind: "cooldown" as const,
            retryAfterSeconds: retryAfterSeconds(now, active.resendAvailableAt)
          };
        }

        const challengeId = randomUUID();
        const rawChallengeToken = createRecoveryChallengeToken(
          config.keyRings.challengeToken.activeKeyVersion
        );
        const { digest: challengeTokenDigest, keyVersion: challengeKeyVersion } =
          digestRecoveryChallengeToken(rawChallengeToken, config.keyRings.challengeToken);
        const otp = otpGenerator();
        const otpKeyVersion = config.keyRings.otpMac.activeKeyVersion;
        const otpMac = createRecoveryOtpMac({
          challengeId,
          commercialProductId: product.id,
          testId: product.testId,
          normalizedEmail: emailNormalized,
          otp
        }, otpKeyVersion, config.keyRings.otpMac);
        const expiresAt = recoveryOtpExpiresAt(now);
        const resendAvailableAt = recoveryResendAvailableAt(now);

        if (active) {
          await tx.recoveryChallenge.update({
            where: { id: active.id },
            data: {
              status: "SUPERSEDED",
              terminalAt: now,
              otpMac: null
            }
          });
        }
        const challenge = await tx.recoveryChallenge.create({
          data: {
            id: challengeId,
            commercialProductId: product.id,
            testId: product.testId,
            emailNormalized,
            emailFingerprint,
            challengeTokenDigest,
            challengeKeyVersion,
            otpMac,
            otpKeyVersion,
            requestOperationId: request.requestOperationId,
            expiresAt,
            resendAvailableAt,
            createdAt: now,
            updatedAt: now
          }
        });
        if (active) {
          await tx.recoveryChallenge.update({
            where: { id: active.id },
            data: { supersededById: challenge.id }
          });
          await audit(tx, {
            correlationId,
            eventCode: "CHALLENGE_SUPERSEDED",
            reasonCode: "RESEND",
            challengeId: active.id,
            occurredAt: now
          });
        }
        await audit(tx, {
          correlationId,
          eventCode: "CHALLENGE_REQUESTED",
          reasonCode: "REQUEST_CREATED",
          challengeId: challenge.id,
          occurredAt: now
        });
        return {
          kind: "created" as const,
          challenge,
          rawChallengeToken,
          otp
        };
      });

      if (transactionResult.kind === "conflict") {
        return { outcome: "IDEMPOTENCY_CONFLICT", correlationId };
      }
      if (transactionResult.kind === "reused") {
        return {
          outcome: "IDEMPOTENT_REPLAY",
          challengeId: transactionResult.challenge.id,
          expiresAt: transactionResult.challenge.expiresAt,
          resendAvailableAt: transactionResult.challenge.resendAvailableAt,
          correlationId
        };
      }
      if (transactionResult.kind === "rate_limited") {
        return {
          outcome: "RATE_LIMITED",
          safeCode: transactionResult.limit.safeCode,
          retryAfterSeconds: transactionResult.limit.retryAfterSeconds,
          correlationId
        };
      }
      if (transactionResult.kind === "cooldown") {
        return {
          outcome: "COOLDOWN",
          retryAfterSeconds: transactionResult.retryAfterSeconds,
          correlationId
        };
      }

      let delivery: RecoveryMailResult;
      try {
        delivery = await input.mailer.sendVerificationCode({
          recipient: emailNormalized,
          code: transactionResult.otp,
          expiresAt: transactionResult.challenge.expiresAt,
          correlationId
        });
      } catch {
        delivery = { status: "unknown", safeCode: "MAILER_OUTCOME_UNKNOWN" };
      }
      if (delivery.status !== "accepted") {
        const now = clock();
        await input.client.$transaction((tx) => audit(tx, {
          correlationId,
          eventCode: "CHALLENGE_REQUESTED",
          reasonCode: delivery.status === "failed" ? "MAILER_FAILED" : "MAILER_UNKNOWN",
          challengeId: transactionResult.challenge.id,
          occurredAt: now
        }));
      }
      return {
        outcome: "CREATED",
        challengeId: transactionResult.challenge.id,
        rawChallengeToken: transactionResult.rawChallengeToken,
        expiresAt: transactionResult.challenge.expiresAt,
        resendAvailableAt: transactionResult.challenge.resendAvailableAt,
        correlationId,
        delivery
      };
    },

    async verifyChallenge(
      request: VerifyRecoveryChallengeInput,
      callerTx?: Tx
    ): Promise<VerifyRecoveryChallengeResult> {
      const config = enabledConfig();
      validateOperationId(request.verificationOperationId);
      const transientSource = validateSource(request.source);
      const correlationId = randomUUID();
      const limiter = rateLimiter(config);

      return withTransaction(callerTx, async (tx) => {
        await testHooks.beforeVerifyOperationLock();

        // Deterministic lock order for verification:
        // 1. verification-operation advisory lock;
        // 2. token parse/digest and candidate lookup;
        // 3. subject advisory lock;
        // 4. challenge row FOR UPDATE;
        // 5. existing-operation reconciliation;
        // 6. source limiter and challenge/session effects.
        // Never acquire the operation lock after a subject or challenge lock.
        await acquireVerificationOperationLock(tx, request.verificationOperationId);

        async function rejectSourceFailure(
          classification: Extract<
            RecoverySourceFailureClassification,
            "MALFORMED_OTP" | "MALFORMED_TOKEN" | "UNKNOWN_TOKEN"
          >,
          outcome: "ERROR" | "INVALID_TOKEN"
        ): Promise<VerifyRecoveryChallengeResult> {
          if (!isRecoverySourceVerificationFailure(classification)) {
            throw new Error("RECOVERY_SOURCE_FAILURE_CLASSIFICATION_INVALID");
          }
          const consumed = await limiter.consumeFailedVerifySource(transientSource, tx);
          if (!consumed.allowed) {
            return {
              outcome: "RATE_LIMITED",
              safeCode: consumed.safeCode,
              retryAfterSeconds: consumed.retryAfterSeconds,
              correlationId
            };
          }
          return { outcome, correlationId };
        }

        let token;
        try {
          token = digestRecoveryChallengeToken(
            request.rawChallengeToken,
            config.keyRings.challengeToken
          );
        } catch (error) {
          if (error instanceof RecoveryCryptoError) {
            return rejectSourceFailure("MALFORMED_TOKEN", "INVALID_TOKEN");
          }
          throw error;
        }
        if (!RECOVERY_OTP_PATTERN.test(request.otp)) {
          return rejectSourceFailure("MALFORMED_OTP", "ERROR");
        }

        const candidate = await tx.recoveryChallenge.findUnique({
          where: { challengeTokenDigest: token.digest },
          select: {
            id: true,
            emailFingerprint: true,
            commercialProductId: true,
            testId: true
          }
        });
        if (!candidate) {
          return rejectSourceFailure("UNKNOWN_TOKEN", "INVALID_TOKEN");
        }
        await testHooks.beforeVerifySubjectLock();
        await acquireSubjectLock(
          tx,
          candidate.emailFingerprint,
          candidate.commercialProductId,
          candidate.testId
        );
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "recovery_challenges"
          WHERE "id" = ${candidate.id}::uuid
            AND "challenge_token_digest" = ${token.digest}
          FOR UPDATE
        `;
        if (locked.length !== 1) {
          return rejectSourceFailure("UNKNOWN_TOKEN", "INVALID_TOKEN");
        }
        const challenge = await tx.recoveryChallenge.findUniqueOrThrow({
          where: { id: candidate.id }
        });
        if (
          challenge.challengeKeyVersion !== token.keyVersion ||
          !secretDigestsEqual(token.digest, challenge.challengeTokenDigest)
        ) {
          return rejectSourceFailure("UNKNOWN_TOKEN", "INVALID_TOKEN");
        }

        const existingOperation = await tx.recoveryVerificationAttempt.findUnique({
          where: { operationId: request.verificationOperationId }
        });
        if (existingOperation) {
          if (existingOperation.challengeId !== challenge.id) {
            return { outcome: "OPERATION_CONFLICT", correlationId };
          }
          return {
            outcome: verificationReplayOutcome(existingOperation.outcomeCode),
            correlationId
          };
        }
        const attemptOrdinal = await tx.recoveryVerificationAttempt.count({
          where: { challengeId: challenge.id }
        }) + 1;
        const now = clock();

        async function recordAttempt(outcomeCode: RecoveryVerificationOutcome) {
          await tx.recoveryVerificationAttempt.create({
            data: {
              challengeId: challenge.id,
              operationId: request.verificationOperationId,
              outcomeCode,
              attemptOrdinal,
              occurredAt: now
            }
          });
        }

        if (challenge.status !== "ACTIVE") {
          const outcome = challenge.status === "LOCKED"
            ? "LOCKED"
            : challenge.status === "EXPIRED" ? "EXPIRED" : "REPLAY";
          await recordAttempt(outcome);
          await audit(tx, {
            correlationId,
            eventCode: "VERIFY_REJECTED",
            reasonCode: outcome === "LOCKED"
              ? "CHALLENGE_LOCKED"
              : outcome === "EXPIRED" ? "CHALLENGE_EXPIRED" : "CHALLENGE_REPLAY",
            challengeId: challenge.id,
            occurredAt: now
          });
          return { outcome, correlationId };
        }
        if (now.getTime() >= challenge.expiresAt.getTime()) {
          await tx.recoveryChallenge.update({
            where: { id: challenge.id },
            data: { status: "EXPIRED", terminalAt: now, otpMac: null }
          });
          await recordAttempt("EXPIRED");
          await audit(tx, {
            correlationId,
            eventCode: "VERIFY_REJECTED",
            reasonCode: "CHALLENGE_EXPIRED",
            challengeId: challenge.id,
            occurredAt: now
          });
          return { outcome: "EXPIRED", correlationId };
        }

        const sourcePermit = await limiter.checkFailedVerifySource(transientSource, tx);
        if (!sourcePermit.allowed) {
          await recordAttempt("ERROR");
          await audit(tx, {
            correlationId,
            eventCode: "RATE_LIMITED",
            reasonCode: "SOURCE_LIMIT",
            challengeId: challenge.id,
            occurredAt: now
          });
          return {
            outcome: "RATE_LIMITED",
            safeCode: sourcePermit.safeCode,
            retryAfterSeconds: sourcePermit.retryAfterSeconds,
            correlationId
          };
        }

        let submittedMac: string;
        try {
          submittedMac = createRecoveryOtpMac({
            challengeId: challenge.id,
            commercialProductId: challenge.commercialProductId,
            testId: challenge.testId,
            normalizedEmail: challenge.emailNormalized,
            otp: request.otp
          }, challenge.otpKeyVersion, config.keyRings.otpMac);
        } catch (error) {
          if (!(error instanceof RecoveryCryptoError)) {
            throw error;
          }
          await recordAttempt("ERROR");
          await audit(tx, {
            correlationId,
            eventCode: "VERIFY_REJECTED",
            reasonCode: "SCOPE_INVALID",
            challengeId: challenge.id,
            occurredAt: now
          });
          return { outcome: "ERROR", correlationId };
        }

        if (!challenge.otpMac || !secretDigestsEqual(submittedMac, challenge.otpMac)) {
          await limiter.recordFailedVerifySource(sourcePermit.keyDigest, tx);
          const failedVerifyCount = challenge.failedVerifyCount + 1;
          const lockedOut = failedVerifyCount >= RECOVERY_FAILED_VERIFY_LIMIT;
          await tx.recoveryChallenge.update({
            where: { id: challenge.id },
            data: lockedOut
              ? {
                  failedVerifyCount: RECOVERY_FAILED_VERIFY_LIMIT,
                  status: "LOCKED",
                  terminalAt: now,
                  otpMac: null
                }
              : { failedVerifyCount }
          });
          const outcome = lockedOut ? "LOCKED" : "NO_MATCH";
          await recordAttempt(outcome);
          await audit(tx, {
            correlationId,
            eventCode: "VERIFY_REJECTED",
            reasonCode: lockedOut ? "CHALLENGE_LOCKED" : "INVALID_OTP",
            challengeId: challenge.id,
            occurredAt: now
          });
          return { outcome, correlationId };
        }

        const previousSession = await tx.verifiedRecoverySession.findFirst({
          where: {
            emailFingerprint: challenge.emailFingerprint,
            commercialProductId: challenge.commercialProductId,
            testId: challenge.testId,
            status: "ACTIVE"
          }
        });
        if (previousSession) {
          await tx.verifiedRecoverySession.update({
            where: { id: previousSession.id },
            data: {
              status: "ROTATED",
              revokedAt: now,
              revocationCode: "ROTATED"
            }
          });
          await audit(tx, {
            correlationId,
            eventCode: "SESSION_REVOKED",
            reasonCode: "SESSION_ROTATED",
            recoverySessionId: previousSession.id,
            occurredAt: now
          });
        }

        const rawRecoveryToken = createRecoverySessionToken(
          config.keyRings.sessionToken.activeKeyVersion
        );
        const sessionToken = digestRecoverySessionToken(
          rawRecoveryToken,
          config.keyRings.sessionToken
        );
        const issuedAt = now;
        const expiresAt = recoverySessionExpiresAt(now);
        const recoverySession = await tx.verifiedRecoverySession.create({
          data: {
            challengeId: challenge.id,
            tokenDigest: sessionToken.digest,
            tokenKeyVersion: sessionToken.keyVersion,
            emailNormalized: challenge.emailNormalized,
            emailFingerprint: challenge.emailFingerprint,
            commercialProductId: challenge.commercialProductId,
            testId: challenge.testId,
            issuedAt,
            expiresAt,
            rotatedFromId: previousSession?.id,
            createdAt: now,
            updatedAt: now
          }
        });
        await tx.recoveryChallenge.update({
          where: { id: challenge.id },
          data: {
            status: "VERIFIED",
            verifiedAt: now,
            terminalAt: now,
            otpMac: null
          }
        });
        await recordAttempt("MATCH");
        await audit(tx, {
          correlationId,
          eventCode: "VERIFY_MATCHED",
          reasonCode: "OTP_MATCH",
          challengeId: challenge.id,
          recoverySessionId: recoverySession.id,
          occurredAt: now
        });
        await audit(tx, {
          correlationId,
          eventCode: "SESSION_ISSUED",
          reasonCode: "OTP_MATCH",
          challengeId: challenge.id,
          recoverySessionId: recoverySession.id,
          occurredAt: now
        });
        return {
          outcome: "MATCH",
          rawRecoveryToken,
          recoverySessionId: recoverySession.id,
          issuedAt,
          expiresAt,
          correlationId
        };
      });
    },

    async validateRecoverySession(rawToken: string): Promise<ValidateRecoverySessionResult> {
      const config = enabledConfig();
      let token;
      try {
        token = digestRecoverySessionToken(rawToken, config.keyRings.sessionToken);
      } catch (error) {
        if (error instanceof RecoveryCryptoError) {
          return {
            status: error.code === "TOKEN_UNKNOWN_KEY" ? "UNKNOWN_KEY" : "INVALID_TOKEN"
          };
        }
        throw error;
      }

      return input.client.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "verified_recovery_sessions"
          WHERE "token_digest" = ${token.digest}
          FOR UPDATE
        `;
        const id = locked[0]?.id;
        if (!id) {
          return { status: "NOT_FOUND" };
        }
        const session = await tx.verifiedRecoverySession.findUniqueOrThrow({
          where: { id },
          include: {
            challenge: true,
            product: { select: { id: true, testId: true } },
            test: { select: { id: true } }
          }
        });
        if (
          session.tokenKeyVersion !== token.keyVersion ||
          !secretDigestsEqual(token.digest, session.tokenDigest)
        ) {
          return { status: "SCOPE_MISMATCH" };
        }
        if (session.status !== "ACTIVE") {
          return { status: session.status === "EXPIRED" ? "EXPIRED" : "REVOKED" };
        }
        const now = clock();
        if (now.getTime() >= session.expiresAt.getTime()) {
          await tx.verifiedRecoverySession.update({
            where: { id: session.id },
            data: { status: "EXPIRED", revokedAt: session.expiresAt, revocationCode: "EXPIRED" }
          });
          await audit(tx, {
            correlationId: randomUUID(),
            eventCode: "SESSION_REVOKED",
            reasonCode: "SESSION_EXPIRED",
            recoverySessionId: session.id,
            occurredAt: now
          });
          return { status: "EXPIRED" };
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
        if (!scopeIsConsistent) {
          return { status: "SCOPE_MISMATCH" };
        }
        return {
          status: "RESOLVED",
          emailNormalized: session.emailNormalized,
          emailFingerprint: session.emailFingerprint,
          commercialProductId: session.commercialProductId,
          testId: session.testId,
          sessionId: session.id,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt
        };
      });
    },

    async invalidateRecoverySession(
      rawToken: string,
      reason: VerifiedRecoverySessionRevocationCode = "USER_INVALIDATED",
      callerTx?: Tx
    ): Promise<InvalidateRecoverySessionResult> {
      const config = enabledConfig();
      let token;
      try {
        token = digestRecoverySessionToken(rawToken, config.keyRings.sessionToken);
      } catch (error) {
        if (error instanceof RecoveryCryptoError) {
          return { status: "NOT_FOUND" };
        }
        throw error;
      }
      return withTransaction(callerTx, async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "verified_recovery_sessions"
          WHERE "token_digest" = ${token.digest}
          FOR UPDATE
        `;
        const id = locked[0]?.id;
        if (!id) {
          return { status: "NOT_FOUND" };
        }
        const session = await tx.verifiedRecoverySession.findUniqueOrThrow({ where: { id } });
        if (!secretDigestsEqual(token.digest, session.tokenDigest)) {
          return { status: "NOT_FOUND" };
        }
        if (session.status !== "ACTIVE") {
          return { status: "ALREADY_TERMINAL" };
        }
        const now = clock();
        await tx.verifiedRecoverySession.update({
          where: { id: session.id },
          data: {
            status: invalidationState(reason),
            revokedAt: now,
            revocationCode: reason
          }
        });
        await audit(tx, {
          correlationId: randomUUID(),
          eventCode: "SESSION_REVOKED",
          reasonCode: invalidationReasonCode(reason),
          recoverySessionId: session.id,
          occurredAt: now
        });
        return { status: "REVOKED" };
      });
    },

    async cleanup(callerTx?: Tx) {
      const config = enabledConfig();
      const limiter = rateLimiter(config);
      return withTransaction(callerTx, async (tx) => {
        const now = clock();
        const terminalCutoff = new Date(now.getTime() - RECOVERY_TERMINAL_RETENTION_MS);
        const securityCutoff = new Date(now.getTime() - RECOVERY_SECURITY_EVENT_RETENTION_MS);

        const expiredChallenges = await tx.$executeRaw`
          UPDATE "recovery_challenges"
          SET
            "status" = 'expired'::"recovery_challenge_status",
            "terminal_at" = "expires_at",
            "otp_mac" = NULL,
            "updated_at" = ${now}
          WHERE "status" = 'active'::"recovery_challenge_status"
            AND "expires_at" <= ${now}
        `;
        const expiredSessions = await tx.$executeRaw`
          UPDATE "verified_recovery_sessions"
          SET
            "status" = 'expired'::"verified_recovery_session_status",
            "revoked_at" = "expires_at",
            "revocation_code" = 'expired'::"verified_recovery_session_revocation_code",
            "updated_at" = ${now}
          WHERE "status" = 'active'::"verified_recovery_session_status"
            AND "expires_at" <= ${now}
        `;
        const rateLimitEvents = await limiter.cleanupExpired(tx);
        const securityEvents = await tx.recoverySecurityEvent.deleteMany({
          where: { occurredAt: { lte: securityCutoff } }
        });
        const sessions = await tx.verifiedRecoverySession.deleteMany({
          where: {
            status: { in: ["REVOKED", "EXPIRED", "ROTATED"] },
            revokedAt: { lte: terminalCutoff }
          }
        });
        const challenges = await tx.recoveryChallenge.deleteMany({
          where: {
            status: { in: ["VERIFIED", "EXPIRED", "LOCKED", "SUPERSEDED", "REVOKED"] },
            terminalAt: { lte: terminalCutoff },
            recoverySessions: { none: {} }
          }
        });
        return {
          expiredChallenges,
          expiredSessions,
          deletedRateLimitEvents: rateLimitEvents.deletedCount,
          deletedSecurityEvents: securityEvents.count,
          deletedRecoverySessions: sessions.count,
          deletedChallenges: challenges.count
        };
      });
    }
  };
}
