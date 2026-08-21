import type { NextResponse } from "next/server";
import { isVerifiedStudentSessionProductionLikeEnvironment } from "@/server/auth/verified-student-session/config";
import { VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS } from "@/server/auth/verified-student-session/service";

export const VERIFIED_STUDENT_SESSION_COOKIE = "verified_student_session";

export type VerifiedStudentSessionCookieErrorCode =
  | "EXPIRED"
  | "INSECURE_PRODUCTION_LIKE";

export class VerifiedStudentSessionCookieError extends Error {
  constructor(readonly code: VerifiedStudentSessionCookieErrorCode) {
    super(`VERIFIED_STUDENT_SESSION_COOKIE_REJECTED:${code}`);
    this.name = "VerifiedStudentSessionCookieError";
  }
}

export function verifiedStudentSessionCookieOptions(
  expiresAt: Date,
  options: {
    now?: Date;
    secure?: boolean;
    environment?: Record<string, string | undefined>;
  } = {}
) {
  const now = options.now ?? new Date();
  const environment = options.environment ?? process.env;
  const productionLike = isVerifiedStudentSessionProductionLikeEnvironment(environment);
  if (productionLike && options.secure === false) {
    throw new VerifiedStudentSessionCookieError("INSECURE_PRODUCTION_LIKE");
  }

  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    throw new VerifiedStudentSessionCookieError("EXPIRED");
  }
  const maxAge = Math.floor(Math.min(remainingMs, VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS) / 1000);

  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: productionLike || options.secure === true,
    path: "/" as const,
    expires: new Date(expiresAt),
    maxAge
  };
}

export function setVerifiedStudentSessionCookie(
  response: NextResponse,
  rawToken: string,
  expiresAt: Date,
  options: Parameters<typeof verifiedStudentSessionCookieOptions>[1] = {}
) {
  const cookie = verifiedStudentSessionCookieOptions(expiresAt, options);
  const attributes = [
    `Path=${cookie.path}`,
    `Expires=${cookie.expires.toUTCString()}`,
    `Max-Age=${cookie.maxAge}`,
    cookie.secure ? "Secure" : null,
    cookie.httpOnly ? "HttpOnly" : null,
    `SameSite=${cookie.sameSite}`
  ].filter((attribute): attribute is string => attribute !== null);

  // NextResponse.cookies.set() recalculates Expires from Date.now() whenever
  // Max-Age is present. Serializing here preserves the server-authoritative row
  // expiry while retaining the bounded Max-Age accepted by B1-01.
  response.headers.append(
    "set-cookie",
    `${VERIFIED_STUDENT_SESSION_COOKIE}=${encodeURIComponent(rawToken)}; ${attributes.join("; ")}`
  );
}

export function clearVerifiedStudentSessionCookie(
  response: NextResponse,
  environment: Record<string, string | undefined> = process.env
) {
  response.cookies.set(VERIFIED_STUDENT_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isVerifiedStudentSessionProductionLikeEnvironment(environment),
    path: "/",
    expires: new Date(0),
    maxAge: 0
  });
}
