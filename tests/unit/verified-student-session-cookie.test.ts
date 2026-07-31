import { describe, expect, it } from "vitest";
import {
  verifiedStudentSessionCookieOptions,
  VerifiedStudentSessionCookieError
} from "@/server/auth/verified-student-session/cookies";
import { VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS } from "@/server/auth/verified-student-session/service";

describe("verified student session cookie policy", () => {
  const now = new Date("2026-07-31T10:00:00.000Z");
  const expiresAt = new Date(now.getTime() + VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS);

  it("uses an opaque host-only HttpOnly Lax cookie bounded by row expiry", () => {
    expect(verifiedStudentSessionCookieOptions(expiresAt, {
      now,
      environment: { NODE_ENV: "test" }
    })).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: expiresAt,
      maxAge: VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS / 1000
    });
  });

  it("never extends Max-Age beyond the seven-day absolute TTL", () => {
    const laterExpiry = new Date(now.getTime() + VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS * 2);
    expect(verifiedStudentSessionCookieOptions(laterExpiry, {
      now,
      environment: { NODE_ENV: "test" }
    }).maxAge).toBe(VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS / 1000);
  });

  it("forces Secure in every production-like environment", () => {
    expect(verifiedStudentSessionCookieOptions(expiresAt, {
      now,
      environment: { VERCEL_ENV: "preview" }
    }).secure).toBe(true);
  });

  it("fails closed on an insecure production-like override", () => {
    expect(() => verifiedStudentSessionCookieOptions(expiresAt, {
      now,
      secure: false,
      environment: { APP_ENV: "production" }
    })).toThrowError(VerifiedStudentSessionCookieError);
  });

  it("refuses to issue an already expired cookie", () => {
    expect(() => verifiedStudentSessionCookieOptions(now, {
      now,
      environment: { NODE_ENV: "test" }
    })).toThrowError(VerifiedStudentSessionCookieError);
  });
});
