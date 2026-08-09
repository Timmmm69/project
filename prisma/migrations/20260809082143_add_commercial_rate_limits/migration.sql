-- CreateEnum
CREATE TYPE "commercial_rate_limit_kind" AS ENUM ('order_create', 'payment_session_create', 'status_refresh', 'checkout_flow', 'brute_force');

-- CreateTable
CREATE TABLE "commercial_rate_limit_events" (
    "id" UUID NOT NULL,
    "kind" "commercial_rate_limit_kind" NOT NULL,
    "key_digest" CHAR(64) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_rate_limit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commercial_rate_limit_events_kind_key_digest_occurred_at_idx" ON "commercial_rate_limit_events"("kind", "key_digest", "occurred_at");

-- CreateIndex
CREATE INDEX "commercial_rate_limit_events_expires_at_idx" ON "commercial_rate_limit_events"("expires_at");

-- CreateIndex
CREATE INDEX "commercial_payment_events_provider_provider_event_key_idx" ON "commercial_payment_events"("provider", "provider_event_key");

-- RenameForeignKey
ALTER TABLE "commercial_orders" RENAME CONSTRAINT "commercial_orders_product_id_fkey" TO "commercial_orders_commercial_product_id_fkey";

-- RenameForeignKey
ALTER TABLE "commercial_payment_attempts" RENAME CONSTRAINT "commercial_payment_attempts_order_id_fkey" TO "commercial_payment_attempts_commercial_order_id_fkey";

-- RenameForeignKey
ALTER TABLE "commercial_payment_events" RENAME CONSTRAINT "commercial_payment_events_attempt_id_fkey" TO "commercial_payment_events_commercial_payment_attempt_id_fkey";

-- RenameIndex
ALTER INDEX "commercial_orders_product_id_idempotency_key" RENAME TO "commercial_orders_commercial_product_id_idempotency_key_key";

-- RenameIndex
ALTER INDEX "commercial_payment_attempts_order_id_checkout_key" RENAME TO "commercial_payment_attempts_commercial_order_id_checkout_id_key";

-- RenameIndex
ALTER INDEX "commercial_payment_attempts_order_id_status_idx" RENAME TO "commercial_payment_attempts_commercial_order_id_status_idx";

-- RenameIndex
ALTER INDEX "commercial_payment_attempts_provider_payment_id_key" RENAME TO "commercial_payment_attempts_provider_provider_payment_id_key";

-- RenameIndex
ALTER INDEX "commercial_payment_events_attempt_id_idx" RENAME TO "commercial_payment_events_commercial_payment_attempt_id_idx";
