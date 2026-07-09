ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE "payment_provider" ADD VALUE IF NOT EXISTS 'expresspay_epos';

ALTER TABLE "payments"
  ADD COLUMN "provider_invoice_id" TEXT,
  ADD COLUMN "provider_account_number" TEXT,
  ADD COLUMN "payment_url" TEXT,
  ADD COLUMN "qr_code_url" TEXT,
  ADD COLUMN "qr_code_payload" TEXT,
  ADD COLUMN "payment_instructions" TEXT,
  ADD COLUMN "provider_status" TEXT,
  ADD COLUMN "provider_webhook_payload_json" JSONB,
  ADD COLUMN "npd_receipt_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "npd_receipt_created" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "npd_receipt_created_at" TIMESTAMP(3),
  ADD COLUMN "npd_receipt_note" TEXT,
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "expired_at" TIMESTAMP(3);

CREATE INDEX "payments_provider_idx" ON "payments"("provider");
CREATE INDEX "payments_provider_status_idx" ON "payments"("provider_status");
CREATE INDEX "payments_npd_receipt_required_npd_receipt_created_idx"
  ON "payments"("npd_receipt_required", "npd_receipt_created");
