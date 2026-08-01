import { z } from "zod";
import { normalizedEmailSchema } from "@/lib/validation/email";
import {
  clearRecoveryChallengeCookie,
  clearRecoverySessionCookie,
  readRecoveryCookie,
  RECOVERY_CHALLENGE_COOKIE,
  RECOVERY_SESSION_COOKIE,
  recoveryCookiesAreSecure,
  setRecoveryChallengeCookie,
  setRecoverySessionCookie
} from "@/server/recovery/cookies";
import {
  recoveryCsrfRejected,
  recoveryError,
  recoveryJson,
  recoveryNoContent
} from "@/server/recovery/http-response";
import {
  createRecoveryHttpRuntime,
  RECOVERY_HTTP_GLOBAL_SOURCE,
  type EnabledRecoveryHttpRuntime,
  type RecoveryHttpRuntime
} from "@/server/recovery/http-runtime";
import {
  canonicalRecoveryOrigin,
  isProtectedRecoveryDelete,
  isProtectedRecoveryPost
} from "@/server/recovery/request-protection";
import {
  RecoveryDomainServiceError,
  RECOVERY_RESEND_COOLDOWN_MS
} from "@/server/recovery/service";
import { normalizeRecoveryTiming } from "@/server/recovery/timing";

const challengeRequestSchema = z.object({
  email: normalizedEmailSchema,
  productCode: z.string().trim().min(1).max(128),
  intent: z.literal("recovery"),
  idempotencyKey: z.string().uuid()
}).strict();

const verifyRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  operationId: z.string().uuid()
}).strict();

const neutralResendSeconds = RECOVERY_RESEND_COOLDOWN_MS / 1000;

export type RecoveryHttpHandlerDependencies = Readonly<{
  getRuntime?: () => RecoveryHttpRuntime;
  clock?: () => Date;
  normalizeRequestTiming?: (startedAt: Date) => Promise<void>;
  cookieSecure?: boolean;
}>;

function featureUnavailable() {
  return recoveryError("FEATURE_UNAVAILABLE", "Recovery is unavailable.", 404);
}

function invalidRequest() {
  return recoveryError("INVALID_REQUEST", "Invalid request.", 400);
}

function temporaryUnavailable() {
  return recoveryError("TEMPORARY_UNAVAILABLE", "Recovery is temporarily unavailable.", 503);
}

async function strictJson(request: Request) {
  try {
    return { ok: true as const, value: await request.json() };
  } catch {
    return { ok: false as const };
  }
}

export function maskRecoveryEmail(normalizedEmail: string) {
  const separator = normalizedEmail.lastIndexOf("@");
  if (separator <= 0 || separator === normalizedEmail.length - 1) return "***";
  const local = Array.from(normalizedEmail.slice(0, separator));
  const domain = normalizedEmail.slice(separator + 1);
  if (local.length === 1) return `*@${domain}`;
  if (local.length === 2) return `${local[0]}*@${domain}`;
  return `${local[0]}***${local.at(-1)}@${domain}`;
}

function domainErrorResponse(error: unknown) {
  if (error instanceof RecoveryDomainServiceError) {
    if (error.code === "FEATURE_DISABLED" ||
      error.code === "PRODUCT_SCOPE_MISMATCH" ||
      error.code === "PRODUCT_SCOPE_INVALID") {
      return featureUnavailable();
    }
    if (error.code === "INVALID_EMAIL" ||
      error.code === "INVALID_OPERATION_ID" ||
      error.code === "INVALID_OTP") {
      return invalidRequest();
    }
  }
  return temporaryUnavailable();
}

export function createRecoveryHttpHandlers(
  dependencies: RecoveryHttpHandlerDependencies = {}
) {
  const getRuntime = dependencies.getRuntime ?? createRecoveryHttpRuntime;
  const clock = dependencies.clock ?? (() => new Date());
  const normalizeRequestTiming = dependencies.normalizeRequestTiming ?? (async (startedAt: Date) => {
    await normalizeRecoveryTiming(startedAt);
  });

  function secureCookies() {
    return dependencies.cookieSecure ?? recoveryCookiesAreSecure();
  }

  function enabledRuntime() {
    try {
      const runtime = getRuntime();
      if (!runtime.config.enabled) return null;
      const enabled = runtime as EnabledRecoveryHttpRuntime;
      if (canonicalRecoveryOrigin(enabled.trustedOrigin) !== enabled.trustedOrigin ||
        enabled.sourceLimiterInput !== RECOVERY_HTTP_GLOBAL_SOURCE) {
        return null;
      }
      return enabled;
    } catch {
      return null;
    }
  }

  async function requestChallenge(request: Request) {
    const runtime = enabledRuntime();
    if (!runtime) return featureUnavailable();
    if (!isProtectedRecoveryPost(request, runtime.trustedOrigin)) {
      return recoveryCsrfRejected();
    }
    const json = await strictJson(request);
    if (!json.ok) return invalidRequest();
    const parsed = challengeRequestSchema.safeParse(json.value);
    if (!parsed.success) return invalidRequest();

    const startedAt = clock();
    try {
      const result = await runtime.service.requestChallenge({
        email: parsed.data.email,
        productCode: parsed.data.productCode,
        requestOperationId: parsed.data.idempotencyKey,
        source: runtime.sourceLimiterInput
      });
      await normalizeRequestTiming(startedAt);

      const neutral = () => recoveryJson({
        state: "code_sent",
        messageKey: "email.sent_neutral",
        emailMasked: maskRecoveryEmail(parsed.data.email),
        resendAfterSeconds: neutralResendSeconds
      }, 202);

      if (result.outcome === "CREATED") {
        const response = neutral();
        setRecoveryChallengeCookie(response, result.rawChallengeToken, result.expiresAt, {
          now: clock(),
          secure: secureCookies()
        });
        return response;
      }
      if (result.outcome === "IDEMPOTENT_REPLAY" || result.outcome === "COOLDOWN") {
        return neutral();
      }
      if (result.outcome === "RATE_LIMITED") {
        if (result.safeCode.startsWith("EMAIL_REQUEST_LIMIT_")) return neutral();
        return recoveryError(
          "RATE_LIMITED",
          "Too many recovery requests.",
          429,
          { "Retry-After": String(result.retryAfterSeconds) }
        );
      }
      return recoveryError("IDEMPOTENCY_CONFLICT", "Request conflict.", 409);
    } catch (error) {
      await normalizeRequestTiming(startedAt);
      return domainErrorResponse(error);
    }
  }

  async function verifyChallenge(request: Request) {
    const runtime = enabledRuntime();
    if (!runtime) return featureUnavailable();
    if (!isProtectedRecoveryPost(request, runtime.trustedOrigin)) {
      return recoveryCsrfRejected();
    }
    const json = await strictJson(request);
    if (!json.ok) return invalidRequest();
    const parsed = verifyRequestSchema.safeParse(json.value);
    if (!parsed.success) return invalidRequest();

    try {
      const rawChallengeToken = readRecoveryCookie(request, RECOVERY_CHALLENGE_COOKIE);
      if (!rawChallengeToken) {
        return recoveryError("CHALLENGE_NOT_ACTIVE", "Recovery challenge is not active.", 409);
      }
      const result = await runtime.service.verifyChallenge({
        rawChallengeToken,
        otp: parsed.data.code,
        verificationOperationId: parsed.data.operationId,
        source: runtime.sourceLimiterInput
      });

      if (result.outcome === "MATCH") {
        const response = recoveryJson({
          state: "verified",
          messageKey: "email.code.verified",
          nextAction: "RESOLVE"
        }, 200);
        clearRecoveryChallengeCookie(response, { secure: secureCookies() });
        setRecoverySessionCookie(response, result.rawRecoveryToken, result.expiresAt, {
          now: clock(),
          secure: secureCookies()
        });
        return response;
      }
      if (result.outcome === "NO_MATCH") {
        return recoveryError("CODE_INVALID", "Invalid verification code.", 401);
      }
      if (result.outcome === "EXPIRED") {
        const response = recoveryError("CODE_EXPIRED", "Verification code expired.", 410);
        clearRecoveryChallengeCookie(response, { secure: secureCookies() });
        return response;
      }
      if (result.outcome === "LOCKED" ||
        result.outcome === "REPLAY" ||
        result.outcome === "INVALID_TOKEN") {
        const response = recoveryError(
          "CHALLENGE_NOT_ACTIVE",
          "Recovery challenge is not active.",
          409
        );
        clearRecoveryChallengeCookie(response, { secure: secureCookies() });
        return response;
      }
      if (result.outcome === "RATE_LIMITED") {
        return recoveryError(
          "RATE_LIMITED",
          "Too many verification attempts.",
          429,
          { "Retry-After": String(result.retryAfterSeconds) }
        );
      }
      if (result.outcome === "OPERATION_CONFLICT") {
        return recoveryError("OPERATION_CONFLICT", "Verification request conflict.", 409);
      }
      return recoveryError(
        "OPERATION_OUTCOME_UNKNOWN",
        "Verification outcome is unknown.",
        503
      );
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  async function invalidateSession(request: Request) {
    const runtime = enabledRuntime();
    if (!runtime) return featureUnavailable();
    if (!await isProtectedRecoveryDelete(request, runtime.trustedOrigin)) {
      return recoveryCsrfRejected();
    }

    const rawRecoveryToken = readRecoveryCookie(request, RECOVERY_SESSION_COOKIE);
    try {
      if (rawRecoveryToken) {
        const result = await runtime.service.invalidateRecoverySession(
          rawRecoveryToken,
          "USER_INVALIDATED"
        );
        if (result.status !== "REVOKED" &&
          result.status !== "ALREADY_TERMINAL" &&
          result.status !== "NOT_FOUND") {
          return recoveryError(
            "OPERATION_OUTCOME_UNKNOWN",
            "Session invalidation outcome is unknown.",
            503
          );
        }
      }
      const response = recoveryNoContent();
      clearRecoverySessionCookie(response, { secure: secureCookies() });
      return response;
    } catch {
      return recoveryError(
        "OPERATION_OUTCOME_UNKNOWN",
        "Session invalidation outcome is unknown.",
        503
      );
    }
  }

  return { requestChallenge, verifyChallenge, invalidateSession } as const;
}
