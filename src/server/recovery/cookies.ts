import type { NextResponse } from "next/server";
import { isRecoveryProductionLikeEnvironment } from "@/server/recovery/config";
import {
  RECOVERY_OTP_TTL_MS,
  RECOVERY_SESSION_ABSOLUTE_TTL_MS
} from "@/server/recovery/service";

export const RECOVERY_CHALLENGE_COOKIE = "acc01a_recovery_challenge";
export const RECOVERY_SESSION_COOKIE = "acc01a_recovery";

const sharedCookieAttributes = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/"
};

export function recoveryCookiesAreSecure(
  environment: Record<string, string | undefined> = process.env
) {
  return isRecoveryProductionLikeEnvironment(environment);
}

function boundedMaxAge(expiresAt: Date, now: Date, maximumMilliseconds: number) {
  const remainingMilliseconds = Math.max(0, expiresAt.getTime() - now.getTime());
  return Math.min(
    Math.floor(maximumMilliseconds / 1000),
    Math.floor(remainingMilliseconds / 1000)
  );
}

export function readRecoveryCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const values = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0 || part.slice(0, separator) !== name) return [];
      return [part.slice(separator + 1)];
    });

  return values.length === 1 && values[0] ? values[0] : null;
}

export function setRecoveryChallengeCookie(
  response: NextResponse,
  rawToken: string,
  expiresAt: Date,
  options: { now?: Date; secure?: boolean } = {}
) {
  response.cookies.set(RECOVERY_CHALLENGE_COOKIE, rawToken, {
    ...sharedCookieAttributes,
    secure: options.secure ?? recoveryCookiesAreSecure(),
    maxAge: boundedMaxAge(expiresAt, options.now ?? new Date(), RECOVERY_OTP_TTL_MS)
  });
}

export function clearRecoveryChallengeCookie(
  response: NextResponse,
  options: { secure?: boolean } = {}
) {
  response.cookies.set(RECOVERY_CHALLENGE_COOKIE, "", {
    ...sharedCookieAttributes,
    secure: options.secure ?? recoveryCookiesAreSecure(),
    maxAge: 0,
    expires: new Date(0)
  });
}

export function setRecoverySessionCookie(
  response: NextResponse,
  rawToken: string,
  expiresAt: Date,
  options: { now?: Date; secure?: boolean } = {}
) {
  response.cookies.set(RECOVERY_SESSION_COOKIE, rawToken, {
    ...sharedCookieAttributes,
    secure: options.secure ?? recoveryCookiesAreSecure(),
    maxAge: boundedMaxAge(
      expiresAt,
      options.now ?? new Date(),
      RECOVERY_SESSION_ABSOLUTE_TTL_MS
    )
  });
}

export function clearRecoverySessionCookie(
  response: NextResponse,
  options: { secure?: boolean } = {}
) {
  response.cookies.set(RECOVERY_SESSION_COOKIE, "", {
    ...sharedCookieAttributes,
    secure: options.secure ?? recoveryCookiesAreSecure(),
    maxAge: 0,
    expires: new Date(0)
  });
}
