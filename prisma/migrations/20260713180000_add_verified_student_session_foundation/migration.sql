-- CreateEnum
CREATE TYPE "verified_student_session_source" AS ENUM (
  'email_otp_recovery',
  'access_code',
  'commercial_order_claim'
);

-- CreateEnum
CREATE TYPE "verified_student_session_revocation_reason" AS ENUM (
  'logout',
  'expired',
  'rotated',
  'access_revoked',
  'security_revoked',
  'key_retired'
);

-- CreateTable
CREATE TABLE "verified_student_sessions" (
  "id" UUID NOT NULL,
  "token_digest" CHAR(64) NOT NULL,
  "token_key_version" VARCHAR(32) NOT NULL,
  "token_generation" INTEGER NOT NULL DEFAULT 1,
  "user_id" UUID NOT NULL,
  "commercial_product_id" UUID NOT NULL,
  "test_id" UUID NOT NULL,
  "access_id" UUID NOT NULL,
  "source" "verified_student_session_source" NOT NULL,
  "source_reference_id" UUID NOT NULL,
  "issuance_operation_id" UUID NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_rotated_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revocation_reason" "verified_student_session_revocation_reason",
  "security_correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verified_student_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verified_student_sessions_token_generation_check" CHECK ("token_generation" >= 1),
  CONSTRAINT "verified_student_sessions_revocation_check" CHECK (
    ("revoked_at" IS NULL AND "revocation_reason" IS NULL) OR
    ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
  )
);

-- CreateIndex
CREATE UNIQUE INDEX "verified_student_sessions_token_digest_key"
  ON "verified_student_sessions"("token_digest");

-- CreateIndex
CREATE UNIQUE INDEX "verified_student_sessions_security_correlation_id_key"
  ON "verified_student_sessions"("security_correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "verified_student_sessions_source_source_reference_id_issuan_key"
  ON "verified_student_sessions"("source", "source_reference_id", "issuance_operation_id");

-- CreateIndex
CREATE INDEX "verified_student_sessions_user_id_commercial_product_id_tes_idx"
  ON "verified_student_sessions"("user_id", "commercial_product_id", "test_id", "expires_at");

-- CreateIndex
CREATE INDEX "verified_student_sessions_access_id_expires_at_idx"
  ON "verified_student_sessions"("access_id", "expires_at");

-- CreateIndex
CREATE INDEX "verified_student_sessions_token_key_version_expires_at_idx"
  ON "verified_student_sessions"("token_key_version", "expires_at");

-- AddForeignKey
ALTER TABLE "verified_student_sessions"
  ADD CONSTRAINT "verified_student_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_student_sessions"
  ADD CONSTRAINT "verified_student_sessions_commercial_product_id_fkey"
  FOREIGN KEY ("commercial_product_id") REFERENCES "commercial_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_student_sessions"
  ADD CONSTRAINT "verified_student_sessions_test_id_fkey"
  FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_student_sessions"
  ADD CONSTRAINT "verified_student_sessions_access_id_fkey"
  FOREIGN KEY ("access_id") REFERENCES "accesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
