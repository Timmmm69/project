-- Add opaque public identifiers without changing existing primary keys.
ALTER TABLE "commercial_payment_attempts" ADD COLUMN "public_id" TEXT;
UPDATE "commercial_payment_attempts"
SET "public_id" = 'cpa_' || replace(gen_random_uuid()::text, '-', '')
WHERE "public_id" IS NULL;
ALTER TABLE "commercial_payment_attempts" ALTER COLUMN "public_id" SET NOT NULL;
CREATE UNIQUE INDEX "commercial_payment_attempts_public_id_key" ON "commercial_payment_attempts"("public_id");

ALTER TABLE "accesses" ADD COLUMN "public_id" TEXT;
UPDATE "accesses"
SET "public_id" = 'acc_' || replace(gen_random_uuid()::text, '-', '')
WHERE "public_id" IS NULL;
ALTER TABLE "accesses" ALTER COLUMN "public_id" SET NOT NULL;
CREATE UNIQUE INDEX "accesses_public_id_key" ON "accesses"("public_id");

-- Canonical analytics is intentionally separate from the operational event_logs table.
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "transition_key" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "environment" TEXT NOT NULL,
    "traffic_class" TEXT NOT NULL,
    "traffic_class_assignment_source" TEXT NOT NULL,
    "emitting_layer" TEXT NOT NULL,
    "analytics_id_key_version" TEXT,
    "properties_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analytics_events_event_id_key" ON "analytics_events"("event_id");
CREATE UNIQUE INDEX "analytics_events_transition_key_key" ON "analytics_events"("transition_key");
CREATE INDEX "analytics_events_event_name_idx" ON "analytics_events"("event_name");
CREATE INDEX "analytics_events_occurred_at_idx" ON "analytics_events"("occurred_at");
CREATE INDEX "analytics_events_environment_idx" ON "analytics_events"("environment");
CREATE INDEX "analytics_events_traffic_class_idx" ON "analytics_events"("traffic_class");
