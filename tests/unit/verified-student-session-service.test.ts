import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { VerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import { createVerifiedStudentSessionService } from "@/server/auth/verified-student-session/service";
import {
  createVerifiedStudentSessionToken,
  digestVerifiedStudentSessionToken
} from "@/server/auth/verified-student-session/token";

const ids = {
  session: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  test: "44444444-4444-4444-8444-444444444444",
  access: "55555555-5555-4555-8555-555555555555"
} as const;

const now = new Date("2026-07-16T10:00:00.000Z");
const config: VerifiedStudentSessionConfig = {
  mode: "enforce",
  activeKeyVersion: "v1",
  keys: new Map([["v1", Buffer.alloc(32, 91)]])
};

function fixture(overrides: Record<string, unknown> = {}) {
  const rawToken = createVerifiedStudentSessionToken("v1");
  const session = {
    id: ids.session,
    tokenDigest: digestVerifiedStudentSessionToken(rawToken, config),
    tokenKeyVersion: "v1",
    tokenGeneration: 1,
    issuedAt: new Date("2026-07-15T10:00:00.000Z"),
    expiresAt: new Date("2026-07-22T10:00:00.000Z"),
    revokedAt: null,
    source: "COMMERCIAL_ORDER_CLAIM",
    sourceReferenceId: "source-reference",
    issuanceOperationId: "issuance-operation",
    userId: ids.user,
    commercialProductId: ids.product,
    testId: ids.test,
    accessId: ids.access,
    user: { id: ids.user, role: "STUDENT", deletedAt: null },
    product: { id: ids.product, testId: ids.test },
    test: { id: ids.test },
    access: {
      id: ids.access,
      userId: ids.user,
      testId: ids.test,
      source: "COMMERCIAL",
      commercialProductId: ids.product,
      attemptsAvailable: 1,
      revokedAt: null,
      expiresAt: new Date("2026-07-16T09:59:59.000Z"),
      attempts: []
    },
    ...overrides
  };
  const findUnique = vi.fn(async () => session);
  const service = createVerifiedStudentSessionService({
    client: { verifiedStudentSession: { findUnique } } as unknown as PrismaClient,
    config,
    clock: vi.fn(() => new Date(now))
  });
  return { rawToken, session, service, findUnique };
}

describe("verified student session narrow entry resolution", () => {
  it("keeps common ACCESS_EXPIRED opaque and preserves exact scope only for resolveForEntry", async () => {
    const { rawToken, service } = fixture();
    expect(await service.resolve(rawToken)).toEqual({ status: "ACCESS_EXPIRED" });
    expect(await service.resolveForEntry(rawToken)).toMatchObject({
      status: "RESOLVED_ACCESS_EXPIRED",
      sessionId: ids.session,
      scope: {
        userId: ids.user,
        commercialProductId: ids.product,
        testId: ids.test,
        accessId: ids.access
      }
    });
  });

  it("rejects malformed tokens before loading session state", async () => {
    const { service, findUnique } = fixture();
    expect(await service.resolveForEntry("invalid-token")).toEqual({ status: "INVALID_TOKEN" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["expired verified session", { expiresAt: new Date("2026-07-16T09:59:59.000Z") }, "EXPIRED"],
    ["revoked verified session", { revokedAt: now }, "REVOKED"],
    ["deleted subject", { user: { id: ids.user, role: "STUDENT", deletedAt: now } }, "SUBJECT_INVALID"],
    ["revoked Access", {
      access: {
        id: ids.access,
        userId: ids.user,
        testId: ids.test,
        source: "COMMERCIAL",
        commercialProductId: ids.product,
        attemptsAvailable: 1,
        revokedAt: now,
        expiresAt: new Date("2026-07-16T09:59:59.000Z"),
        attempts: []
      }
    }, "ACCESS_REVOKED"],
    ["scope mismatch", { product: { id: ids.product, testId: "wrong-test" } }, "SCOPE_MISMATCH"]
  ] as const)("does not preserve scope for %s", async (_label, overrides, status) => {
    const { rawToken, service } = fixture(overrides);
    expect(await service.resolveForEntry(rawToken)).toEqual({ status });
  });

  it.each([
    ["unknown session source", { source: "UNKNOWN_SOURCE" }],
    ["non-commercial Access", {
      access: {
        id: ids.access,
        userId: ids.user,
        testId: ids.test,
        source: "MANUAL",
        commercialProductId: ids.product,
        attemptsAvailable: 1,
        revokedAt: null,
        expiresAt: new Date("2026-07-16T09:59:59.000Z"),
        attempts: []
      }
    }],
    ["corrupt zero counter", {
      access: {
        id: ids.access,
        userId: ids.user,
        testId: ids.test,
        source: "COMMERCIAL",
        commercialProductId: ids.product,
        attemptsAvailable: 0,
        revokedAt: null,
        expiresAt: new Date("2026-07-16T09:59:59.000Z"),
        attempts: []
      }
    }],
    ["more than one Attempt", {
      access: {
        id: ids.access,
        userId: ids.user,
        testId: ids.test,
        source: "COMMERCIAL",
        commercialProductId: ids.product,
        attemptsAvailable: 1,
        revokedAt: null,
        expiresAt: new Date("2026-07-16T09:59:59.000Z"),
        attempts: [
          { userId: ids.user, testId: ids.test, accessId: ids.access, status: "STARTED" },
          { userId: ids.user, testId: ids.test, accessId: ids.access, status: "COMPLETED" }
        ]
      }
    }]
  ])("keeps %s fail-closed without entry scope", async (_label, overrides) => {
    const { rawToken, service } = fixture(overrides);
    expect(await service.resolveForEntry(rawToken)).toEqual({ status: "ACCESS_EXPIRED" });
  });

  it.each(["STARTED", "COMPLETED", "EXPIRED"])(
    "preserves exact %s Attempt routing authority after Access expiry",
    async (status) => {
      const { rawToken, service } = fixture({
        access: {
          id: ids.access,
          userId: ids.user,
          testId: ids.test,
          source: "COMMERCIAL",
          commercialProductId: ids.product,
          attemptsAvailable: 0,
          revokedAt: null,
          expiresAt: new Date("2026-07-16T09:59:59.000Z"),
          attempts: [{ userId: ids.user, testId: ids.test, accessId: ids.access, status }]
        }
      });
      expect(await service.resolveForEntry(rawToken)).toMatchObject({ status: "RESOLVED" });
    }
  );
});
