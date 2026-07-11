-- CreateEnum
CREATE TYPE "commercial_order_status" AS ENUM ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "commercial_payment_provider" AS ENUM ('webpay_sandbox', 'local_fake');

-- CreateEnum
CREATE TYPE "commercial_payment_attempt_status" AS ENUM ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "commercial_payment_event_status" AS ENUM ('received', 'processed', 'rejected');

-- AlterEnum
ALTER TYPE "access_source" ADD VALUE IF NOT EXISTS 'commercial';

-- AlterTable
ALTER TABLE "accesses"
  ADD COLUMN "commercial_order_id" UUID,
  ADD COLUMN "commercial_payment_attempt_id" UUID,
  ADD COLUMN "commercial_product_id" UUID,
  ADD COLUMN "granted_at" TIMESTAMP(3),
  ADD COLUMN "start_deadline_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "commercial_products" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "test_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "price_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BYN',
  "attempt_limit" INTEGER NOT NULL DEFAULT 1,
  "start_window_days" INTEGER NOT NULL DEFAULT 90,
  "result_retention_days" INTEGER NOT NULL DEFAULT 365,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_orders" (
  "id" UUID NOT NULL,
  "public_id" TEXT NOT NULL,
  "commercial_product_id" UUID NOT NULL,
  "test_id_snapshot" UUID NOT NULL,
  "product_name_snapshot" TEXT NOT NULL,
  "price_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BYN',
  "email_original" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "status" "commercial_order_status" NOT NULL DEFAULT 'created',
  "offer_version" TEXT NOT NULL,
  "privacy_version" TEXT NOT NULL,
  "refund_policy_version" TEXT NOT NULL,
  "disclaimer_version" TEXT NOT NULL,
  "adult_buyer_confirmed_at" TIMESTAMP(3) NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "lookup_token_hash" TEXT NOT NULL,
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_payment_attempts" (
  "id" UUID NOT NULL,
  "commercial_order_id" UUID NOT NULL,
  "provider" "commercial_payment_provider" NOT NULL,
  "merchant_reference" TEXT NOT NULL,
  "provider_payment_id" TEXT,
  "status" "commercial_payment_attempt_status" NOT NULL DEFAULT 'created',
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BYN',
  "payment_url" TEXT,
  "provider_fields_json" JSONB,
  "expires_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "failure_code" TEXT,
  "failure_message_safe" TEXT,
  "checkout_idempotency_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_payment_events" (
  "id" UUID NOT NULL,
  "commercial_payment_attempt_id" UUID,
  "provider" "commercial_payment_provider" NOT NULL,
  "provider_event_key" TEXT,
  "payload_hash" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "signature_valid" BOOLEAN NOT NULL,
  "processing_status" "commercial_payment_event_status" NOT NULL DEFAULT 'received',
  "processing_error_code" TEXT,
  "redacted_payload_json" JSONB,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "commercial_payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commercial_products_code_key" ON "commercial_products"("code");
CREATE INDEX "commercial_products_test_id_idx" ON "commercial_products"("test_id");
CREATE INDEX "commercial_products_is_active_idx" ON "commercial_products"("is_active");
CREATE UNIQUE INDEX "commercial_orders_public_id_key" ON "commercial_orders"("public_id");
CREATE INDEX "commercial_orders_email_normalized_status_idx" ON "commercial_orders"("email_normalized", "status");
CREATE INDEX "commercial_orders_test_id_snapshot_idx" ON "commercial_orders"("test_id_snapshot");
CREATE UNIQUE INDEX "commercial_orders_product_id_idempotency_key" ON "commercial_orders"("commercial_product_id", "idempotency_key");
CREATE UNIQUE INDEX "commercial_payment_attempts_merchant_reference_key" ON "commercial_payment_attempts"("merchant_reference");
CREATE INDEX "commercial_payment_attempts_order_id_status_idx" ON "commercial_payment_attempts"("commercial_order_id", "status");
CREATE UNIQUE INDEX "commercial_payment_attempts_order_id_checkout_key" ON "commercial_payment_attempts"("commercial_order_id", "checkout_idempotency_key");
CREATE UNIQUE INDEX "commercial_payment_attempts_provider_payment_id_key" ON "commercial_payment_attempts"("provider", "provider_payment_id");
CREATE INDEX "commercial_payment_events_attempt_id_idx" ON "commercial_payment_events"("commercial_payment_attempt_id");
CREATE UNIQUE INDEX "commercial_payment_events_provider_payload_hash_key" ON "commercial_payment_events"("provider", "payload_hash");
CREATE UNIQUE INDEX "commercial_payment_events_provider_event_key_unique" ON "commercial_payment_events"("provider", "provider_event_key") WHERE "provider_event_key" IS NOT NULL;
CREATE UNIQUE INDEX "accesses_commercial_order_id_key" ON "accesses"("commercial_order_id");
CREATE UNIQUE INDEX "accesses_commercial_payment_attempt_id_key" ON "accesses"("commercial_payment_attempt_id");
CREATE INDEX "accesses_commercial_product_id_idx" ON "accesses"("commercial_product_id");

ALTER TABLE "accesses" ADD CONSTRAINT "accesses_commercial_product_id_fkey" FOREIGN KEY ("commercial_product_id") REFERENCES "commercial_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_commercial_order_id_fkey" FOREIGN KEY ("commercial_order_id") REFERENCES "commercial_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_commercial_payment_attempt_id_fkey" FOREIGN KEY ("commercial_payment_attempt_id") REFERENCES "commercial_payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commercial_products" ADD CONSTRAINT "commercial_products_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_orders" ADD CONSTRAINT "commercial_orders_product_id_fkey" FOREIGN KEY ("commercial_product_id") REFERENCES "commercial_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_payment_attempts" ADD CONSTRAINT "commercial_payment_attempts_order_id_fkey" FOREIGN KEY ("commercial_order_id") REFERENCES "commercial_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_payment_events" ADD CONSTRAINT "commercial_payment_events_attempt_id_fkey" FOREIGN KEY ("commercial_payment_attempt_id") REFERENCES "commercial_payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
