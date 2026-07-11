-- An order can have only one checkout that is still payable at a time.
-- Terminal attempts remain available for audit and for a later retry.
CREATE UNIQUE INDEX "commercial_payment_attempts_one_active_per_order"
  ON "commercial_payment_attempts" ("commercial_order_id")
  WHERE "status" IN ('created', 'pending');

CREATE INDEX "commercial_orders_product_email_pending_idx"
  ON "commercial_orders" ("commercial_product_id", "email_normalized")
  WHERE "status" IN ('created', 'pending');
