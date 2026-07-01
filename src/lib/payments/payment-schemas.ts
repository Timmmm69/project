import { z } from "zod";
import { uuidSchema } from "@/lib/validation/schemas";
import { normalizedEmailSchema } from "@/lib/validation/email";

export const publicCreatePaymentSchema = z.object({
  email: normalizedEmailSchema,
  testId: uuidSchema,
  provider: z.literal("mock").default("mock")
});

export const mockPaymentWebhookSchema = z.object({
  paymentId: uuidSchema,
  status: z.enum(["success", "failed"]).default("success")
});

export const adminPaymentListQuerySchema = z.object({
  testId: uuidSchema.optional(),
  email: normalizedEmailSchema.optional(),
  status: z.enum(["pending", "success", "failed", "cancelled", "refunded"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
