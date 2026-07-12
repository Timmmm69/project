import { z } from "zod";
import { normalizedEmailSchema } from "@/lib/validation/email";

export const commercialOrderSchema = z.object({
  productCode: z.literal("russian-training-variant-01"),
  checkout_flow_id: z.string().uuid(),
  email: normalizedEmailSchema,
  adultBuyerConfirmed: z.literal(true),
  legalBundleVersion: z.string().trim().min(1).max(100)
}).strict();

export const commercialCheckoutFlowSchema = z.object({
  productCode: z.literal("russian-training-variant-01")
}).strict();

export const commercialCheckoutFlowIdSchema = z.string().uuid();

export const commercialIdempotencyKeySchema = z.string().trim().min(16).max(200);

export const commercialPublicIdSchema = z.string().trim().min(10).max(100);
