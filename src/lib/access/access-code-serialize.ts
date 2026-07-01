import type { Prisma } from "@prisma/client";

export type AccessCodeWithRelations = Prisma.AccessCodeGetPayload<{
  include: {
    test: { select: { title: true; slug: true } };
    activatedByUser: { select: { email: true } };
    access: { select: { id: true } };
  };
}>;

export function serializeAccessCode(code: AccessCodeWithRelations) {
  return {
    id: code.id,
    testId: code.testId,
    testTitle: code.test.title,
    testSlug: code.test.slug,
    status: code.status.toLowerCase(),
    attemptsTotal: code.attemptsTotal,
    accessDays: code.accessDays,
    codeExpiresAt: code.codeExpiresAt,
    activatedByEmail: code.activatedByUser?.email ?? null,
    activatedAt: code.activatedAt,
    accessId: code.access?.id ?? null,
    revokedAt: code.revokedAt,
    revokedReason: code.revokedReason,
    comment: code.comment,
    createdAt: code.createdAt
  };
}
