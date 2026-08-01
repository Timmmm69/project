ALTER TABLE "commercial_orders"
  ADD COLUMN "attempt_limit_snapshot" INTEGER,
  ADD COLUMN "start_window_days_snapshot" INTEGER,
  ADD COLUMN "duration_minutes_snapshot" INTEGER,
  ADD COLUMN "result_retention_days_snapshot" INTEGER,
  ADD COLUMN "exam_mode_snapshot" "exam_mode",
  ADD COLUMN "result_display_mode_snapshot" TEXT;

UPDATE "commercial_orders" AS "order"
SET
  "attempt_limit_snapshot" = "product"."attempt_limit",
  "start_window_days_snapshot" = "product"."start_window_days",
  "duration_minutes_snapshot" = "test"."duration_minutes",
  "result_retention_days_snapshot" = "product"."result_retention_days",
  "exam_mode_snapshot" = "test"."exam_mode",
  "result_display_mode_snapshot" = 'PRIMARY_ONLY'
FROM "commercial_products" AS "product"
JOIN "tests" AS "test" ON "test"."id" = "product"."test_id"
WHERE "order"."commercial_product_id" = "product"."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "commercial_orders"
    WHERE "attempt_limit_snapshot" IS NULL
      OR "start_window_days_snapshot" IS NULL
      OR "duration_minutes_snapshot" IS NULL
      OR "result_retention_days_snapshot" IS NULL
      OR "exam_mode_snapshot" IS NULL
      OR "result_display_mode_snapshot" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill immutable commercial order snapshot';
  END IF;
END $$;

ALTER TABLE "commercial_orders"
  ALTER COLUMN "attempt_limit_snapshot" SET NOT NULL,
  ALTER COLUMN "attempt_limit_snapshot" SET DEFAULT 1,
  ALTER COLUMN "start_window_days_snapshot" SET NOT NULL,
  ALTER COLUMN "start_window_days_snapshot" SET DEFAULT 90,
  ALTER COLUMN "duration_minutes_snapshot" SET NOT NULL,
  ALTER COLUMN "duration_minutes_snapshot" SET DEFAULT 120,
  ALTER COLUMN "result_retention_days_snapshot" SET NOT NULL,
  ALTER COLUMN "result_retention_days_snapshot" SET DEFAULT 365,
  ALTER COLUMN "exam_mode_snapshot" SET NOT NULL,
  ALTER COLUMN "exam_mode_snapshot" SET DEFAULT 'rikz_russian_2026',
  ALTER COLUMN "result_display_mode_snapshot" SET NOT NULL,
  ALTER COLUMN "result_display_mode_snapshot" SET DEFAULT 'PRIMARY_ONLY',
  ADD CONSTRAINT "commercial_order_attempt_limit_snapshot_positive"
    CHECK ("attempt_limit_snapshot" > 0),
  ADD CONSTRAINT "commercial_order_start_window_snapshot_positive"
    CHECK ("start_window_days_snapshot" > 0),
  ADD CONSTRAINT "commercial_order_duration_snapshot_positive"
    CHECK ("duration_minutes_snapshot" > 0),
  ADD CONSTRAINT "commercial_order_retention_snapshot_positive"
    CHECK ("result_retention_days_snapshot" > 0),
  ADD CONSTRAINT "commercial_order_result_display_snapshot_known"
    CHECK ("result_display_mode_snapshot" = 'PRIMARY_ONLY');
