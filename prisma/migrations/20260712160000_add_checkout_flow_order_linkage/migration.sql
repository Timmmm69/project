-- Persist one server-generated checkout flow per paid-checkout opening.
CREATE TABLE "commercial_checkout_flows" (
    "id" UUID NOT NULL,
    "commercial_product_id" UUID NOT NULL,
    "test_id_snapshot" UUID NOT NULL,
    "exam_mode_snapshot" "exam_mode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commercial_checkout_flows_pkey" PRIMARY KEY ("id")
);

-- Existing orders remain valid; all orders created through the new commercial
-- checkout API receive this value.
ALTER TABLE "commercial_orders" ADD COLUMN "checkout_flow_id" UUID;

CREATE UNIQUE INDEX "commercial_orders_checkout_flow_id_key"
  ON "commercial_orders"("checkout_flow_id");
CREATE INDEX "commercial_checkout_flows_commercial_product_id_idx"
  ON "commercial_checkout_flows"("commercial_product_id");
CREATE INDEX "commercial_checkout_flows_test_id_snapshot_idx"
  ON "commercial_checkout_flows"("test_id_snapshot");

ALTER TABLE "commercial_checkout_flows"
  ADD CONSTRAINT "commercial_checkout_flows_commercial_product_id_fkey"
  FOREIGN KEY ("commercial_product_id") REFERENCES "commercial_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_orders"
  ADD CONSTRAINT "commercial_orders_checkout_flow_id_fkey"
  FOREIGN KEY ("checkout_flow_id") REFERENCES "commercial_checkout_flows"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
