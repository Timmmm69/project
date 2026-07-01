import type { Access, Attempt } from "@prisma/client";
import { normalizeEmail } from "@/lib/validation/email";
import { prisma } from "@/server/db/client";

export type AccessCheckStatus =
  | "can_start"
  | "continue_attempt"
  | "no_access"
  | "expired"
  | "revoked"
  | "no_attempts";

type AccessCheckAttempt = Pick<Attempt, "id" | "startedAt">;

type AccessCheckAccess = Pick<
  Access,
  "id" | "attemptsTotal" | "attemptsAvailable" | "expiresAt" | "revokedAt"
>;

export type AccessCheckResult = {
  hasAccess: boolean;
  status: AccessCheckStatus;
  userId: string | null;
  access: AccessCheckAccess | null;
  attempt: AccessCheckAttempt | null;
};

function serializeAccess(access: AccessCheckAccess | null) {
  if (!access) {
    return null;
  }

  return {
    id: access.id,
    attemptsTotal: access.attemptsTotal,
    attemptsAvailable: access.attemptsAvailable,
    expiresAt: access.expiresAt,
    revokedAt: access.revokedAt
  };
}

function serializeAttempt(attempt: AccessCheckAttempt | null) {
  if (!attempt) {
    return null;
  }

  return {
    id: attempt.id,
    startedAt: attempt.startedAt
  };
}

export function serializeAccessCheckResult(result: AccessCheckResult) {
  return {
    hasAccess: result.hasAccess,
    status: result.status,
    userId: result.userId,
    access: serializeAccess(result.access),
    attempt: serializeAttempt(result.attempt)
  };
}

export async function checkStudentAccess(input: {
  email: string;
  testId: string;
}): Promise<AccessCheckResult> {
  const email = normalizeEmail(input.email);
  const now = new Date();

  const user = await prisma.user.findFirst({
    where: {
      email,
      role: "STUDENT",
      deletedAt: null
    },
    select: { id: true }
  });

  if (!user) {
    return {
      hasAccess: false,
      status: "no_access",
      userId: null,
      access: null,
      attempt: null
    };
  }

  const startedAttempt = await prisma.attempt.findFirst({
    where: {
      userId: user.id,
      testId: input.testId,
      status: "STARTED"
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      startedAt: true,
      access: {
        select: {
          id: true,
          attemptsTotal: true,
          attemptsAvailable: true,
          expiresAt: true,
          revokedAt: true
        }
      }
    }
  });

  if (startedAttempt && !startedAttempt.access.revokedAt && startedAttempt.access.expiresAt > now) {
    return {
      hasAccess: true,
      status: "continue_attempt",
      userId: user.id,
      access: startedAttempt.access,
      attempt: {
        id: startedAttempt.id,
        startedAt: startedAttempt.startedAt
      }
    };
  }

  const accesses = await prisma.access.findMany({
    where: {
      userId: user.id,
      testId: input.testId
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      attemptsTotal: true,
      attemptsAvailable: true,
      expiresAt: true,
      revokedAt: true
    }
  });

  const usableAccess = accesses.find(
    (access) => !access.revokedAt && access.expiresAt > now && access.attemptsAvailable > 0
  );
  if (usableAccess) {
    return {
      hasAccess: true,
      status: "can_start",
      userId: user.id,
      access: usableAccess,
      attempt: null
    };
  }

  const notRevoked = accesses.filter((access) => !access.revokedAt);
  const notExpired = notRevoked.filter((access) => access.expiresAt > now);

  if (notExpired.some((access) => access.attemptsAvailable <= 0)) {
    return {
      hasAccess: false,
      status: "no_attempts",
      userId: user.id,
      access: notExpired[0] ?? null,
      attempt: null
    };
  }

  if (notRevoked.length > 0) {
    return {
      hasAccess: false,
      status: "expired",
      userId: user.id,
      access: notRevoked[0] ?? null,
      attempt: null
    };
  }

  if (accesses.length > 0) {
    return {
      hasAccess: false,
      status: "revoked",
      userId: user.id,
      access: accesses[0] ?? null,
      attempt: null
    };
  }

  return {
    hasAccess: false,
    status: "no_access",
    userId: user.id,
    access: null,
    attempt: null
  };
}
