# Trial Import Report: Variant 01

## Scope

This is a local technical trial import for the `rikz_russian_2026` mode. The content package remains `ready_for_human_methodological_review_and_trial_import` and is not approved for public publication.

The source package is preserved unchanged in `source/`:

- `reconciliation_report.md`
- `final_test_text.md`
- `questions.final.json`
- `questions.final.csv`
- `test_manifest.final.json`

## Source Package Checks

- JSON parsed successfully and contains 40 questions.
- Source CSV contains 40 data rows.
- JSON and CSV IDs match.
- Part A contains A1-A18, with 18 questions.
- Part B contains B1-B22, with 22 questions.
- Total primary points: 80.
- Manifest matches 40 / 18 / 22 / 80 and has `requires_human_decision: false`.

## Import Adaptation

`questions.import.csv` is an import-ready derivative. It is generated from the preserved final JSON and does not replace `source/questions.final.csv`.

| Final package field | Importer field or handling |
| --- | --- |
| `part` | `official_part` |
| `official_number` | `official_number` |
| `prompt` | `question_text` |
| `options` JSON | `option_a` through `option_e` |
| Part A `correct_answer` | `correct_answer` |
| Part B `accepted_answers` | JSON array in `accepted_answers` |
| Part B empty `correct_answer` | The existing importer derives its internal legacy `correctAnswer` from the first accepted answer; authentic scoring uses `acceptedAnswers`. |
| `primary_points` | `points` |
| `topic` | `topic` |
| `rule_tested` | `subtopic` |
| `source_ref` | `source` |
| `explanation` | `explanation` |

Technical normalizations required by the current importer:

- `easy-medium` maps to `medium`; `medium-hard` maps to `hard` because the database enum accepts only `easy`, `medium`, and `hard`.
- Part A `response_subtype: letter_set_csv` is omitted because the application reserves `response_subtype` for Part B values `word`, `digits`, and `alnum`.
- The shared text `text_1` is prefixed unchanged to A17, A18, and B1-B9 so it is available in the current question-only data model. A future shared-context model can remove this repetition.
- `id`, `action_required`, `answer_pattern`, `partial_policy`, `normalization_policy`, `qa_status`, and `shared_context_id` are not database fields in the current import path. The source values remain preserved in `source/`.
- The global authentic scorer already applies conservative token normalization. No scoring rule was changed.

## Local Trial Import Result

- Local test ID: `14ec4d54-1488-46c5-8def-2739b5b38708`.
- Local import job ID: `3c26ae54-307b-4261-b5aa-c34a201a842e`.
- Created with `examMode=rikz_russian_2026`, `mode=ce_ct`, `subjectCode=russian`, `officialYear=2026`, and 120 minutes.
- Import validation: 40 valid rows, 0 errors, 0 warnings.
- Import commit: 40 questions.
- Database verification: 18 Part A, 22 Part B, 80 primary points, full A1-A18 and B1-B22 ranges, correct types, Part A options A-E, and Part B accepted-answer arrays.
- Confirmed B14 accepted answer: `лексикология`.
- Confirmed final versions of A10, A18, B16, B19, B20, B21, and B22.
- Confirmed shared text is available to A17, A18, and B1-B9.
- Publish validation passed with an active 80-point scoring scheme; the local test was published only to verify the local flow.
- Minimal student smoke passed: A1 exposes five choices, B1 accepts a numeric token, and the active-attempt payload does not expose answer keys.

## Risks And Next Step

- The shared text is repeated inside 11 question texts because the current schema has no shared-context entity. This is correct for the current MVP flow but is a future content-maintenance consideration.
- Public release still requires a human methodological review. This import verification does not raise the content package publication status.
