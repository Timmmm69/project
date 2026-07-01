# Supporting Docs Analysis

## Статус

Документы детализации изучены и скопированы в проект:

- `docs/supporting/development-brief-v1.md`
- `docs/supporting/database-schema-api-v1.md`
- `docs/supporting/admin-test-builder-v1.md`
- `docs/supporting/excel-csv-import-spec-v1.md`
- `docs/supporting/payment-access-logic-v1.md`
- `docs/supporting/scoring-engine-v2.md`

Главный источник истины остается `docs/00-final-mvp-spec-v2.md`. Если supporting docs противоречат Final MVP Spec v2, используем Final MVP Spec v2.

## Как Использовать Эти Документы

- `development-brief-v1.md`: общая детализация ТЗ, бизнес-правил, публичной части, админки, email и acceptance criteria.
- `database-schema-api-v1.md`: основа для Prisma-схемы, API-контрактов и transaction rules.
- `admin-test-builder-v1.md`: детализация админки тестов, вопросов, preview, публикации и checklist.
- `excel-csv-import-spec-v1.md`: точные правила XLSX/CSV шаблона, validate/preview/commit, warnings/errors.
- `payment-access-logic-v1.md`: платежи, Access, ручной доступ, одноразовые коды, webhook, email и edge cases.
- `scoring-engine-v2.md`: scoring, snapshot, result structure, topic results, recommendations и CE/CT scale.

## Зафиксированные Решения

- Стек остается: Next.js monolith, TypeScript, PostgreSQL, Prisma.
- Валюта по умолчанию: `BYN`.
- Оплата строится через `PaymentProvider` adapter.
- CE/CT 0-100 входит в MVP по отдельному решению пользователя, даже если часть supporting docs относит UI шкал к P0.5.
- Ученик идентифицируется email без пароля.
- Один access относится к одному test.
- Одна покупка по умолчанию дает одну попытку.
- Срок доступа по умолчанию: 7 дней.
- Snapshot обязателен при старте попытки.
- Scoring только на backend.

## Что Уточнено По Модулям

### Admin Tests

MVP включает:

- список тестов;
- создание и редактирование теста;
- статусы `draft`, `published`, `hidden`, `archived`;
- soft delete вместо физического удаления, если есть оплаты, доступы, попытки или результаты;
- publish check с errors/warnings;
- preview глазами ученика без создания попытки, access, payment или result;
- вкладки или разделы: основные настройки, вопросы, импорт, preview, scoring, access, results.

Не добавлять в MVP без отдельного утверждения:

- дублирование тестов;
- массовые действия;
- расширенные фильтры;
- экспорт вопросов;
- банк вопросов.

### Questions Builder

MVP включает только:

- `single_choice`;
- `multiple_choice`;
- `short_text`;
- полный балл или 0;
- topic обязателен;
- subtopic необязателен;
- difficulty необязателен, default `medium`;
- order up/down.

Не добавлять:

- drag-and-drop;
- partial points;
- manual review;
- matching/sorting/essay/audio/image tasks.

### Import XLSX/CSV

MVP включает:

- XLSX как основной формат;
- CSV как дополнительный формат;
- download template;
- upload;
- validate;
- errors/warnings;
- preview;
- `append`;
- `replace`;
- commit only if no critical errors;
- no partial import.

Точные template columns:

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

Лимиты из supporting doc:

- максимум 500 rows вопросов;
- максимум 5 MB файл;
- максимум 4 options.

P1, не делать сейчас:

- Word/PDF/Google Docs import;
- image import;
- AI parsing;
- complex duplicate search;
- export questions.

### Public Student Flow

MVP включает:

- каталог опубликованных тестов;
- страницу теста;
- ввод email;
- активацию access code;
- оплату;
- service states для access/payment/code;
- pre-start screen;
- start attempt only with valid access.

Главная страница необязательна. По умолчанию первый экран - каталог тестов.

### Payments And Access

MVP включает:

- create pending payment;
- success access only after verified webhook/provider confirmation;
- idempotent webhook;
- manual access;
- one-time access code;
- access code hash only;
- admin lists for payments, accesses, codes;
- email after payment;
- email after manual access;
- event logs for critical actions.

Важно:

- frontend не является источником суммы или валюты;
- backend берет price/currency из test;
- one payment must create at most one access;
- one code can be activated once;
- if multiple active accesses exist, use FIFO: nearest `expires_at`, then oldest created access;
- if access expires during already started attempt, completion is allowed;
- if test is hidden after purchase, existing access can still be used, but new purchases should be blocked.

P0.5/P1, не делать без утверждения:

- resend access link;
- email after code activation;
- email after attempt completion;
- revoke access/code UI/API;
- extend access;
- add attempts;
- mass code generation;
- exports;
- refunds;
- promocodes;
- packages;
- subscriptions;
- student personal account.

### Attempts And Snapshot

MVP включает:

- start attempt in transaction;
- check access in backend;
- decrement `attempts_available` at start;
- refresh must return existing `started` attempt without second decrement;
- test snapshot includes questions, correct answers, scoring rules, points, topic/subtopic and result display settings;
- if scale is connected, scoring scheme snapshot is also saved;
- answers can be changed only while attempt is `started`;
- complete and expire are idempotent.

### Scoring And Results

MVP includes:

- backend-only scoring;
- `single_choice` full match;
- `multiple_choice` full set match only;
- `short_text` exact text after normalization;
- empty answers as wrong;
- raw score;
- max raw score;
- percent;
- level;
- topic results;
- mistakes;
- correct answers after completion;
- explanations after completion if present;
- recommendations without AI;
- CE/CT scaled score 0-100 when scale is connected.

Level thresholds:

- `< 40`: низкий;
- `40-59`: ниже среднего;
- `60-79`: средний;
- `80-89`: хороший;
- `90-100`: высокий.

Topic status thresholds:

- `< 60`: `weak`;
- `60-79`: `requires_review`;
- `>= 80`: `normal`.

## Schema/API Deltas To Apply Before Implementation

The current draft `prisma/schema.prisma` should be reconciled with `docs/supporting/database-schema-api-v1.md` before Sprint 1 implementation.

Required corrections:

- Add optional `User.name`.
- Align `ImportJob` fields with import spec: `file_type`, `admin_id`, row counters, `validated_at`, `imported_at`.
- Align `ImportJobStatus` values with spec: `uploaded`, `validated`, `failed`, `imported`, `cancelled`.
- Ensure `ManualAccessLog` stores `admin_id`, `user_id`, `test_id`, `access_id`, `attempts_total`, `access_days`, `comment`.
- Keep `Access.source` MVP values to `payment`, `manual`, `access_code`. Do not implement `promo` behavior.
- Keep future scoring rules `manual` and `partial_match` out of MVP behavior. If enums include them, validation must reject them in MVP flows.
- Ensure `answers` has unique key by `attempt_id + snapshot_question_id`.
- Ensure `Payment.provider + provider_payment_id` is indexed and idempotency-safe.
- Ensure `scoring_scheme_snapshot_json` is stored on attempts when CE/CT scale is used.
- Ensure API result for active attempts never returns `correct_answer`, `points`, `scoring_rule`, `is_correct`, `points_earned` or explanation that reveals the answer.

## Scope Notes And Potential Conflicts

- Some docs mention `promo` as future value. Final MVP does not include promocodes or discounts. Keep this out of MVP behavior.
- Some docs list revoke endpoints. Payment docs mark revoke as P1. Store fields can exist, but UI/API implementation should wait for approval.
- Some docs mark CE/CT scale as P0.5. User decision overrides this planning detail: CE/CT 0-100 is included in MVP.
- Scoring docs put full scale import/UI in P0.5. For MVP, we still need a practical way to provide the scale table if scaled score is required.
- `resend-link` is desirable/P0.5, not required P0.
- Email after code activation and after test completion is desirable/P0.5. Required MVP emails are after payment and manual access.
- Admin Test Builder mentions `purchase enabled` and `code activation enabled`. These are not core Final MVP fields. Do not add them unless needed after product approval.
- `price too low` warning has no business rule in Final MVP. Do not implement.
- CSV exports and result exports are P1/P0.5. Do not implement in MVP unless explicitly approved.

## Open Decisions Before Relevant Sprints

- Payment provider: bePaid, WebPay, ERIP/E-POS or another provider.
- Provider sandbox credentials and webhook docs.
- Exact production domain/return URLs for payment.
- Student ownership mechanism without a student password: signed token, magic link, or short-lived cookie.
- Final email texts.
- Project name.
- Visual style: colors, logo, basic brand direction.
- Whether to build a separate landing page or use catalog as first screen.
- Real CE/CT scale table for the first tests.
- Who prepares the first 1-3 tests.
- Who verifies educational correctness before publishing.
- Legal pages and data processing/payment requirements.
