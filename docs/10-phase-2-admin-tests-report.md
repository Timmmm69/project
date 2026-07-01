# Phase 2 Admin Auth And Test CRUD Report

## Статус

Phase 2: Admin Auth And Test CRUD выполнен.

## Что Сделано

- Добавлен seed script первого администратора:
  - `scripts/seed-admin.mjs`;
  - package script `pnpm seed:admin`;
  - `.env.example` дополнен `ADMIN_PASSWORD`.
- Добавлена admin auth foundation:
  - signed cookie session;
  - `POST /api/admin/auth/login`;
  - `POST /api/admin/auth/logout`;
  - `GET /api/admin/auth/me`.
- Добавлен Admin Test CRUD API:
  - `GET /api/admin/tests`;
  - `POST /api/admin/tests`;
  - `GET /api/admin/tests/:test_id`;
  - `PATCH /api/admin/tests/:test_id`;
  - `DELETE /api/admin/tests/:test_id`.
- Добавлены status actions:
  - `POST /api/admin/tests/:test_id/publish`;
  - `POST /api/admin/tests/:test_id/hide`;
  - `GET /api/admin/tests/:test_id/publish-check`.
- Добавлена publish-check logic:
  - обязательное название;
  - корректная цена;
  - duration/access days больше 0;
  - наличие вопросов;
  - `max_raw_score > 0`;
  - обязательные поля вопросов;
  - базовая проверка вариантов для `single_choice` и `multiple_choice`;
  - проверка шкалы, если включен `show_scaled_score`.
- Добавлен минимальный admin UI:
  - вход в админку;
  - создание теста;
  - список тестов.
- Добавлены unit tests для publish-check.

## Что Не Делалось

- Конструктор вопросов не реализован в Phase 2. Это Phase 3.
- Импорт XLSX/CSV не реализован. Это Phase 4.
- Публичный каталог не расширялся. Это Phase 5.
- Финальный красивый UI не делался. Сейчас интерфейс нейтральный и структурный, чтобы позже спокойно заменить визуальный слой.

## Проверки

Выполнено успешно:

- `pnpm exec prisma validate`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`

Unit tests:

- `tests/unit/validation.test.ts`
- `tests/unit/publish-check.test.ts`

## Как Проверить Вручную После Подключения PostgreSQL

1. Создать `.env` на основе `.env.example`.
2. Указать `DATABASE_URL`.
3. Указать `SESSION_SECRET`.
4. Указать `ADMIN_EMAIL` и `ADMIN_PASSWORD`.
5. Выполнить миграцию Prisma.
6. Выполнить `pnpm seed:admin`.
7. Запустить `pnpm dev`.
8. Открыть `/admin`.
9. Войти под `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
10. Создать тест.
11. Проверить, что тест появился в списке.

## Риски

- Реальная ручная проверка login -> create test требует подключенной PostgreSQL базы и миграции.
- Первый admin seed зависит от корректных env variables.
- Перед Phase 3 нужно реализовать вопросы, иначе publish-check ожидаемо блокирует публикацию тестов без вопросов.

## Следующий Шаг

Phase 3: Questions Builder.

Codex должен реализовать:

- Question CRUD;
- валидацию `single_choice`, `multiple_choice`, `short_text`;
- порядок вопросов up/down;
- пересчет `questions_count` и `max_raw_score`;
- запрет вне-MVP типов и partial points.
