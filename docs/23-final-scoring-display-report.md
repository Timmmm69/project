# Final Scoring And Result Display Report

Date: 2026-07-09

## Source Decision

This report implements the approved final scoring/display decision from the user attachment dated 2026-07-09.

Final MVP Spec v2 remains the main source of truth. This report only narrows the scoring/result behavior inside the approved MVP scope.

## What Changed

- Student result now shows only:
  - `Первичный балл: X / max_raw_score`
  - `Тестовый балл: Y / 100` only when it can be calculated by the approved RIKZ scale.
- Student result no longer shows scoring percent, level, topic scoring table, or recommendations.
- Mistakes review remains visible after completion as educational review:
  - student answer;
  - correct answer, if result settings allow it;
  - explanation, if filled;
  - topic/subtopic as reference.
- Backend scoring now supports partial scoring for MVP `multiple_choice` questions with `points = 2`:
  - exact set: 2 points;
  - one extra selected option or one missed correct option: 1 point;
  - two or more errors: 0 points;
  - empty answer: 0 points.
- `short_text` still uses exact normalized match only. No partial score is awarded.
- `single_choice` uses the configured `points` value for a correct answer.
- `multiple_choice` with points other than 2 is blocked in:
  - admin question validation;
  - XLSX/CSV import validation;
  - publish check.
- The RIKZ 2026 Russian CE/CT scale was added as database data through migration:
  - subject: `russian`;
  - exam type: `ce_ct`;
  - year: `2026`;
  - max raw score: `80`;
  - max scaled score: `100`;
  - raw score rows: `0..80`.

## Scaled Score Rules

The backend calculates `scaled_score` only when all conditions are true:

- test snapshot mode is `ce_ct`;
- attempt/test snapshot `max_raw_score` is exactly `80`;
- scoring scheme subject is `russian`;
- scoring scheme exam type is `ce_ct`;
- scoring scheme year is `2026`;
- scoring scheme max raw score is `80`;
- scoring scheme max scaled score is `100`;
- the raw score exists in the scale table.

No formula, proportional conversion, or demo-test scaling is used.

Examples from the stored table:

- `0` primary -> `0` test;
- `40` primary -> `52` test;
- `80` primary -> `100` test.

## Incomplete Tests

For tests with max raw score other than `80`, the student sees only the primary score.

The student note is:

`Тестовый балл не рассчитывается для неполного теста. Для расчёта по шкале РИКЗ нужен полный тест с максимумом 80 первичных баллов.`

## Existing Internal Data

The database may still store:

- percent;
- level;
- topic results;
- recommendations.

These values remain internal/admin-facing for now and are not displayed on the public student result page.

## Checks

Passed:

- `pnpm typecheck`;
- `pnpm test`;
- `pnpm lint`;
- `RUN_E2E_WITH_DB=true pnpm test:e2e`;
- `pnpm build`;
- `pnpm prisma migrate dev`.

Note: Prisma migration applied successfully. Prisma generate reported a Windows `EPERM` while trying to replace a Prisma engine DLL, likely because a running dev process had the file open. The schema did not change in this migration, so generated client changes were not required for this scoring data migration.

## Remaining Risks

- The RIKZ table must be reviewed against the official source before production launch.
- Old already-started attempts with invalid `multiple_choice.points != 2` would fail completion. New invalid tests are blocked by admin/import/publish validation.
- Admin still has internal percent/level columns in attempt lists. This does not affect the student result, but can be revisited during UI redesign.
