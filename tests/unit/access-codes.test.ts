import { describe, expect, it, vi } from "vitest";
import { generateAccessCode, hashAccessCode, normalizeAccessCode } from "@/lib/access/access-codes";

describe("access code helpers", () => {
  it("normalizes spaces, hyphens and letter case", () => {
    expect(normalizeAccessCode(" abcd- ef12  ")).toBe("ABCDEF12");
  });

  it("hashes normalized code instead of returning raw code", () => {
    vi.stubEnv("ACCESS_CODE_HASH_PEPPER", "test-pepper");
    const left = hashAccessCode("abcd-ef12");
    const right = hashAccessCode(" ABCD EF12 ");

    expect(left).toBe(right);
    expect(left).not.toContain("ABCDEF12");
    expect(left).toHaveLength(64);
    vi.unstubAllEnvs();
  });

  it("generates human-readable one-time codes", () => {
    expect(generateAccessCode()).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  });
});
