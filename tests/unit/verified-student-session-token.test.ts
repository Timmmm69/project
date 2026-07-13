import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import {
  createVerifiedStudentSessionToken,
  digestVerifiedStudentSessionToken,
  parseVerifiedStudentSessionToken,
  VERIFIED_STUDENT_SESSION_DOMAIN_SEPARATOR,
  VERIFIED_STUDENT_SESSION_TOKEN_BYTES,
  verifiedStudentSessionDigestsEqual,
  VerifiedStudentSessionTokenError
} from "@/server/auth/verified-student-session/token";

const keyV1 = Buffer.alloc(32, 1);
const keyV2 = Buffer.alloc(32, 2);
const keys = new Map([
  ["v1", keyV1],
  ["v2", keyV2]
]);
const config: VerifiedStudentSessionConfig = {
  mode: "off",
  activeKeyVersion: "v1",
  keys
};

function expectTokenError(token: string, code: string) {
  try {
    parseVerifiedStudentSessionToken(token, keys);
    throw new Error("EXPECTED_TOKEN_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(VerifiedStudentSessionTokenError);
    expect((error as VerifiedStudentSessionTokenError).code).toBe(code);
  }
}

describe("verified student session token primitives", () => {
  it("contains exactly 32 OS-random secret bytes", () => {
    const token = createVerifiedStudentSessionToken("v1");
    const parsed = parseVerifiedStudentSessionToken(token, keys);
    expect(parsed.secret).toHaveLength(VERIFIED_STUDENT_SESSION_TOKEN_BYTES);
    expect(token).toMatch(/^vs1\.v1\.[A-Za-z0-9_-]{43}$/);
  });

  it("creates a different raw token on every issuance", () => {
    expect(createVerifiedStudentSessionToken("v1")).not.toBe(createVerifiedStudentSessionToken("v1"));
  });

  it("strictly accepts the versioned raw token format", () => {
    const token = createVerifiedStudentSessionToken("v1");
    expect(parseVerifiedStudentSessionToken(token, keys).keyVersion).toBe("v1");
  });

  it("rejects a malformed prefix", () => {
    const token = createVerifiedStudentSessionToken("v1").replace(/^vs1/, "legacy");
    expectTokenError(token, "MALFORMED");
  });

  it.each([
    "vs1.v1.short",
    `vs1.v1.${"a".repeat(42)}+`,
    `vs1.v1.${"a".repeat(44)}`,
    `vs1.v1.${"a".repeat(43)}.extra`
  ])("rejects malformed base64url or length: %s", (token) => {
    expectTokenError(token, "MALFORMED");
  });

  it("rejects an unknown key version before persistence lookup", () => {
    const secret = Buffer.alloc(32, 4).toString("base64url");
    expectTokenError(`vs1.retired.${secret}`, "UNKNOWN_KEY_VERSION");
  });

  it("produces a deterministic fixed-format digest for one token and key", () => {
    const token = createVerifiedStudentSessionToken("v1");
    const first = digestVerifiedStudentSessionToken(token, config);
    expect(first).toBe(digestVerifiedStudentSessionToken(token, config));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different digests for different key versions", () => {
    const secret = Buffer.alloc(32, 7).toString("base64url");
    expect(digestVerifiedStudentSessionToken(`vs1.v1.${secret}`, config))
      .not.toBe(digestVerifiedStudentSessionToken(`vs1.v2.${secret}`, config));
  });

  it("uses the dedicated verified-session domain separator", () => {
    const token = createVerifiedStudentSessionToken("v1");
    const verifiedDigest = digestVerifiedStudentSessionToken(token, config);
    const otherDomainDigest = createHmac("sha256", keyV1)
      .update("another-security-domain", "utf8")
      .update(token, "utf8")
      .digest("hex");
    expect(VERIFIED_STUDENT_SESSION_DOMAIN_SEPARATOR).toBe("verified-student-session:v1");
    expect(verifiedDigest).not.toBe(otherDomainDigest);
  });

  it("never represents the raw token as its digest", () => {
    const token = createVerifiedStudentSessionToken("v1");
    expect(digestVerifiedStudentSessionToken(token, config)).not.toBe(token);
  });

  it("compares only valid fixed-length digests safely", () => {
    const token = createVerifiedStudentSessionToken("v1");
    const digest = digestVerifiedStudentSessionToken(token, config);
    expect(verifiedStudentSessionDigestsEqual(digest, digest)).toBe(true);
    expect(verifiedStudentSessionDigestsEqual(digest, "0".repeat(64))).toBe(false);
    expect(verifiedStudentSessionDigestsEqual(digest, "not-a-digest")).toBe(false);
  });
});
