-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'student');

-- CreateEnum
CREATE TYPE "subject" AS ENUM ('russian');

-- CreateEnum
CREATE TYPE "test_mode" AS ENUM ('training', 'ce_ct');

-- CreateEnum
CREATE TYPE "test_status" AS ENUM ('draft', 'published', 'hidden', 'archived');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('single_choice', 'multiple_choice', 'short_text');

-- CreateEnum
CREATE TYPE "difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "scoring_rule" AS ENUM ('full_match', 'exact_text');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'success', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('manual', 'bepaid', 'webpay', 'erip', 'other');

-- CreateEnum
CREATE TYPE "access_source" AS ENUM ('payment', 'manual', 'access_code');

-- CreateEnum
CREATE TYPE "access_code_status" AS ENUM ('active', 'used', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('started', 'completed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "import_mode" AS ENUM ('append', 'replace');

-- CreateEnum
CREATE TYPE "import_job_status" AS ENUM ('uploaded', 'validated', 'failed', 'imported', 'cancelled');

-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'student',
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tests" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "subject" "subject" NOT NULL DEFAULT 'russian',
    "mode" "test_mode" NOT NULL DEFAULT 'training',
    "short_description" TEXT,
    "full_description" TEXT,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BYN',
    "duration_minutes" INTEGER NOT NULL,
    "attempts_limit" INTEGER NOT NULL DEFAULT 1,
    "access_days" INTEGER NOT NULL DEFAULT 7,
    "status" "test_status" NOT NULL DEFAULT 'draft',
    "questions_count" INTEGER NOT NULL DEFAULT 0,
    "max_raw_score" INTEGER NOT NULL DEFAULT 0,
    "scoring_scheme_id" UUID,
    "show_scaled_score" BOOLEAN NOT NULL DEFAULT false,
    "show_percent" BOOLEAN NOT NULL DEFAULT true,
    "show_correct_answers" BOOLEAN NOT NULL DEFAULT true,
    "show_topic_result" BOOLEAN NOT NULL DEFAULT true,
    "show_recommendations" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3),
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" "question_type" NOT NULL,
    "option_a" TEXT,
    "option_b" TEXT,
    "option_c" TEXT,
    "option_d" TEXT,
    "correct_answer" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "subtopic" TEXT,
    "difficulty" "difficulty" DEFAULT 'medium',
    "points" INTEGER NOT NULL DEFAULT 1,
    "scoring_rule" "scoring_rule" NOT NULL DEFAULT 'full_match',
    "explanation" TEXT,
    "source" TEXT,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BYN',
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "provider" "payment_provider" NOT NULL,
    "provider_payment_id" TEXT,
    "provider_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accesses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "payment_id" UUID,
    "access_code_id" UUID,
    "source" "access_source" NOT NULL,
    "attempts_total" INTEGER NOT NULL DEFAULT 1,
    "attempts_available" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_admin_id" UUID,
    "revoked_reason" TEXT,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "test_id" UUID NOT NULL,
    "created_by_admin_id" UUID NOT NULL,
    "status" "access_code_status" NOT NULL DEFAULT 'active',
    "attempts_total" INTEGER NOT NULL DEFAULT 1,
    "access_days" INTEGER NOT NULL DEFAULT 7,
    "code_expires_at" TIMESTAMP(3) NOT NULL,
    "activated_by_user_id" UUID,
    "activated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_admin_id" UUID,
    "revoked_reason" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "access_id" UUID NOT NULL,
    "status" "attempt_status" NOT NULL DEFAULT 'started',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "raw_score" INTEGER,
    "max_raw_score" INTEGER,
    "percent" DECIMAL(5,2),
    "scaled_score" INTEGER,
    "max_scaled_score" INTEGER,
    "level" TEXT,
    "test_snapshot_json" JSONB NOT NULL,
    "scoring_scheme_snapshot_json" JSONB,
    "topic_results_json" JSONB,
    "recommendations_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID,
    "snapshot_question_id" TEXT,
    "question_snapshot_json" JSONB NOT NULL,
    "selected_answer" TEXT,
    "is_correct" BOOLEAN,
    "points_earned" INTEGER,
    "max_points" INTEGER NOT NULL,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "mode" "import_mode" NOT NULL,
    "status" "import_job_status" NOT NULL DEFAULT 'uploaded',
    "total_rows" INTEGER,
    "valid_rows" INTEGER,
    "error_rows" INTEGER,
    "warning_rows" INTEGER,
    "errors_json" JSONB,
    "warnings_json" JSONB,
    "preview_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "validated_at" TIMESTAMP(3),
    "imported_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_access_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "access_id" UUID NOT NULL,
    "attempts_total" INTEGER NOT NULL,
    "access_days" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_schemes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" "subject" NOT NULL,
    "exam_type" TEXT NOT NULL,
    "year" INTEGER,
    "max_raw_score" INTEGER NOT NULL,
    "max_scaled_score" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_scales" (
    "id" UUID NOT NULL,
    "scoring_scheme_id" UUID NOT NULL,
    "raw_score" INTEGER NOT NULL,
    "scaled_score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "email_status" NOT NULL DEFAULT 'pending',
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "tests_slug_key" ON "tests"("slug");

-- CreateIndex
CREATE INDEX "tests_status_idx" ON "tests"("status");

-- CreateIndex
CREATE INDEX "tests_subject_idx" ON "tests"("subject");

-- CreateIndex
CREATE INDEX "tests_mode_idx" ON "tests"("mode");

-- CreateIndex
CREATE INDEX "questions_test_id_idx" ON "questions"("test_id");

-- CreateIndex
CREATE INDEX "questions_topic_idx" ON "questions"("topic");

-- CreateIndex
CREATE INDEX "questions_test_id_order_index_idx" ON "questions"("test_id", "order_index");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "payments_test_id_idx" ON "payments"("test_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "accesses_payment_id_key" ON "accesses"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "accesses_access_code_id_key" ON "accesses"("access_code_id");

-- CreateIndex
CREATE INDEX "accesses_user_id_idx" ON "accesses"("user_id");

-- CreateIndex
CREATE INDEX "accesses_test_id_idx" ON "accesses"("test_id");

-- CreateIndex
CREATE INDEX "accesses_user_id_test_id_idx" ON "accesses"("user_id", "test_id");

-- CreateIndex
CREATE INDEX "accesses_expires_at_idx" ON "accesses"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_codes_code_hash_key" ON "access_codes"("code_hash");

-- CreateIndex
CREATE INDEX "access_codes_test_id_idx" ON "access_codes"("test_id");

-- CreateIndex
CREATE INDEX "access_codes_status_idx" ON "access_codes"("status");

-- CreateIndex
CREATE INDEX "access_codes_code_expires_at_idx" ON "access_codes"("code_expires_at");

-- CreateIndex
CREATE INDEX "attempts_user_id_idx" ON "attempts"("user_id");

-- CreateIndex
CREATE INDEX "attempts_test_id_idx" ON "attempts"("test_id");

-- CreateIndex
CREATE INDEX "attempts_access_id_idx" ON "attempts"("access_id");

-- CreateIndex
CREATE INDEX "attempts_status_idx" ON "attempts"("status");

-- CreateIndex
CREATE INDEX "attempts_started_at_idx" ON "attempts"("started_at");

-- CreateIndex
CREATE INDEX "answers_attempt_id_idx" ON "answers"("attempt_id");

-- CreateIndex
CREATE INDEX "answers_question_id_idx" ON "answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_attempt_id_snapshot_question_id_key" ON "answers"("attempt_id", "snapshot_question_id");

-- CreateIndex
CREATE INDEX "import_jobs_test_id_idx" ON "import_jobs"("test_id");

-- CreateIndex
CREATE INDEX "import_jobs_admin_id_idx" ON "import_jobs"("admin_id");

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "manual_access_logs_admin_id_idx" ON "manual_access_logs"("admin_id");

-- CreateIndex
CREATE INDEX "manual_access_logs_user_id_idx" ON "manual_access_logs"("user_id");

-- CreateIndex
CREATE INDEX "manual_access_logs_test_id_idx" ON "manual_access_logs"("test_id");

-- CreateIndex
CREATE INDEX "manual_access_logs_access_id_idx" ON "manual_access_logs"("access_id");

-- CreateIndex
CREATE INDEX "event_logs_actor_user_id_idx" ON "event_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "event_logs_event_type_idx" ON "event_logs"("event_type");

-- CreateIndex
CREATE INDEX "event_logs_entity_type_entity_id_idx" ON "event_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "event_logs_created_at_idx" ON "event_logs"("created_at");

-- CreateIndex
CREATE INDEX "scoring_schemes_subject_idx" ON "scoring_schemes"("subject");

-- CreateIndex
CREATE INDEX "scoring_schemes_exam_type_idx" ON "scoring_schemes"("exam_type");

-- CreateIndex
CREATE INDEX "scoring_schemes_is_active_idx" ON "scoring_schemes"("is_active");

-- CreateIndex
CREATE INDEX "scoring_scales_scoring_scheme_id_idx" ON "scoring_scales"("scoring_scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_scales_scoring_scheme_id_raw_score_key" ON "scoring_scales"("scoring_scheme_id", "raw_score");

-- CreateIndex
CREATE INDEX "email_logs_user_id_idx" ON "email_logs"("user_id");

-- CreateIndex
CREATE INDEX "email_logs_email_idx" ON "email_logs"("email");

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_scoring_scheme_id_fkey" FOREIGN KEY ("scoring_scheme_id") REFERENCES "scoring_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_access_code_id_fkey" FOREIGN KEY ("access_code_id") REFERENCES "access_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_revoked_by_admin_id_fkey" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesses" ADD CONSTRAINT "accesses_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_activated_by_user_id_fkey" FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_revoked_by_admin_id_fkey" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_access_id_fkey" FOREIGN KEY ("access_id") REFERENCES "accesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_logs" ADD CONSTRAINT "manual_access_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_logs" ADD CONSTRAINT "manual_access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_logs" ADD CONSTRAINT "manual_access_logs_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_logs" ADD CONSTRAINT "manual_access_logs_access_id_fkey" FOREIGN KEY ("access_id") REFERENCES "accesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_scales" ADD CONSTRAINT "scoring_scales_scoring_scheme_id_fkey" FOREIGN KEY ("scoring_scheme_id") REFERENCES "scoring_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

