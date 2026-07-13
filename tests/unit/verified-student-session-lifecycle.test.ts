import { describe, expect, it } from "vitest";
import {
  isVerifiedStudentSessionActive,
  VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS,
  verifiedStudentSessionExpiresAt
} from "@/server/auth/verified-student-session/service";

describe("verified student session absolute lifecycle", () => {
  const issuedAt = new Date("2026-07-13T12:00:00.000Z");
  const expiresAt = verifiedStudentSessionExpiresAt(issuedAt);

  it("sets an exact seven-day absolute TTL", () => {
    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(VERIFIED_STUDENT_SESSION_ABSOLUTE_TTL_MS);
    expect(expiresAt.toISOString()).toBe("2026-07-20T12:00:00.000Z");
  });

  it("is active only before the absolute expiry", () => {
    expect(isVerifiedStudentSessionActive({ revokedAt: null, expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(isVerifiedStudentSessionActive({ revokedAt: null, expiresAt }, expiresAt)).toBe(false);
  });

  it("treats a revoked session as inactive", () => {
    expect(isVerifiedStudentSessionActive({ revokedAt: issuedAt, expiresAt }, issuedAt)).toBe(false);
  });
});
