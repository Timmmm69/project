DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "commercial_orders"
    WHERE "status" IN ('created', 'pending')
    GROUP BY "commercial_product_id", "email_normalized"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot enforce one open commercial order: duplicate created/pending orders exist for the same product and normalized email',
      HINT = 'Resolve duplicate open commercial orders manually before applying this migration; no data was changed.';
  END IF;
END $$;

CREATE UNIQUE INDEX "commercial_orders_one_open_per_product_email"
  ON "commercial_orders" ("commercial_product_id", "email_normalized")
  WHERE "status" IN ('created', 'pending');
