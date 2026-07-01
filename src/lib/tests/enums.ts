import type { TestMode, TestStatus } from "@prisma/client";

export function toPrismaTestMode(mode: "training" | "ce_ct"): TestMode {
  return mode === "ce_ct" ? "CE_CT" : "TRAINING";
}

export function fromPrismaTestMode(mode: TestMode) {
  return mode === "CE_CT" ? "ce_ct" : "training";
}

export function toPrismaTestStatus(status: "draft" | "published" | "hidden" | "archived"): TestStatus {
  const statuses = {
    draft: "DRAFT",
    published: "PUBLISHED",
    hidden: "HIDDEN",
    archived: "ARCHIVED"
  } as const;
  return statuses[status];
}

export function fromPrismaTestStatus(status: TestStatus) {
  const statuses = {
    DRAFT: "draft",
    PUBLISHED: "published",
    HIDDEN: "hidden",
    ARCHIVED: "archived"
  } as const;
  return statuses[status];
}
