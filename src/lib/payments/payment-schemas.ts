import { z } from "zod";
import { uuidSchema } from "@/lib/validation/schemas";
import { normalizedEmailSchema } from "@/lib/validation/email";

export const publicCreatePaymentSchema = z.object({
  email: normalizedEmailSchema,
  testId: uuidSchema,
  provider: z.enum(["mock", "expresspay_epos"]).optional()
});

export const mockPaymentWebhookSchema = z.object({
  paymentId: uuidSchema,
  status: z.enum(["success", "failed"]).default("success")
});

export const adminPaymentListQuerySchema = z.object({
  testId: uuidSchema.optional(),
  email: normalizedEmailSchema.optional(),
  status: z.enum(["pending", "success", "failed", "cancelled", "expired", "refunded"]).optional(),
  provider: z.enum(["mock", "expresspay_epos", "manual", "bepaid", "webpay", "erip", "other"]).optional(),
  npdReceipt: z.enum(["missing", "created"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const adminNpdReceiptCreatedSchema = z.object({
  note: z.string().trim().max(500).optional()
});
