# Phase 8 Report: Scoring, CE/CT Scale, Results

## What Was Done

- Added backend scoring engine for MVP question types:
  - `single_choice`;
  - `multiple_choice`;
  - `short_text`.
- Enforced no partial points: an answer is either fully correct or wrong.
- Empty answers are counted as wrong answers.
- Attempt completion and expiration now calculate and persist:
  - `raw_score`;
  - `max_raw_score`;
  - `percent`;
  - `level`;
  - `topic_results_json`;
  - `recommendations_json`;
  - `scaled_score`, when a CE/CT scoring scheme snapshot has a matching raw score.
- Added scoring scheme snapshot creation at attempt start when a test has a scoring scheme.
- Added student result API:
  - `GET /api/results/[attemptId]`.
- Added public result page:
  - `/results/[attemptId]`.
- Added admin attempt APIs:
  - `GET /api/admin/attempts`;
  - `GET /api/admin/attempts/[attemptId]`.
- Added a minimal admin table with latest attempts for the selected test.
- Updated attempt runner so completion and expiration redirect to the result page.
- Added unit tests for core scoring rules.

## How To Check

1. Start a published test attempt as a student.
2. Save answers during the attempt.
3. Finish the attempt manually or let the timer expire.
4. Verify redirect to `/results/[attemptId]`.
5. Verify the result page shows:
   - primary score;
   - percent;
   - level;
   - topic results;
   - recommendations;
   - mistakes with correct answers.
6. Open admin panel, select the test, and verify latest attempts appear in the access/payment section.
7. Call `GET /api/admin/attempts/[attemptId]` as admin to inspect full JSON details.

## Required Checks

- `pnpm prisma validate`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Remaining Risks

- Real CE/CT scoring tables still need to be provided and loaded before real launch.
- If a CE/CT scale has no mapping for a raw score, the scaled score is not shown and an event log is written.
- Manual browser testing still depends on a working local PostgreSQL database and seeded data.
- UI is functional MVP-level. A polished visual pass can be done later without changing scoring rules.

## Decisions Needed Later

- Choose and load real CE/CT scale tables.
- Decide final wording for result-page legal/disclaimer text around training CE/CT scoring.
- Decide whether admin attempt details should become a full in-app page instead of JSON detail.
