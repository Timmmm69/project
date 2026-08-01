-- ACC-01A recovery is additive and dev/test-only. This migration creates no
-- business records and does not update or delete existing rows.

-- CreateEnum
CREATE TYPE "recovery_challenge_status" AS ENUM (
  'active',
  'verified',
  'expired',
  'locked',
  'superseded',
  'revoked'
);

-- CreateEnum
CREATE TYPE "recovery_verification_outcome" AS ENUM (
  'match',
  'no_match',
  'expired',
  'locked',
  'replay',
  'error'
);

-- CreateEnum
CREATE TYPE "verified_recovery_session_status" AS ENUM (
  'active',
  'revoked',
  'expired',
  'rotated'
);

-- CreateEnum
CREATE TYPE "verified_recovery_session_revocation_code" AS ENUM (
  'user_invalidated',
  'expired',
  'rotated',
  'continued',
  'security_revoked',
  'key_retired'
);

-- CreateEnum
CREATE TYPE "recovery_rate_limit_kind" AS ENUM (
  'email_request',
  'source_request',
  'source_verify_failure'
);

-- CreateEnum
CREATE TYPE "recovery_security_event_code" AS ENUM (
  'challenge_requested',
  'challenge_reused',
  'challenge_superseded',
  'verify_rejected',
  'verify_matched',
  'rate_limited',
  'session_issued',
  'session_revoked'
);

-- CreateEnum
CREATE TYPE "recovery_security_reason_code" AS ENUM (
  'request_created',
  'idempotent_retry',
  'resend',
  'cooldown',
  'email_limit',
  'source_limit',
  'invalid_otp',
  'challenge_expired',
  'challenge_locked',
  'challenge_replay',
  'mailer_failed',
  'mailer_unknown',
  'otp_match',
  'user_invalidated',
  'session_expired',
  'session_rotated',
  'session_continued',
  'security_revoked',
  'key_retired',
  'scope_invalid',
  'operation_conflict'
);

-- CreateTable
CREATE TABLE "recovery_challenges" (
  "id" UUID NOT NULL,
  "commercial_product_id" UUID NOT NULL,
  "test_id" UUID NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "email_fingerprint" CHAR(64) NOT NULL,
  "challenge_token_digest" CHAR(64) NOT NULL,
  "challenge_key_version" VARCHAR(32) NOT NULL,
  "otp_mac" CHAR(64),
  "otp_key_version" VARCHAR(32) NOT NULL,
  "status" "recovery_challenge_status" NOT NULL DEFAULT 'active',
  "failed_verify_count" INTEGER NOT NULL DEFAULT 0,
  "request_operation_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "resend_available_at" TIMESTAMP(3) NOT NULL,
  "verified_at" TIMESTAMP(3),
  "terminal_at" TIMESTAMP(3),
  "superseded_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recovery_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recovery_challenges_failed_verify_count_check"
    CHECK ("failed_verify_count" >= 0 AND "failed_verify_count" <= 5),
  CONSTRAINT "recovery_challenges_status_timestamps_check" CHECK (
    (
      "status" = 'active'
      AND "terminal_at" IS NULL
      AND "verified_at" IS NULL
      AND "otp_mac" IS NOT NULL
    ) OR (
      "status" = 'verified'
      AND "terminal_at" IS NOT NULL
      AND "verified_at" IS NOT NULL
    ) OR (
      "status" IN ('expired', 'locked', 'superseded', 'revoked')
      AND "terminal_at" IS NOT NULL
      AND "verified_at" IS NULL
    )
  )
);

-- CreateTable
CREATE TABLE "recovery_verification_attempts" (
  "id" UUID NOT NULL,
  "challenge_id" UUID NOT NULL,
  "operation_id" UUID NOT NULL,
  "outcome_code" "recovery_verification_outcome" NOT NULL,
  "attempt_ordinal" INTEGER NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recovery_verification_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recovery_verification_attempts_ordinal_check"
    CHECK ("attempt_ordinal" >= 1)
);

-- CreateTable
CREATE TABLE "verified_recovery_sessions" (
  "id" UUID NOT NULL,
  "challenge_id" UUID NOT NULL,
  "token_digest" CHAR(64) NOT NULL,
  "token_key_version" VARCHAR(32) NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "email_fingerprint" CHAR(64) NOT NULL,
  "commercial_product_id" UUID NOT NULL,
  "test_id" UUID NOT NULL,
  "status" "verified_recovery_session_status" NOT NULL DEFAULT 'active',
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revocation_code" "verified_recovery_session_revocation_code",
  "rotated_from_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verified_recovery_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verified_recovery_sessions_expiry_check"
    CHECK ("expires_at" > "issued_at"),
  CONSTRAINT "verified_recovery_sessions_status_check" CHECK (
    (
      "status" = 'active'
      AND "revoked_at" IS NULL
      AND "revocation_code" IS NULL
    ) OR (
      "status" = 'rotated'
      AND "revoked_at" IS NOT NULL
      AND "revocation_code" = 'rotated'
    ) OR (
      "status" = 'expired'
      AND "revoked_at" IS NOT NULL
      AND "revocation_code" = 'expired'
    ) OR (
      "status" = 'revoked'
      AND "revoked_at" IS NOT NULL
      AND "revocation_code" IN (
        'user_invalidated',
        'continued',
        'security_revoked',
        'key_retired'
      )
    )
  )
);

-- CreateTable
CREATE TABLE "recovery_rate_limit_events" (
  "id" UUID NOT NULL,
  "kind" "recovery_rate_limit_kind" NOT NULL,
  "key_digest" CHAR(64) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recovery_rate_limit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recovery_rate_limit_events_expiry_check"
    CHECK ("expires_at" > "occurred_at")
);

-- CreateTable
CREATE TABLE "recovery_security_events" (
  "id" UUID NOT NULL,
  "correlation_id" UUID NOT NULL,
  "event_code" "recovery_security_event_code" NOT NULL,
  "challenge_id" UUID,
  "recovery_session_id" UUID,
  "reason_code" "recovery_security_reason_code",
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recovery_security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_challenges_challenge_token_digest_key"
  ON "recovery_challenges"("challenge_token_digest");

CREATE UNIQUE INDEX "recovery_challenges_request_operation_id_key"
  ON "recovery_challenges"("request_operation_id");

CREATE INDEX "recovery_challenges_subject_scope_status_idx"
  ON "recovery_challenges"("email_fingerprint", "commercial_product_id", "test_id", "status");

CREATE INDEX "recovery_challenges_status_expires_at_idx"
  ON "recovery_challenges"("status", "expires_at");

CREATE INDEX "recovery_challenges_subject_scope_cooldown_idx"
  ON "recovery_challenges"("email_fingerprint", "commercial_product_id", "test_id", "resend_available_at");

CREATE INDEX "recovery_challenges_status_terminal_at_idx"
  ON "recovery_challenges"("status", "terminal_at");

CREATE UNIQUE INDEX "recovery_challenges_one_active_subject_scope_key"
  ON "recovery_challenges"("email_fingerprint", "commercial_product_id", "test_id")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX "recovery_verification_attempts_operation_id_key"
  ON "recovery_verification_attempts"("operation_id");

CREATE INDEX "recovery_verification_attempts_challenge_id_occurred_at_idx"
  ON "recovery_verification_attempts"("challenge_id", "occurred_at");

CREATE UNIQUE INDEX "verified_recovery_sessions_challenge_id_key"
  ON "verified_recovery_sessions"("challenge_id");

CREATE UNIQUE INDEX "verified_recovery_sessions_token_digest_key"
  ON "verified_recovery_sessions"("token_digest");

CREATE INDEX "verified_recovery_sessions_subject_scope_status_idx"
  ON "verified_recovery_sessions"("email_fingerprint", "commercial_product_id", "test_id", "status");

CREATE INDEX "verified_recovery_sessions_status_expires_at_idx"
  ON "verified_recovery_sessions"("status", "expires_at");

CREATE INDEX "verified_recovery_sessions_status_revoked_at_idx"
  ON "verified_recovery_sessions"("status", "revoked_at");

CREATE INDEX "verified_recovery_sessions_token_key_version_expires_at_idx"
  ON "verified_recovery_sessions"("token_key_version", "expires_at");

CREATE UNIQUE INDEX "verified_recovery_sessions_one_active_subject_scope_key"
  ON "verified_recovery_sessions"("email_fingerprint", "commercial_product_id", "test_id")
  WHERE "status" = 'active';

CREATE INDEX "recovery_rate_limit_events_kind_key_digest_occurred_at_idx"
  ON "recovery_rate_limit_events"("kind", "key_digest", "occurred_at");

CREATE INDEX "recovery_rate_limit_events_expires_at_idx"
  ON "recovery_rate_limit_events"("expires_at");

CREATE INDEX "recovery_security_events_challenge_id_occurred_at_idx"
  ON "recovery_security_events"("challenge_id", "occurred_at");

CREATE INDEX "recovery_security_events_recovery_session_id_occurred_at_idx"
  ON "recovery_security_events"("recovery_session_id", "occurred_at");

CREATE INDEX "recovery_security_events_event_code_occurred_at_idx"
  ON "recovery_security_events"("event_code", "occurred_at");

CREATE INDEX "recovery_security_events_occurred_at_idx"
  ON "recovery_security_events"("occurred_at");

-- AddForeignKey
ALTER TABLE "recovery_challenges"
  ADD CONSTRAINT "recovery_challenges_commercial_product_id_fkey"
  FOREIGN KEY ("commercial_product_id") REFERENCES "commercial_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_challenges"
  ADD CONSTRAINT "recovery_challenges_test_id_fkey"
  FOREIGN KEY ("test_id") REFERENCES "tests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_challenges"
  ADD CONSTRAINT "recovery_challenges_superseded_by_id_fkey"
  FOREIGN KEY ("superseded_by_id") REFERENCES "recovery_challenges"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recovery_verification_attempts"
  ADD CONSTRAINT "recovery_verification_attempts_challenge_id_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "recovery_challenges"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verified_recovery_sessions"
  ADD CONSTRAINT "verified_recovery_sessions_challenge_id_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "recovery_challenges"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "verified_recovery_sessions"
  ADD CONSTRAINT "verified_recovery_sessions_commercial_product_id_fkey"
  FOREIGN KEY ("commercial_product_id") REFERENCES "commercial_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "verified_recovery_sessions"
  ADD CONSTRAINT "verified_recovery_sessions_test_id_fkey"
  FOREIGN KEY ("test_id") REFERENCES "tests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "verified_recovery_sessions"
  ADD CONSTRAINT "verified_recovery_sessions_rotated_from_id_fkey"
  FOREIGN KEY ("rotated_from_id") REFERENCES "verified_recovery_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recovery_security_events"
  ADD CONSTRAINT "recovery_security_events_challenge_id_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "recovery_challenges"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recovery_security_events"
  ADD CONSTRAINT "recovery_security_events_recovery_session_id_fkey"
  FOREIGN KEY ("recovery_session_id") REFERENCES "verified_recovery_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
