# ЦЭ/ЦТ Online Tests MVP

Phase 4 Import XLSX/CSV is complete. Report: `docs/14-phase-4-import-report.md`.

MVP веб-сервиса для продажи онлайн-тестов по русскому языку для подготовки к ЦЭ/ЦТ.

Главный источник истины: `docs/00-final-mvp-spec-v2.md`.

## Текущий статус

Создан каркас проекта и документации для разработки 0->1.

Phase 1 Technical Foundation выполнен: Prisma schema, базовые validation/API helpers, EventLog helper, Email adapter interface и минимальные unit tests готовы.

Отчет: `docs/09-phase-1-foundation-report.md`.

Phase 2 Admin Auth And Test CRUD выполнен: seed первого админа, admin login/logout/me, Test CRUD API, publish/hide/publish-check и минимальный admin UI.

Отчет: `docs/10-phase-2-admin-tests-report.md`.

Phase 3 Questions Builder выполнен: Question CRUD API, валидация трёх MVP-типов вопросов, порядок вопросов, пересчёт `questions_count/max_raw_score` и минимальный UI конструктора.

Отчет: `docs/12-phase-3-questions-builder-report.md`.

Demo content seed добавлен: `pnpm seed:demo`. Он создает демонстрационный тест и 10 demo-вопросов для разработки, не финальный учебный материал.

Отчет: `docs/13-demo-content-report.md`.

## Утвержденный стек

- Next.js + TypeScript: один проект для публичной части, админки и API.
- PostgreSQL: база данных для тестов, платежей, доступов, попыток и результатов.
- Prisma: описание схемы базы и безопасная работа с данными.
- Tailwind CSS + shadcn/ui: быстрый аккуратный интерфейс.
- Zod: проверка форм, API и импорта.
- exceljs + csv-parse: импорт XLSX/CSV.
- Vitest + Playwright: unit и e2e тесты.
- SMTP-compatible email adapter: отправка email без жесткой привязки к одному сервису.
- PaymentProvider adapter: Беларусь-first оплата через выбранного провайдера.

## MVP scope

Входит:

- админка;
- создание и публикация тестов;
- ручной конструктор вопросов;
- `single_choice`, `multiple_choice`, `short_text`;
- импорт Excel/CSV;
- публичный каталог и страница теста;
- ввод email без ученического пароля;
- оплата, webhook, Access;
- ручная выдача доступа;
- одноразовые коды доступа;
- прохождение теста с таймером;
- snapshot при старте попытки;
- backend-only scoring;
- результат с ошибками, правильными ответами и темами;
- админские списки оплат, доступов, кодов и результатов;
- шкала ЦЭ/ЦТ 0-100 в MVP.

Не входит:

- AI;
- личный кабинет ученика;
- подписки;
- пакеты тестов;
- банк вопросов;
- частичные баллы;
- сложные типы заданий.

## План разработки

Основной рабочий план: `docs/08-execution-master-plan.md`.

Краткая разбивка по спринтам: `docs/05-sprints.md`.

## Supporting docs

Supporting docs уже добавлены в `docs/supporting/`:

- `database-schema-api-v1.md`;
- `admin-test-builder-v1.md`;
- `excel-csv-import-spec-v1.md`;
- `payment-access-logic-v1.md`;
- `scoring-engine-v2.md`;
- `development-brief-v1.md`.

Сводка и правила применения: `docs/07-supporting-docs-analysis.md`.

Еще нужны перед соответствующими спринтами:

- финальные тексты email;
- название проекта, цвета, логотип;
- реальная таблица ЦЭ/ЦТ 0-100;
- тестовые данные для первых 1-3 тестов;
- финальный платежный провайдер и его документация.

## Локальный запуск

Для локальной разработки используется PostgreSQL через Docker.

1. Установить зависимости:

```bash
pnpm install --ignore-scripts
```

2. Создать локальный env:

```bash
cp .env.local.example .env
```

Dev-значения из `.env.local.example` подходят только для локальной разработки. В production нужно заменить `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ACCESS_CODE_HASH_PEPPER`, email и payment settings.

3. Поднять PostgreSQL:

```bash
pnpm db:up
```

4. Применить миграции Prisma:

```bash
pnpm prisma:migrate
```

5. Сгенерировать Prisma Client:

```bash
pnpm prisma:generate
```

6. Создать dev-админа:

```bash
pnpm seed:admin
```

Dev-админ:

```text
admin@example.com
ChangeMeAdmin123!
```

Пароль хранится только как hash. Эти dev-данные нельзя использовать в production.

7. Создать demo-content:

```bash
pnpm seed:demo
```

Demo-content нужен только для проверки flow и UI. Он помечен как `DEMO ONLY` и не является финальным учебным материалом.

8. Запустить dev server:

```bash
pnpm dev
```

Быстрая команда для шагов 3-7:

```bash
pnpm setup:local
```

Проверки:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

В этом Codex-окружении доступны bundled Node.js, pnpm и git через runtime Codex, даже если они не установлены в системный PATH.
