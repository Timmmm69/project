import { describe, expect, it } from "vitest";
import {
  ANALYTICS_ENTITY_ID_PATTERN,
  AnalyticsEntityIdError,
  createAnalyticsEntityId
} from "@/lib/analytics/entity-id";

const keyOne = Buffer.alloc(32, 1);
const keyTwo = Buffer.alloc(32, 2);
const keys = new Map<string, Uint8Array>([["v1", keyOne], ["v2", keyTwo]]);

function create(entity: "order" | "payment_attempt" | "access" | "attempt", publicId = "opaque-public-id-001", keyVersion = "v1", ring = keys) {
  return createAnalyticsEntityId({ entity, publicId, keyVersion, keys: ring });
}

describe("analytics entity IDs", () => {
  it("is stable and uses a fixed opaque format", () => {
    const first = create("order");
    expect(first).toBe(create("order"));
    expect(first).toMatch(ANALYTICS_ENTITY_ID_PATTERN);
  });

  it("separates entity namespaces for the same public ID", () => {
    expect(new Set([create("order"), create("payment_attempt"), create("access"), create("attempt")])).toHaveLength(4);
  });

  it("changes when key material or key version changes", () => {
    expect(create("order", "opaque-public-id-001", "v1")).not.toBe(create("order", "opaque-public-id-001", "v2"));
    const otherRing = new Map<string, Uint8Array>([["v1", Buffer.alloc(32, 9)]]);
    expect(create("order")).not.toBe(create("order", "opaque-public-id-001", "v1", otherRing));
  });

  it("rejects email-like source identifiers", () => {
    expect(() => create("order", "student@example.test")).toThrowError(AnalyticsEntityIdError);
    expect(() => create("order", "a".repeat(64))).toThrowError(AnalyticsEntityIdError);
  });

  it.each(["", "UPPER", "bad version", "v1."])("rejects malformed key version %s", (keyVersion) => {
    expect(() => create("order", "opaque-public-id-001", keyVersion)).toThrowError(AnalyticsEntityIdError);
  });

  it("rejects unknown key versions without exposing key or source values", () => {
    const secret = Buffer.alloc(32, 7);
    const source = "opaque-public-id-sensitive";
    try {
      createAnalyticsEntityId({ entity: "order", publicId: source, keyVersion: "retired", keys: new Map([["v1", secret]]) });
      throw new Error("EXPECTED_ENTITY_ID_FAILURE");
    } catch (error) {
      expect(error).toBeInstanceOf(AnalyticsEntityIdError);
      expect(String(error)).not.toContain(source);
      expect(String(error)).not.toContain(secret.toString("hex"));
    }
  });
});
