CREATE UNIQUE INDEX "attempts_one_started_per_user_test_idx"
ON "attempts" ("user_id", "test_id")
WHERE "status" = 'started';
