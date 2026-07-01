# Phase 1 Foundation Report

## Статус

Phase 1: Technical Foundation выполнен.

## Что Сделано

- `prisma/schema.prisma` приведена к `docs/supporting/database-schema-api-v1.md` и `docs/07-supporting-docs-analysis.md`.
- Добавлены/уточнены сущности:
  - `User.name`, `User.deleted_at`;
  - `Test.created_by_admin_id`;
  - `Difficulty`;
  - `ScoringRule`;
  - `ImportJob` с `file_type`, counters, `validated_at`, `imported_at`;
  - `ManualAccessLog` с admin/user/test/access fields;
  - `EmailLog` по DB/API spec;
  - `ScoringScheme` и `ScoringScale`;
  - snapshot fields для attempts.
- `Test.price` и `Payment.amount` переведены в integer minimal currency units, как в DB/API spec.
- Prisma и `@prisma/client` закреплены на `6.19.3`, чтобы не ловить breaking changes Prisma 7.
- TypeScript закреплен на `5.9.3`.
- Vitest закреплен на `3.2.6`.
- ESLint закреплен на `9.39.4` и добавлен `eslint.config.mjs`.
- Остальные runtime/dev зависимости также закреплены на фактически установленных версиях вместо `latest`, чтобы install был воспроизводимым.
- Добавлен единый API response helper:
  - `src/lib/api-response.ts`.
- Добавлены базовые validation helpers:
  - `src/lib/validation/email.ts`;
  - `src/lib/validation/schemas.ts`.
- Добавлен EventLog helper:
  - `src/server/events/log-event.ts`.
- Добавлен email adapter interface:
  - `src/server/emails/email-adapter.ts`;
  - `src/server/emails/email-log.ts`.
- `GET /api/health` переведен на единый формат `{ success, data }`.
- Добавлены unit tests:
  - `tests/unit/validation.test.ts`.

## Проверки

Выполнено успешно:

- `pnpm exec prisma validate`
- `pnpm exec prisma generate`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`

## Важные Решения

- В MVP behavior не добавлены `promo`, partial points, manual scoring или вне-MVP question types.
- Future enum values `MANUAL` и `PARTIAL_MATCH` оставлены только как архитектурный задел. MVP validation должна их блокировать в пользовательских flows.
- `AccessSource` оставлен только в MVP-значениях: `payment`, `manual`, `access_code`.

## Риски

- Реальная миграция базы еще не запускалась, потому что нет подключенной PostgreSQL базы.
- Для Phase 2 понадобится решить, как создавать первого admin user: seed script или ручная команда.
- Перед публичными student endpoints нужно утвердить Gate B: способ защиты access/attempt/result без личного кабинета.

## Следующий Шаг

Phase 2: Admin Auth And Test CRUD.

Перед стартом Phase 2 нужно утвердить:

- нейтральный базовый UI сейчас или дать цвета/логотип;
- способ создания первого админа для локальной разработки и production.
