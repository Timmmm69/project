-- ACC-01A continuation adds only the committed recovery exchange outcome and
-- its closed audit vocabulary. It does not rewrite business data.

-- CreateEnum
CREATE TYPE "recovery_continuation_action" AS ENUM (
  'open_pre',
  'open_attempt',
  'open_result'
);

-- AlterEnum
ALTER TYPE "recovery_security_event_code" ADD VALUE 'verified_session_issued';
ALTER TYPE "recovery_security_event_code" ADD VALUE 'verified_session_rotated';

-- AlterTable
ALTER TABLE "verified_recovery_sessions"
  ADD COLUMN "continuation_operation_id" UUID,
  ADD COLUMN "continuation_next_action" "recovery_continuation_action",
  ADD COLUMN "continuation_next_url" TEXT,
  ADD COLUMN "continuation_verified_student_session_id" UUID,
  ADD COLUMN "continued_at" TIMESTAMP(3),
  ADD CONSTRAINT "verified_recovery_sessions_continuation_all_or_none_check" CHECK (
    (
      "continuation_operation_id" IS NULL
      AND "continuation_next_action" IS NULL
      AND "continuation_next_url" IS NULL
      AND "continuation_verified_student_session_id" IS NULL
      AND "continued_at" IS NULL
    ) OR (
      "continuation_operation_id" IS NOT NULL
      AND "continuation_next_action" IS NOT NULL
      AND "continuation_next_url" IS NOT NULL
      AND "continuation_verified_student_session_id" IS NOT NULL
      AND "continued_at" IS NOT NULL
    )
  );

-- CreateIndex
CREATE UNIQUE INDEX "verified_recovery_sessions_continuation_operation_id_key"
  ON "verified_recovery_sessions"("continuation_operation_id");

CREATE INDEX "verified_recovery_sessions_continuation_verified_session_idx"
  ON "verified_recovery_sessions"("continuation_verified_student_session_id");

-- AddForeignKey
ALTER TABLE "verified_recovery_sessions"
  ADD CONSTRAINT "verified_recovery_sessions_continuation_verified_session_fkey"
  FOREIGN KEY ("continuation_verified_student_session_id")
  REFERENCES "verified_student_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
