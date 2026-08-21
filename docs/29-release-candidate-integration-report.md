# Release Candidate Integration Report

Дата: 2026-08-21
Ветка: `codex/release-integration`
Baseline: `f3f818b7d186b188a696880f97bedb06e7ff2571` (`main`)
UX source: `c074582c010a0f3ac253cf7e171e3e7d9b0185a0`
Implementation/config SHA: `1132de3bb244ae0fe5d29adae43b845a00b73b02`
Production verdict: **NO-GO**.

Документирующий commit не может содержать собственный SHA; поэтому окончательный release SHA фиксируется в PR и в handoff, а этот отчёт привязан к проверенному implementation/config SHA и ветке.

## Объединённые тематические блоки

| Блок | Коммит | Результат |
|---|---|---|
| Schema/migrations + pre-start authority | `0d6a89d` | Сохранена схема `main`; добавлены verified issuer, OPEN_PRE и явный старт Attempt. |
| Recovery | `7bdfa2a` | Интегрированы recovery state/UI и continuation exchange. |
| Result | `f9c6328` | Authentic result ограничен безопасными первичными агрегатами. |
| Catalog/UI | `8682107`, `1132de3` | Канонический каталог совмещён с подтверждённым дизайном и public assets. |
| Analytics | `d0e0776` | Интегрированы canonical contracts, persistence и privacy scans. |
| Tests/CI/readiness/docs | `1132de3` | Сохранён disposable-DB CI, добавлены UX-тесты и readiness-документы. |

## Change matrix и решения по пересечениям

| Область | Итоговое решение | Проверка |
|---|---|---|
| `prisma/schema.prisma`, migrations | Взята актуальная схема `main`. Общие 14 migrations совпали побайтно; три более новые migrations `main` сохранены. Существующие файлы не переписывались. | `prisma generate`, `prisma validate`, сравнение списков и SHA-256; sanitizer присутствует. |
| `src/lib/commercial/**` | Сохранены main payment integrity, immutable order snapshot, trusted-origin, safe DTO, rate limits и payload sanitization. UX-flow подключён поверх них. | Commercial security/status/origin/rate-limit/payload unit suites. |
| `src/server/auth/**`, `src/server/recovery/**` | Verified commercial session и destination guard интегрированы с recovery; main CSRF/origin и fail-closed поведение имеют приоритет. | Issuer, destination, recovery domain/HTTP/continuation unit suites. |
| Каталог и test page | Взят canonical async catalog/error/empty flow UX-линии и адаптирован к подтверждённому warm visual design; test page сохраняет product/PRE/expired branches. | Catalog view unit tests, catalog Playwright spec, lint/typecheck/build. |
| Checkout | Сохранён canonical WEBPAY UI `main`; legacy ExpressPay/ЕРИП checkout UX-линии не возвращён. | Checkout flow, public legal content, commercial response tests. |
| Pre-start, Attempt, Result | Claim возвращает OPEN_PRE без Attempt. Явный start создаёт или восстанавливает Attempt. Authentic result выдаёт только первичные агрегаты и authoritative `completedAt`. | Entry resolver, snapshot, scoring, result serialization/view tests. |
| Attempts/results/access API | Backend остаётся единственным местом scoring; active Attempt serializer не отдаёт `correctAnswer`, `acceptedAnswers`, `explanation` и scoring details; start остаётся idempotent. | Scoring, snapshot, answer normalization, result serialization tests. |
| Commercial order/payment API | Access возникает только из подтверждённого payment claim; redirect/return не меняет payment authority; webhook/idempotency constraints `main` сохранены. | Commercial payment/order/security suites и DB integration jobs в CI. |
| Recovery API | Challenge/verify/state/continue интегрированы; recovery cookie не становится самостоятельной authority и заменяется только после committed continuation proof. | Recovery unit cases и disposable-DB integration slices. |
| Analytics/security/cache/referrer | Канонические события объединены с main privacy/security policy. Private и verified responses используют `no-store`/`no-referrer`. | Analytics contract/privacy/persistence и response-policy tests. |
| `playwright.config.ts`, `vitest.config.ts`, `.env.example` | Конфиги UX-линии объединены с main. Sandbox/fake разрешён только для тестового Playwright server; repository defaults выключают checkout/payments. | Config review, unit suite, build; clean checkout. |
| `.github/workflows/ci.yml` | Frozen install, Prisma validate/generate, disposable PostgreSQL migrations/integration, lint, typecheck, unit tests и build. Production secrets отсутствуют. | Workflow review и PR checks. |
| Unit/integration/Playwright tests | UX tests сохранены и приведены к main trusted-origin/cache/UI контракту; даты фикстур сделаны непросроченными. DB/e2e не запускаются без disposable DB/explicit opt-in. | `pnpm test`; CI integration slices; Playwright на staging/disposable data. |

## Migration plan

1. Не изменять уже применённые migrations.
2. Применять текущую последовательность через `prisma migrate deploy` только на целевую disposable/staging DB.
3. Обязательно применить `20260809123000_sanitize_payment_payloads` после rate-limit migration.
4. Новая forward-only migration не создана: schema conflict отсутствует.
5. Перед staging проверить backup/restore runbook и фактический migration status; production deploy этим release-кандидатом не разрешён.

## Инварианты

- Scoring выполняется только backend.
- Активная попытка не раскрывает ответы, объяснения или scoring details.
- Access создаётся только после подтверждённой оплаты, ручной выдачи или валидного одноразового кода.
- Browser redirect/return не подтверждает оплату.
- Повторный webhook не создаёт второй Access.
- Refresh/start восстанавливает существующую попытку и не списывает вторую.
- Canonical checkout не содержит legacy ExpressPay/ЕРИП UI.
- `.env.example`: `COMMERCIAL_CHECKOUT_ENABLED="false"`, `PAYMENTS_MODE="disabled"`, fake provider выключен.

## Результаты проверок

Локально на implementation/config SHA:

- `pnpm exec prisma generate` — PASS.
- `pnpm exec prisma validate` — PASS.
- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS: 45 files / 1147 tests; 8 DB integration files / 171 tests skipped без opt-in.
- `pnpm build` — PASS.
- `git diff --check` — PASS.

Clean-checkout прогон `e60a5ff327c46f9b2a664240229700b4f776a034` выполнен с синтетическими CI-переменными и завершился PASS для frozen install, Prisma generate/validate, lint, typecheck, unit tests, build и `git diff --check`. Authoritative remote status финального SHA — GitHub CI check suite в PR.

## Не включено

- `.serena/**`, `tmp/**`, локальные логи, audit screenshots, Lighthouse/Playwright artifacts и кэши.
- Сгенерированное локально изменение `next-env.d.ts`.
- Legacy ExpressPay/ЕРИП checkout UI.
- Любые production credentials и `COMMERCIAL_CHECKOUT_ENABLED=true`.
- Ненужный временный stash с копиями тестов; он не является частью Git tree release-кандидата.

## Риски и незакрытые решения

- Независимый reviewer должен подтвердить merge решения и PR diff.
- GitHub CI обязан пройти именно на final release SHA.
- Перед staging нужны disposable DB, отдельные тестовые credentials и smoke/e2e; production DB использовать нельзя.
- Реальный merchant onboarding, WEBPAY production credentials, legal/payment board, домен, SMTP и operational launch gates остаются внешними блокерами.
- Владелец проекта должен отдельно утвердить production activation. До этого verdict остаётся **NO-GO**.

Payment board и launch-control не изменялись так, будто внешние production gates закрыты.
