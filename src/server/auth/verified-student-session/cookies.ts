import type { NextResponse } from "next/server";
import { isRecoveryProductionLikeEnvironment } from "@/server/recovery/config";

export const VERIFIED_STUDENT_SESSION_COOKIE = "verified_student_session";

export function verifiedStudentSessionCookiesAreSecure(
  environment: Record<string, string | undefined> = process.env
) {
  return isRecoveryProductionLikeEnvironment(environment);
}

export function setVerifiedStudentSessionCookie(
  response: NextResponse,
  rawToken: string,
  expiresAt: Date,
  options: { now?: Date; secure?: boolean } = {}
) {
  const boundedExpiresAt = new Date(expiresAt);
  response.cookies.set(VERIFIED_STUDENT_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: options.secure ?? verifiedStudentSessionCookiesAreSecure(),
    path: "/",
    expires: boundedExpiresAt
  });
}
