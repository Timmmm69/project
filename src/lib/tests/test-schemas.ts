import { z } from "zod";
import { createTestBaseSchema, testModeSchema, testStatusSchema } from "@/lib/validation/schemas";

export const adminTestListQuerySchema = z.object({
  status: testStatusSchema.optional(),
  mode: testModeSchema.optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const adminCreateTestSchema = createTestBaseSchema;

export const adminUpdateTestSchema = createTestBaseSchema
  .partial()
  .extend({
    status: testStatusSchema.optional(),
    showScaledScore: z.boolean().optional(),
    showPercent: z.boolean().optional(),
    showCorrectAnswers: z.boolean().optional(),
    showTopicResult: z.boolean().optional(),
    showRecommendations: z.boolean().optional(),
    scoringSchemeId: z.string().uuid().nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });
