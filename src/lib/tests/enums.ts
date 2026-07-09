import type { ExamMode, TestMode, TestStatus } from "@prisma/client";

export function toPrismaTestMode(mode: "training" | "ce_ct"): TestMode {
  return mode === "ce_ct" ? "CE_CT" : "TRAINING";
}

export function fromPrismaTestMode(mode: TestMode) {
  return mode === "CE_CT" ? "ce_ct" : "training";
}

export function toPrismaExamMode(mode: "generic" | "rikz_russian_2026"): ExamMode {
  return mode === "rikz_russian_2026" ? "RIKZ_RUSSIAN_2026" : "GENERIC";
}

export function fromPrismaExamMode(mode: ExamMode) {
  return mode === "RIKZ_RUSSIAN_2026" ? "rikz_russian_2026" : "generic";
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
