import { z } from "zod";
import { normalizedEmailSchema } from "@/lib/validation/email";
import { uuidSchema } from "@/lib/validation/schemas";

export const publicActivateAccessCodeSchema = z.object({
  email: normalizedEmailSchema,
  testId: uuidSchema,
  code: z.string().trim().min(4).max(80)
});

export const adminAccessListQuerySchema = z.object({
  testId: uuidSchema.optional(),
  email: normalizedEmailSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const adminCreateManualAccessSchema = z.object({
  email: normalizedEmailSchema,
  testId: uuidSchema,
  attemptsTotal: z.number().int().min(1).max(10),
  accessDays: z.number().int().min(1).max(365),
  comment: z.string().trim().max(1000).optional()
});

export const adminRevokeAccessSchema = z.object({
  reason: z.string().trim().min(1).max(1000).optional()
});

export const adminAccessCodeListQuerySchema = z.object({
  testId: uuidSchema.optional(),
  status: z.enum(["active", "used", "expired", "revoked"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const adminCreateAccessCodeSchema = z.object({
  testId: uuidSchema,
  attemptsTotal: z.number().int().min(1).max(10),
  accessDays: z.number().int().min(1).max(365),
  codeExpiresDays: z.number().int().min(1).max(365).default(30),
  comment: z.string().trim().max(1000).optional()
});

export const adminRevokeAccessCodeSchema = z.object({
  reason: z.string().trim().min(1).max(1000).optional()
});
