# ТЗ: интеграция release-кандидата и production-like staging

Дата: 2026-08-21
Статус: готово к утверждению Product Owner
Основание: `docs/00-final-mvp-spec-v2.md`, `AGENTS.md`, `docs/payment-program/stage-7-launch-control-v1.md`.

## 1. Цель и границы

Подготовить единый, воспроизводимый release-кандидат MVP и развернуть его в изолированном production-like staging-окружении. После выполнения этих двух этапов проект должен быть технически готов к подключению домена и проведению внешних launch-gates, но не к приёму реальных платежей.

Production verdict после обоих этапов остаётся `NO-GO`. Нельзя включать реальный WEBPAY, выполнять реальные списания, менять verdict QA-02 или заменять внешние merchant/legal/email evidence локальными проверками.

Этапы не включают:

- добавление функций вне утверждённого MVP;
- изменение правил scoring, access или payment без отдельного решения;
- перенос реальных пользовательских данных в тестовую БД;
- публикацию production-домена;
- включение `COMMERCIAL_CHECKOUT_ENABLED=true` в production.

## 2. Этап 1 — интеграция единого release-кандидата

### 2.1. Цель

Свести в одну ветку совместимый набор изменений, который содержит и текущий payment/security-контур `main`, и требуемые UX/recovery/result/CI улучшения, не теряя миграции, security-инварианты и уже принятые payment reviews.

### 2.2. Исходное состояние

На начало работ используются только следующие зафиксированные источники:

| Источник | Назначение | Состояние на дату ТЗ |
|---|---|---|
| `main` (`f3f818b`) | Базовая линия релиза: payment state, security hardening, canonical checkout, legal bundle | Главная линия, содержит 17 Prisma migrations |
| `ux/ux-1h-res-block-01-completed-at` (`c074582`) | Новые catalog, pre-start/recovery, safe authentic result, CI и readiness-аудит | Не влит в `main`; расходится с ним существенно |
| Текущий рабочий каталог | Последние дизайн-правки и материалы | Нельзя терять, перезаписывать или считать принятыми автоматически |

До начала интеграции исполнитель фиксирует точные SHA всех трёх источников в отчёте. Любая новая ветка создаётся от текущего `main`; рекомендуемое имя: `codex/release-integration`.

### 2.3. Обязательные работы

1. Защитить существующую работу.

   - Выполнить `git status --short` и `git diff --check`.
   - Составить inventory изменённых и untracked файлов с решением для каждого: включить в релиз, вынести отдельно или сохранить нетронутым.
   - Не применять `git reset --hard`, `git checkout --`, force-push, удаление untracked файлов или переписывание существующих миграций.
   - Не начинать merge, пока Product Owner не подтвердит судьбу текущих незакоммиченных дизайн-изменений.

2. Провести change-matrix двух линий.

   Для каждого пересекающегося файла указать: источник истины, требуемый итог, риск регрессии и проверку. Минимально в matrix должны быть:

   - `prisma/schema.prisma` и все миграции;
   - `src/lib/commercial/**`, `src/server/auth/**`, `src/server/recovery/**`;
   - публичные страницы каталога, теста, pre-start, попытки и результата;
   - API attempts, results, access check, commercial orders и recovery;
   - analytics, privacy/cache/referrer rules;
   - `playwright.config.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.env.example`;
   - unit, integration и Playwright tests.

3. Интегрировать код по тематическим блокам, а не одним неконтролируемым merge.

   Порядок: schema/migrations → server security/payment/recovery → API → UI → analytics → test configuration/CI → documentation.

   - При конфликте сохранять более строгую security-проверку, а не упрощать flow ради слияния.
   - Access создаётся только по подтверждённой server-side оплате, ручной выдаче или валидному одноразовому коду.
   - Redirect/return браузера не является доказательством оплаты.
   - Scoring остаётся backend-only; активная попытка не отдаёт ключи, explanations или данные, раскрывающие ответ.
   - Refresh не создаёт новую попытку и не списывает вторую.
   - Уже принятый `main` payment flow нельзя заменить legacy ExpressPay/ЕРИП интерфейсом.

4. Отдельно разрешить Prisma compatibility.

   - Сравнить каждый migration directory, имеющий одинаковое имя в обеих линиях, побайтово и семантически.
   - Нельзя редактировать migration, который потенциально уже применён в любой среде.
   - При несовместимости создать новую forward-only migration с новым timestamp; документировать dependency и порядок её применения.
   - Сохранить migration `20260809123000_sanitize_payment_payloads` из `main`.
   - Выполнить `pnpm exec prisma validate` и `pnpm exec prisma migrate diff` против итоговой schema; результат приложить к отчёту.

5. Подготовить воспроизводимый CI.

   - В итоговой ветке должен быть workflow в `.github/workflows/ci.yml` без секретов и персональных данных.
   - Для pull request и main workflow запускает: install с lockfile, Prisma generate/validate, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
   - Database/integration/e2e jobs разрешаются только на disposable database и не используют production secrets.
   - Нельзя считать CI зелёным, если job фактически выключает или пропускает обязательные тесты без явного отчёта о причине.

6. Обновить документацию и traceability.

   - Переписать `docs/00-current-project-state.md` на основе итогового SHA; сейчас это untracked исторический снимок, а не достоверный статус `main`.
   - Обновить release checklist, migration inventory, known limitations и links на evidence.
   - В `docs/payment-program/board.md` не менять `NO-GO` и не закрывать external-gates без внешнего evidence.
   - Создать краткий integration report: baseline SHAs, принятые конфликты, migration plan, результаты проверок, список невлитых изменений и риски.

### 2.4. Обязательные проверки этапа 1

На чистом checkout итоговой ветки выполнить:

```powershell
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Дополнительно провести source review минимум по следующим инвариантам:

- нет отправки `correctAnswer`, `acceptedAnswers`, `explanation` или scoring details активной попытке;
- payment callback/authoritative status проверяет signature, amount, currency, reference и idempotency;
- повторный webhook не создаёт второй Access;
- secrets не попали в diff, CI, fixtures, screenshots или documentation;
- никакие production flags не включены в примерах env или CI;
- новые страницы не содержат запрещённых claims об «официальном» тесте.

### 2.5. Результат и критерии приёмки этапа 1

Этап считается принятым только когда:

1. Есть один immutable release-candidate SHA и pull request/review для него.
2. Рабочий каталог не содержит неучтённых изменений, попадающих в релиз.
3. Все Prisma migrations имеют однозначный, forward-only путь применения.
4. Все команды из раздела 2.4 успешны на чистом checkout.
5. CI создан и проходит на итоговом SHA.
6. Есть integration report и актуальный project state.
7. `COMMERCIAL_CHECKOUT_ENABLED` не включён, `Production verdict = NO-GO` не изменён.

### 2.6. Риски и решения, требующие утверждения

Перед началом Product Owner должен подтвердить:

1. Включаются ли текущие незакоммиченные redesign-изменения в релиз-кандидат.
2. Требуется ли в первом коммерческом релизе весь набор UX-ветки или только безопасный минимальный набор: catalog + recovery + authentic result.
3. Допустимо ли создавать новые forward-only migrations при несовместимости старых миграций.

Если хотя бы один ответ отсутствует, исполнитель может только подготовить change-matrix, но не выполнять интеграционный merge.

## 3. Этап 2 — production-like staging, БД и полный QA

### 3.1. Цель

Развернуть release-кандидат из этапа 1 в отдельной staging-среде, максимально близкой к production, с отдельной PostgreSQL, безопасными secrets, HTTPS, health check, резервным копированием и полным автоматизированным QA. Финальный домен и реальный эквайринг для этого этапа не нужны.

### 3.2. Архитектурный approval gate

До исполнения Product Owner выбирает один из вариантов.

| Вариант | Плюсы | Минусы |
|---|---|---|
| A. Managed Next.js hosting + managed PostgreSQL | Быстрый HTTPS/deploy/rollback, минимум администрирования | Зависимость от платформы и её лимитов |
| B. VPS с контейнеризированным Next.js и managed PostgreSQL | Полный контроль над runtime и сетью | Нужны регулярные security updates, monitoring и резервные копии |
| C. VPS с Next.js и PostgreSQL на одном сервере | Минимальная внешняя инфраструктура | Худшая изоляция и выше риск потери данных; не рекомендуется для коммерческого запуска |

ТЗ не предполагает конкретного провайдера. После выбора необходимо предоставить исполнителю доступ только к staging-проекту и staging secret store. Production account/credentials и финальный домен на этом этапе не передаются.

### 3.3. Требования к staging-инфраструктуре

1. Среда и сеть.

   - Отдельные application и PostgreSQL instances; запрещено использовать локальную или production БД.
   - Публичный временный HTTPS URL вида `https://staging.<временный-host>` или URL хостинга.
   - Application принимает трафик только по HTTPS; HTTP перенаправляется на HTTPS, если это поддерживается выбранной платформой.
   - PostgreSQL не имеет публичного доступа; разрешены только application network/allowlist и административный канал владельца.
   - `GET /api/health` используется как liveness check; health check не раскрывает secrets, PII или внутренние ошибки.

2. Secrets и runtime configuration.

   - Все значения хранятся только в secret store выбранной платформы; `.env`, логи, CI output и репозиторий не содержат их значений.
   - Для staging обязательны отдельные, криптографически случайные значения `SESSION_SECRET`, `ACCESS_CODE_HASH_PEPPER`, admin credentials/hash и `DATABASE_URL`.
   - `APP_URL` равен точному staging HTTPS URL; `NODE_ENV=production`.
   - `ADMIN_PASSWORD` не является default/placeholder; предпочтительно используется `ADMIN_PASSWORD_HASH`.
   - Mock payments не включаются для public production-like URL: `ENABLE_MOCK_PAYMENTS=false`.
   - Пока не закрыты внешние WEBPAY gates: `COMMERCIAL_CHECKOUT_ENABLED=false`, `PAYMENTS_MODE=disabled`; credentials WEBPAY не добавляются как workaround.
   - SMTP/recovery в staging допускаются только через тестовый sender и адреса команды; письма не должны попадать случайным получателям.
   - Логи используют `LOG_LEVEL=info`, не содержат raw provider payload, OTP, email в открытом виде, токены, пароли или headers авторизации.

3. База данных и данные.

   - До первой migration создать зашифрованный backup и документировать restore procedure.
   - Применять только `pnpm exec prisma migrate deploy`; не использовать `prisma migrate dev` в staging/production-like среде.
   - После миграций `pnpm exec prisma migrate status` должен показывать все 17 migrations как applied, включая `20260809123000_sanitize_payment_payloads`.
   - Выполнить `pnpm exec prisma generate` в build/release process.
   - Создать отдельного staging admin; загрузить только synthetic/demo или специально подготовленный staging content. Реальные ученические данные запрещены.
   - Проверить backup restore на отдельной disposable database до завершения этапа.

4. Deploy и rollback.

   - Каждый deploy привязан к immutable Git SHA и имеет timestamp, автора, версию schema/migrations и ссылку на CI run.
   - До deploy выполняются CI checks из этапа 1.
   - При failure migration: остановить rollout, не повторять миграцию вслепую, сохранить логи, восстановить backup только по утверждённой процедуре.
   - При application regression: вернуть предыдущий совместимый application SHA; Order/Attempt/Access/Payment данные не удалять и не переписывать.
   - Immediate feature-off для коммерческого checkout: `COMMERCIAL_CHECKOUT_ENABLED=false`.

### 3.4. Полный QA на disposable test database

Ни integration, ни Playwright tests не запускаются против staging БД с долгоживущими данными. Для них создаётся отдельная disposable PostgreSQL database с применёнными миграциями и test fixtures.

1. Базовая проверка release SHA:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

2. Запуск всех DB integration suites с явными флагами:

```powershell
$env:RUN_ACC01A_INTEGRATION='true'
$env:RUN_ACC01A_CONTINUATION_INTEGRATION='true'
$env:RUN_ACC01A_RECOVERY_INTEGRATION='true'
$env:RUN_ACC01A_HTTP_INTEGRATION='true'
$env:RUN_ACC01A_STATE_RESOLVER_INTEGRATION='true'
$env:RUN_ACC01A_DESTINATION_GUARDS_INTEGRATION='true'
pnpm test
```

3. Запуск полного browser suite:

```powershell
$env:RUN_E2E_WITH_DB='true'
pnpm test:e2e
```

4. Ручной staging smoke после deploy:

   - `GET /api/health` возвращает успешный безопасный ответ.
   - admin login → create/import → publish → preview → hide/unpublish.
   - email identify → access-code activation → single attempt → refresh → complete → result.
   - manual access и code не дают вторую попытку при повторе.
   - active attempt не показывает правильные ответы; completed result соблюдает настройки теста.
   - ошибки API не раскрывают stack trace, credentials, PII или raw payment data.
   - мобильная ширина 320 px, keyboard navigation, focus/error states и 200% zoom проверены для checkout, pre-start, attempt и result.
   - fake/merchant payment не выдаёт Access от browser return без authoritative backend confirmation.

5. Проверка operational readiness:

   - tested backup restore успешен;
   - error logs доступны только команде;
   - deploy rollback отрепетирован хотя бы один раз;
   - скан репозитория/CI/logs не нашёл secrets;
   - фактические результаты тестов и ручного smoke приложены к staging report, а пропуски объяснены.

### 3.5. Артефакты этапа 2

1. Infrastructure/deployment document с выбранной платформой, архитектурой, URLs, владельцами и без secret values.
2. Environment-variable inventory: имя, назначение, где хранится, кто владелец, rotation rule; без значений.
3. Migration + backup/restore + rollback runbook.
4. CI workflow и ссылка на успешный run для release SHA.
5. Staging QA report: migration status, integration/e2e results, ручной smoke, найденные defects, остаточные риски.
6. Обновлённый launch checklist с явно сохранённым `NO-GO` для real payments.

### 3.6. Критерии приёмки этапа 2

Этап принят, когда одновременно выполнены все условия:

1. Release SHA из этапа 1 развёрнут на отдельном HTTPS staging URL.
2. БД изолирована, все migrations применены, backup restore проверен.
3. CI, unit, integration и Playwright suites прошли без необъяснённых skip/failure.
4. Обязательный ручной smoke пройден, включая access, attempt, result и security-sensitive payment states.
5. Все secrets остаются вне репозитория и логов; mock/real payment feature flags соответствуют разделу 3.3.
6. Существует протестированный app rollback и documented DB incident procedure.
7. В отчёте явно указано: staging готов, production payments не активированы, `QA-02 = NO-GO`.

## 4. Что потребуется от Product Owner

До этапа 1: подтверждение состава текущих незакоммиченных дизайн-правок и минимального набора UX-изменений для релиза.

До этапа 2: выбор варианта хостинга, staging account/project access, владелец staging secrets и тестовый адрес для почтовой проверки.

Для следующего, отдельного этапа запуска потребуется: домен, WEBPAY merchant agreement/credentials, подтверждённый протокол, seller/legal/receipt/support данные и production SMTP. Эти материалы не нужны для начала этапов 1–2, но без них нельзя переходить к реальному коммерческому запуску.
