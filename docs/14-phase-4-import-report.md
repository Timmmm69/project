# Phase 4 Import XLSX/CSV Report

## Status

Phase 4 is complete for MVP scope.

Implemented:

- XLSX and CSV template download.
- Admin-only validate endpoint for import files.
- Header, row, field and answer validation.
- Critical errors and warnings separated.
- Preview is saved in `ImportJob` and does not create questions.
- Commit endpoint applies import in one transaction.
- `append` adds questions after current active questions.
- `replace` soft-deletes current active questions and creates imported questions from order `1`.
- `questions_count` and `max_raw_score` are recalculated after commit.
- Import events are written to `EventLog`.
- Admin UI supports template download, file upload, validate, preview and commit.
- Unit tests cover import validation.

## API

- `GET /api/admin/import/template?format=xlsx`
- `GET /api/admin/import/template?format=csv`
- `POST /api/admin/tests/:testId/import/validate`
- `GET /api/admin/import/:importJobId/errors`
- `POST /api/admin/import/:importJobId/commit`

## Validation Rules

- Supported files: `.xlsx`, `.csv`.
- Max file size: 5 MB.
- Max question rows: 500.
- Required columns:
  - `question_text`
  - `question_type`
  - `option_a`
  - `option_b`
  - `option_c`
  - `option_d`
  - `correct_answer`
  - `topic`
  - `subtopic`
  - `difficulty`
  - `points`
  - `source`
  - `explanation`
- Supported question types:
  - `single_choice`
  - `multiple_choice`
  - `short_text`
- `single_choice` and `multiple_choice` require at least 2 filled options.
- Choice answers must reference filled A/B/C/D options.
- `short_text` answer variants are split by `;`, normalized and deduplicated.
- `short_text` options are ignored with a warning.
- Formulas in XLSX are rejected.

## Database Note

Removed the strict Prisma unique constraint on `(testId, orderIndex)`.

Reason: `replace` soft-deletes old questions for snapshot safety. A full unique constraint would block new active questions from reusing order `1..N` while old soft-deleted questions still exist.

The active order is now enforced by application logic.

## How To Check

1. Login to `/admin`.
2. Open any test in the questions constructor.
3. Download XLSX or CSV template.
4. Fill rows according to the template.
5. Upload file and click validate.
6. If there are no critical errors, click commit.
7. Check that questions appear in the table and test counters are updated.

## Automated Checks

Passed:

- `prisma validate`
- `tsc --noEmit`
- `eslint .`
- `vitest run`

Unit tests: 16 passed.

## Remaining Risks

- Browser/manual testing with real uploaded files is still needed after local dev server is started.
- If an existing local database has the old unique index on `(test_id, order_index)`, Prisma migration must be applied before testing `replace`.
- UI is intentionally neutral MVP UI; visual polish can be done later without changing import logic.
