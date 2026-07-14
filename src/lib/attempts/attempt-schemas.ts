import { z } from "zod";
import { normalizedEmailSchema } from "@/lib/validation/email";
import { uuidSchema } from "@/lib/validation/schemas";

export const startAttemptSchema = z.object({
  email: normalizedEmailSchema,
  testId: uuidSchema
});

export const startAttemptRequestSchema = z.object({
  email: normalizedEmailSchema.optional(),
  testId: uuidSchema
});

export const saveAttemptAnswerSchema = z.object({
  snapshotQuestionId: z.string().trim().min(1).max(40),
  selectedAnswer: z.string().max(2000).nullable()
});
