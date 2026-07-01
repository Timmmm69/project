# Phase 3 Questions Builder Report

## Статус

Phase 3: Questions Builder выполнен.

## Что Сделано

- Добавлен local development baseline:
  - `docker-compose.yml` для PostgreSQL;
  - `.env.local.example`;
  - README-инструкции локального запуска;
  - scripts:
    - `pnpm db:up`;
    - `pnpm db:down`;
    - `pnpm db:logs`;
    - `pnpm setup:local`.
- Зафиксированы утвержденные решения:
  - `docs/11-approved-decisions-current.md`;
  - ссылка добавлена в `AGENTS.md`.
- Добавлена логика вопросов:
  - enum mapping;
  - normalization correct answers;
  - validation для `single_choice`, `multiple_choice`, `short_text`;
  - scoring rule mapping: `full_match` / `exact_text`;
  - serialization.
- Добавлен Admin Questions API:
  - `GET /api/admin/tests/:test_id/questions`;
  - `POST /api/admin/tests/:test_id/questions`;
  - `GET /api/admin/questions/:question_id`;
  - `PATCH /api/admin/questions/:question_id`;
  - `DELETE /api/admin/questions/:question_id`;
  - `PATCH /api/admin/questions/:question_id/order`.
- Реализовано:
  - soft delete questions;
  - order up/down;
  - automatic `questions_count` recalculation;
  - automatic `max_raw_score` recalculation;
  - EventLog for create/update/delete/reorder.
- Расширен admin UI:
  - выбор теста;
  - список вопросов;
  - форма добавления вопроса;
  - кнопки вверх/вниз/удалить.

## Правила MVP

- Поддерживаются только:
  - `single_choice`;
  - `multiple_choice`;
  - `short_text`.
- Частичные баллы не добавлены.
- Сложные типы заданий не добавлены.
- Для `multiple_choice` правильный ответ нормализуется в полный набор вида `A,C`.
- Для `short_text` допустимые ответы нормализуются через `;`.
- Для `short_text` варианты A-D очищаются и не используются.

## Проверки

Выполнено успешно:

- `pnpm exec prisma validate`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`

Unit tests:

- `tests/unit/validation.test.ts`
- `tests/unit/publish-check.test.ts`
- `tests/unit/questions.test.ts`

## Как Проверить Вручную После Подключения PostgreSQL

1. `cp .env.local.example .env`
2. `pnpm setup:local`
3. `pnpm dev`
4. Открыть `/admin`.
5. Войти под dev admin:
   - `admin@example.com`
   - `ChangeMeAdmin123!`
6. Создать тест.
7. Выбрать тест в списке.
8. Добавить вопросы:
   - один `single_choice`;
   - один `multiple_choice`;
   - один `short_text`.
9. Проверить, что:
   - вопросы появились в списке;
   - `questions_count` обновился;
   - `max_raw_score` обновился;
   - порядок можно менять;
   - вопрос можно удалить.

## Ограничения

- Редактирование вопроса через UI пока не добавлено, но API `PATCH` уже есть.
- Drag-and-drop не добавлен, потому что это P1.
- Demo content seed еще не добавлен. Он утвержден и будет полезен перед полноценной ручной проверкой flow.

## Следующий Шаг

Phase 4: XLSX/CSV Import.

Перед ним полезно добавить demo content seed, потому что он поможет проверять admin/public/scoring flows без реального учебного контента.
