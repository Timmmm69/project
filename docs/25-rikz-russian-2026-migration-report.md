# RIKZ Russian 2026 Migration Step Report

Status: completed for schema and shared type layer.

## Scope

Implemented only the approved migration and shared type/mapping layer for `examMode = rikz_russian_2026`.

Not implemented in this step:

- scoring adapter;
- authentic publish checks;
- authentic import flow;
- student runner changes;
- result page changes;
- payment/access changes;
- UI redesign.

## Files Changed

- `prisma/schema.prisma`
- `prisma/migrations/20260709205000_add_rikz_russian_2026_exam_mode/migration.sql`
- `src/lib/mvp-constants.ts`
- `src/lib/questions/enums.ts`
- `src/lib/questions/normalization.ts`
- `src/lib/questions/serialize.ts`
- `src/lib/tests/enums.ts`
- `src/lib/tests/serialize.ts`
- `src/lib/validation/schemas.ts`
- `src/lib/attempts/snapshot.ts`
- `src/lib/attempts/attempt-service.ts`
- `tests/unit/public-tests.test.ts`
- `docs/24-rikz-russian-2026-schema-mapping.md`
- `docs/06-risks-open-decisions.md`

## Migration

Created:

- `20260709205000_add_rikz_russian_2026_exam_mode`

Added database enums:

- `exam_mode`: `generic`, `rikz_russian_2026`
- `official_part`: `A`, `B`
- `response_subtype`: `word`, `digits`, `alnum`

Extended `question_type`:

- `multi_select_five`
- `short_answer_token`

Added to `tests`:

- `exam_mode` with default `generic`
- `subject_code` nullable
- `official_year` nullable

Added to `questions`:

- `option_e` nullable
- `official_part` nullable
- `official_number` nullable
- `response_subtype` nullable
- `partial_policy` nullable
- `accepted_answers_json` nullable
- `normalization_policy_json` nullable
- `expert_reviewer_name` nullable
- `expert_reviewed_at` nullable

Added indexes:

- `tests_exam_mode_idx`
- `questions_test_id_official_part_official_number_idx`
- `questions_question_type_idx`

## Backward Compatibility

Existing generic tests continue to work because:

- `exam_mode` defaults to `generic`;
- all authentic question fields are nullable;
- legacy question enum values remain unchanged;
- old snapshots are not rewritten;
- generic validators and generic import still reject/ignore authentic behavior until the next approved step.

## ScoringScheme Check

The current schema already supports lookup scoring:

- `ScoringScheme` stores subject, exam type, year, max raw score, and max scaled score.
- `ScoringScale` stores rows `rawScore -> scaledScore`.
- No formula or percent-based scaled score was added.

Next step should validate that a RIKZ Russian 2026 scheme has all 81 rows for raw scores `0..80` before authentic publish/scoring acceptance.

## Commands Run

- `pnpm prisma format` - passed.
- `pnpm prisma migrate dev --skip-generate` - passed and applied the migration to local PostgreSQL.
- `pnpm prisma generate` - passed.
- `pnpm prisma validate` - passed.
- `pnpm typecheck` - passed after updating one test fixture.
- `pnpm test` - passed, 32 tests.
- `pnpm lint` - passed after removing an unused constant.
- `pnpm build` - initially failed on a Windows/OneDrive `EPERM` lock inside generated `.next`; after verified removal of `.next`, rerun passed.

## Notes

- Commands were run with bundled Codex Node/pnpm because the active PowerShell profile did not expose `node`.
- Git was available through bundled Codex Git.
- `next-env.d.ts` was touched by Next build and restored to avoid generated noise.

## Next Approval Gate

Recommended next step:

1. authentic publish checks;
2. scoring adapter for `rikz_russian_2026`;
3. authentic import validation.
