import { z } from "zod";
import { MVP_DEFAULTS, QUESTION_TYPES, TEST_MODES, TEST_STATUSES } from "@/lib/mvp-constants";
import { normalizedEmailSchema } from "@/lib/validation/email";

export const subjectSchema = z.literal(MVP_DEFAULTS.subject);

export const testModeSchema = z.enum(TEST_MODES);

export const testStatusSchema = z.enum(TEST_STATUSES);

export const questionTypeSchema = z.enum(QUESTION_TYPES);

export const studentIdentifySchema = z.object({
  email: normalizedEmailSchema,
  name: z.string().trim().min(1).max(120).optional()
});

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const createTestBaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subject: subjectSchema.default(MVP_DEFAULTS.subject),
  mode: testModeSchema.default("training"),
  shortDescription: z.string().trim().max(500).optional(),
  fullDescription: z.string().trim().max(5000).optional(),
  price: z.number().int().min(0),
  currency: z.string().trim().length(3).default(MVP_DEFAULTS.currency),
  durationMinutes: z.number().int().min(1).max(600),
  attemptsLimit: z.number().int().min(1).max(10).default(MVP_DEFAULTS.attemptsLimit),
  accessDays: z.number().int().min(1).max(365).default(MVP_DEFAULTS.accessDays)
});

export const accessCheckSchema = z.object({
  email: normalizedEmailSchema,
  testId: uuidSchema
});

export const importModeSchema = z.enum(["append", "replace"]);
