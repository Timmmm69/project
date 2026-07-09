# RIKZ Russian 2026 Schema Mapping And Migration Plan

Status: pre-migration planning document.

This document records the approved direction for adding `examMode = rikz_russian_2026`
as a separate authentic exam layer. It does not change the database by itself.

## Source Priority

- `docs/00-final-mvp-spec-v2.md` remains the main source of truth for the MVP.
- The user-approved context for this step narrows the next work item:
  - do not break the current generic MVP;
  - add `rikz_russian_2026` as a separate layer;
  - keep generic question types for generic tests;
  - use only `multi_select_five` and `short_answer_token` in authentic Russian CE/CT mode;
  - do not copy official RIKZ tasks without confirmed rights;
  - do not make official-product claims in UI or marketing text.

## Current Schema Mapping

### Test

Existing fields in `Test`:

- `id`
- `title`
- `slug`
- `subject`
- `mode`
- `shortDescription`
- `fullDescription`
- `price`
- `currency`
- `durationMinutes`
- `attemptsLimit`
- `accessDays`
- `status`
- `questionsCount`
- `maxRawScore`
- `scoringSchemeId`
- `showScaledScore`
- `showPercent`
- `showCorrectAnswers`
- `showTopicResult`
- `showRecommendations`
- `publishedAt`
- `createdByAdminId`
- `createdAt`
- `updatedAt`
- `deletedAt`

Fields to reuse:

- `subject`: currently `RUSSIAN`; can continue to describe the broad subject.
- `mode`: currently `training` or `ce_ct`; keep it for the generic product-level test mode.
- `durationMinutes`: already exists; authentic Russian CE/CT publish checks will require `120`.
- `questionsCount`: already exists; authentic publish checks will require `40`.
- `maxRawScore`: already exists; authentic publish checks will require `80`.
- `scoringSchemeId`: already exists; use it instead of adding `scoringScaleId`.
- `showScaledScore`: already exists; authentic scaled score can be shown only when the linked scale is valid.

Fields to add:

- `examMode`: new field, default `generic`; authentic value `rikz_russian_2026`.
- `subjectCode`: new nullable string metadata.
- `officialYear`: new nullable integer metadata; `2026` for authentic Russian CE/CT tests.

Fields not to add:

- `scoringScaleId`: not needed. `scoringSchemeId` already links the test to a scheme, and the scheme owns the lookup rows.
- Duplicate `maxRawScore` storage: already exists on `Test` and `Attempt`.

### Question

Existing fields in `Question`:

- `id`
- `testId`
- `questionText`
- `questionType`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
- `correctAnswer`
- `topic`
- `subtopic`
- `difficulty`
- `points`
- `scoringRule`
- `explanation`
- `source`
- `orderIndex`
- `createdAt`
- `updatedAt`
- `deletedAt`

Fields to reuse:

- `questionType`: extend the enum with authentic types.
- `optionA` through `optionD`: keep for generic and authentic Part A.
- `correctAnswer`: keep as the canonical answer string/set representation.
- `points`: use as max points; do not add a separate `maxPoints` field.
- `scoringRule`: keep for generic behavior and map authentic types safely.
- `source`: use instead of adding `sourceRef` unless a later legal/content workflow requires separation.
- `topic`, `subtopic`, `difficulty`, `explanation`: keep for educational feedback and admin organization.

Fields to add:

- `optionE`: required by authentic Part A.
- `officialPart`: `A` or `B` for authentic mode.
- `officialNumber`: number inside the part, for example `7` in `A7`.
- `responseSubtype`: `word`, `digits`, or `alnum` for authentic Part B.
- `partialPolicy`: nullable data-driven policy marker. Default behavior for Part B remains exact-match only.
- `acceptedAnswers`: JSON list/config for accepted Part B answers.
- `normalizationPolicy`: JSON config for explicit normalization choices.
- `expertReviewedAt`: nullable timestamp.
- `expertReviewerName`: nullable string.

Fields not to add:

- `maxPoints`: not needed because `points` already stores the max points for a question.
- `sourceRef`: not needed for P0 because `source` already exists.
- `canonicalTaskType`: not needed at database level for P0 if `questionType` receives `multi_select_five` and `short_answer_token`.

### ScoringScheme And ScoringScale

Existing fields in `ScoringScheme`:

- `id`
- `name`
- `subject`
- `examType`
- `year`
- `maxRawScore`
- `maxScaledScore`
- `isActive`
- `createdAt`
- `updatedAt`

Existing fields in `ScoringScale`:

- `id`
- `scoringSchemeId`
- `rawScore`
- `scaledScore`
- `createdAt`
- `updatedAt`

Fields to reuse:

- `ScoringScheme.subject`: `russian`.
- `ScoringScheme.examType`: `ce_ct`.
- `ScoringScheme.year`: `2026`.
- `ScoringScheme.maxRawScore`: `80`.
- `ScoringScheme.maxScaledScore`: `100`.
- `ScoringScale.rawScore` and `ScoringScale.scaledScore`: already implement lookup `raw_score -> scaled_score`.

Fields not to add:

- A formula field: forbidden for CE/CT scaled score.
- Percent-based scaling: forbidden for CE/CT scaled score.
- Linear scale config: forbidden for CE/CT scaled score.

Required scale rule:

- Authentic Russian CE/CT scaled score requires an active scheme with 81 rows for raw scores `0..80`.

## Proposed Prisma Changes

### Enums

Add:

```prisma
enum ExamMode {
  GENERIC           @map("generic")
  RIKZ_RUSSIAN_2026 @map("rikz_russian_2026")

  @@map("exam_mode")
}

enum OfficialPart {
  A @map("A")
  B @map("B")

  @@map("official_part")
}

enum ResponseSubtype {
  WORD   @map("word")
  DIGITS @map("digits")
  ALNUM  @map("alnum")

  @@map("response_subtype")
}
```

Extend `QuestionType`:

```prisma
MULTI_SELECT_FIVE  @map("multi_select_five")
SHORT_ANSWER_TOKEN @map("short_answer_token")
```

### Test Fields

Add to `Test`:

```prisma
examMode     ExamMode @default(GENERIC) @map("exam_mode")
subjectCode  String?  @map("subject_code")
officialYear Int?     @map("official_year")
```

Add index:

```prisma
@@index([examMode])
```

### Question Fields

Add to `Question`:

```prisma
optionE             String?          @map("option_e")
officialPart        OfficialPart?    @map("official_part")
officialNumber      Int?             @map("official_number")
responseSubtype     ResponseSubtype? @map("response_subtype")
partialPolicy       String?          @map("partial_policy")
acceptedAnswers     Json?            @map("accepted_answers_json")
normalizationPolicy Json?            @map("normalization_policy_json")
expertReviewedAt    DateTime?        @map("expert_reviewed_at")
expertReviewerName  String?          @map("expert_reviewer_name")
```

Add indexes:

```prisma
@@index([testId, officialPart, officialNumber])
@@index([questionType])
```

Do not add a database unique constraint for `officialPart + officialNumber` yet. Generic rows have null values,
and authentic validation needs clearer user-facing error messages. Enforce duplicates in publish/import checks.

## Migration Plan

### Step 1: Documentation And Mapping

Current step.

Deliverables:

- this schema mapping document;
- migration plan;
- no database migration yet;
- no app logic changes yet.

### Step 2: Database Migration

After approval, create a Prisma migration that:

1. creates `exam_mode`;
2. creates `official_part`;
3. creates `response_subtype`;
4. adds `multi_select_five` and `short_answer_token` to `question_type`;
5. adds `exam_mode`, `subject_code`, `official_year` to `tests`;
6. adds authentic question metadata to `questions`;
7. adds the indexes listed above.

Safety:

- all new columns are nullable or have defaults;
- existing tests remain `exam_mode = generic`;
- existing questions keep their current types;
- existing attempts/results stay valid because snapshots are JSON and not rewritten.

### Step 3: Type Layer

Update TypeScript mapping helpers:

- `src/lib/questions/enums.ts`;
- validation schemas;
- API serializers;
- student/public types.

Rules:

- generic mode accepts only legacy generic types unless explicitly changed later;
- authentic mode accepts only `multi_select_five` and `short_answer_token`.

### Step 4: Snapshot Layer

Extend attempt snapshots to include:

- `examMode`;
- `subjectCode`;
- `officialYear`;
- `officialPart`;
- `officialNumber`;
- `optionE`;
- `responseSubtype`;
- `acceptedAnswers`;
- `normalizationPolicy`;
- `partialPolicy`;
- `scoringSchemeId`.

Backward compatibility:

- old snapshots without these fields must continue to parse and score as generic snapshots.

### Step 5: Scoring Layer

Keep the current generic scoring path.

Add authentic adapter:

- `multi_select_five`: score by symmetric difference only in authentic path;
- `short_answer_token`: exact match after conservative normalization;
- scaled score: lookup only through `ScoringScale`;
- no formula, no percent-derived scaled score, no linear scaling.

### Step 6: Publish Checks

For `examMode = rikz_russian_2026`, block publish if:

- active question count is not exactly `40`;
- Part A count is not exactly `18`;
- Part B count is not exactly `22`;
- `durationMinutes` is not `120`;
- sum of `points` is not `80`;
- any legacy question type appears;
- Part A does not have exactly five options;
- Part B lacks `responseSubtype`;
- Part B lacks `acceptedAnswers`;
- there are duplicate official numbers inside a part;
- `showScaledScore = true` and no valid `scoringSchemeId` exists.

Generic publish checks must remain backward compatible.

### Step 7: Import

Keep the existing generic import.

Add authentic import validation with these columns:

- `official_part`
- `official_number`
- `question_type`
- `response_subtype`
- `question_text`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `option_e`
- `accepted_answers`
- `points`
- `partial_policy`
- `normalization_policy`
- `topic`
- `subtopic`
- `difficulty_level`
- `source`
- `explanation`
- `expert_reviewer_name`
- `expert_reviewed_at`

Do not mix generic and authentic templates silently.

### Step 8: UI And Result Display

Minimal P0 UI changes:

- admin can select/see `examMode`;
- authentic question form supports option E and Part A/B fields;
- public attempt UI renders option E for `multi_select_five`;
- result page shows scaled score only for full authentic tests with valid scale;
- student result does not show percent, level, weak/normal labels, or extra scoring cards.

## Backward Compatibility

Existing generic tests will survive the migration because:

- `examMode` will default to `generic`;
- old question types are not removed;
- old question rows do not need the new authentic metadata;
- old imports keep the current template and validation path;
- old attempts keep their existing JSON snapshots;
- scoring will branch by snapshot/test `examMode`, not by guessing from old data.

Existing generic risks:

- UI labels must make it clear that `multiple_choice` is not authentic Part A.
- Shared helpers must not apply `multi_select_five` scoring to generic `multiple_choice`.
- Result serialization must not show scaled score for partial/generic tests by accident.

## Claims And Content Rules

Do not write in UI or marketing:

- official test;
- official simulator;
- copy of CE/CT;
- RIKZ test.

Allowed wording:

- training test in CE/CT format;
- calculation by RIKZ correspondence table;
- not an official examination result.

Published paid content must use original/expert-authored questions or confirmed licensed content.

## Approval Needed Before Next Step

The next step is the actual Prisma migration.

Approval requested for this exact migration shape:

- add `ExamMode`, `OfficialPart`, `ResponseSubtype`;
- extend `QuestionType`;
- add `examMode`, `subjectCode`, `officialYear` to `Test`;
- add `optionE` and authentic metadata to `Question`;
- reuse `points`, `scoringSchemeId`, and `source`;
- do not add duplicate `maxPoints`, `scoringScaleId`, `sourceRef`, or `canonicalTaskType` fields in P0.
