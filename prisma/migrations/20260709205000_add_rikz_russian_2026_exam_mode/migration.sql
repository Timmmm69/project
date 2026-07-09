CREATE TYPE "exam_mode" AS ENUM ('generic', 'rikz_russian_2026');

CREATE TYPE "official_part" AS ENUM ('A', 'B');

CREATE TYPE "response_subtype" AS ENUM ('word', 'digits', 'alnum');

ALTER TYPE "question_type" ADD VALUE 'multi_select_five';
ALTER TYPE "question_type" ADD VALUE 'short_answer_token';

ALTER TABLE "tests"
  ADD COLUMN "exam_mode" "exam_mode" NOT NULL DEFAULT 'generic',
  ADD COLUMN "subject_code" TEXT,
  ADD COLUMN "official_year" INTEGER;

ALTER TABLE "questions"
  ADD COLUMN "option_e" TEXT,
  ADD COLUMN "official_part" "official_part",
  ADD COLUMN "official_number" INTEGER,
  ADD COLUMN "response_subtype" "response_subtype",
  ADD COLUMN "partial_policy" TEXT,
  ADD COLUMN "accepted_answers_json" JSONB,
  ADD COLUMN "normalization_policy_json" JSONB,
  ADD COLUMN "expert_reviewer_name" TEXT,
  ADD COLUMN "expert_reviewed_at" TIMESTAMP(3);

CREATE INDEX "tests_exam_mode_idx" ON "tests"("exam_mode");

CREATE INDEX "questions_test_id_official_part_official_number_idx"
  ON "questions"("test_id", "official_part", "official_number");

CREATE INDEX "questions_question_type_idx" ON "questions"("question_type");
