# Demo Content Report

## Статус

Demo content seed добавлен.

## Что Добавлено

- Script: `scripts/seed-demo-content.mjs`
- Package script: `pnpm seed:demo`
- `pnpm setup:local` теперь выполняет:
  - `pnpm db:up`;
  - `pnpm prisma:migrate`;
  - `pnpm prisma:generate`;
  - `pnpm seed:admin`;
  - `pnpm seed:demo`.

## Demo Test

Создается один тест:

- title: `DEMO ONLY — Русский язык. Онлайн-тесты`
- slug: `demo-russian-language-online-test`
- status: `draft`
- mode: `training`
- price: `0`
- duration: `30` minutes
- access days: `7`
- attempts: `1`

## Demo Questions

Создается 10 вопросов:

- `single_choice`;
- `multiple_choice`;
- `short_text`.

Темы:

- Орфография;
- Пунктуация;
- Грамматика;
- Лексика.

Points:

- mostly `1`;
- `multiple_choice` uses `2` where useful.

## Важное Ограничение

Demo questions are development-only content.

Они нужны только для проверки:

- UI;
- admin flows;
- counters;
- future public flow;
- future scoring flow.

Их нельзя использовать как финальный учебный контент или реальный экзаменационный материал.

Перед публикацией реальные 1-3 теста должен предоставить или проверить эксперт по русскому языку.

## Idempotency

Seed можно запускать повторно.

Если demo test уже существует, script:

- обновляет demo test;
- soft-delete старые demo questions этого test;
- создает актуальные demo questions;
- пересчитывает `questions_count`;
- пересчитывает `max_raw_score`;
- пишет `demo_content_seeded` в `event_logs`.

## Проверки

Кодовые проверки выполнены успешно:

- `pnpm exec prisma validate`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`

Сам `pnpm seed:demo` требует поднятой PostgreSQL базы и выполненных миграций:

```bash
pnpm setup:local
```
