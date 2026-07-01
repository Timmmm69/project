# Execution Master Plan

## Принцип Работы

Пользователь утверждает контрольные точки. Codex выполняет подготовку, реализацию, проверки и обновление документации.

Главный источник истины: `docs/00-final-mvp-spec-v2.md`.

Supporting docs применяются через `docs/07-supporting-docs-analysis.md`.

## Approval Gates

Без утверждения пользователя нельзя двигаться дальше в этих местах:

1. **Gate A: Product baseline**
   - название проекта;
   - базовые цвета/логотип или решение "делаем нейтральный интерфейс без бренда";
   - подтверждение, что первым экраном остается каталог тестов.

2. **Gate B: Student security**
   - способ защиты student/attempt/result endpoints без личного кабинета;
   - рекомендованный вариант для MVP: signed token или короткая cookie-сессия после email-identify.

3. **Gate C: Payment provider**
   - точный провайдер оплаты;
   - sandbox docs;
   - webhook signature rules;
   - return/fail URLs;
   - юридические требования провайдера.

4. **Gate D: CE/CT scale**
   - реальная таблица соответствия raw score -> scaled score;
   - способ загрузки шкалы в MVP.

5. **Gate E: Launch content**
   - первые 1-3 теста;
   - проверяющий образовательной корректности;
   - финальные email-тексты;
   - юридические тексты для публичного запуска.

6. **Gate F: Production launch**
   - домен;
   - production database;
   - production payment credentials;
   - production email sender;
   - smoke test перед открытием продаж.

## Рекомендованные Решения По Gate

### Gate B: Student Security

Вариант 1: signed token.

Плюсы:

- простой для MVP;
- не требует личного кабинета;
- можно ограничить срок жизни;
- удобно передавать в ссылках после оплаты/выдачи доступа.

Минусы:

- ссылку нельзя считать полностью секретной, если ученик переслал ее другому человеку;
- нужно аккуратно проверять ownership на backend.

Рекомендация: использовать signed token с коротким сроком и backend-проверкой email/access/attempt.

Вариант 2: cookie-сессия после email identify.

Плюсы:

- удобнее для прохождения теста на одном устройстве;
- меньше параметров в URL.

Минусы:

- хуже работает, если ученик открыл ссылку на другом устройстве;
- нужна более аккуратная session lifecycle.

Вариант 3: magic link на email.

Плюсы:

- безопаснее для ownership;
- подтверждает доступ к почте.

Минусы:

- усложняет MVP;
- зависит от доставляемости email;
- добавляет лишний шаг ученику.

### Gate D: CE/CT Scale Loading

Вариант 1: seed-файл с таблицей шкалы.

Плюсы:

- самый простой для MVP;
- меньше UI;
- меньше риска в админке.

Минусы:

- нужен разработческий шаг при изменении шкалы.

Рекомендация для MVP: seed-файл или простой admin import без отдельного полноценного UI.

Вариант 2: простой admin CSV/XLSX import для шкалы.

Плюсы:

- админ может обновить шкалу без разработчика;
- соответствует направлению supporting docs.

Минусы:

- добавляет объем к Sprint 7;
- нужно валидировать таблицу и ошибки.

Вариант 3: полноценный UI управления шкалами.

Плюсы:

- удобно в долгосрочной перспективе.

Минусы:

- это P0.5/P1 по объему;
- не нужно для первого запуска, если шкал мало.

## Этапы Работы

### Phase 0: Project Baseline

Статус: частично выполнено.

Codex делает:

- поддерживает структуру проекта;
- держит docs актуальными;
- сверяет любые новые документы с Final MVP Spec v2;
- не добавляет вне-scope функции.

Результат:

- документация и правила разработки готовы;
- supporting docs сохранены в проекте;
- master plan зафиксирован.

Проверка:

- документы читаются;
- source priority зафиксирован в `AGENTS.md`.

### Phase 1: Technical Foundation

Codex делает:

- приводит `prisma/schema.prisma` в соответствие с `database-schema-api-v1.md`;
- настраивает Prisma client;
- настраивает базовые env-переменные;
- добавляет shared response/error format;
- добавляет Zod-схемы для ключевых входных данных;
- добавляет базовый EventLog helper;
- добавляет базовый Email adapter interface без привязки к конкретному сервису;
- добавляет базовую структуру тестов.

Результат:

- схема данных готова для Sprint 1-7;
- проект компилируется;
- есть минимальные unit tests для чистой логики.

Проверка:

- `pnpm typecheck`;
- `pnpm test`;
- `prisma validate`;
- review schema against docs.

Approval needed:

- Gate B до публичных student endpoints;
- Gate C до реальной оплаты.

### Phase 2: Admin Auth And Test CRUD

Codex делает:

- admin login/logout/me;
- hash пароля админа;
- защищенные admin routes;
- Test CRUD;
- publish/hide;
- publish-check;
- soft delete rules;
- basic admin tests list.

Результат:

- админ может создать, редактировать, проверить и опубликовать тест без вопросов.

Проверка:

- unit tests для publish-check;
- ручной smoke flow admin login -> create test -> publish-check -> publish/hide.

Approval needed:

- базовый визуальный стиль или подтверждение нейтрального UI.

### Phase 3: Questions Builder

Codex делает:

- Question CRUD;
- валидацию трех типов вопросов;
- order up/down;
- пересчет `questions_count`;
- пересчет `max_raw_score`;
- preview данных вопроса для админа;
- запрет вне-MVP типов и partial points.

Результат:

- админ может вручную собрать валидный тест.

Проверка:

- unit tests validation;
- test counters after create/update/delete/reorder;
- publish-check blocks invalid questions.

### Phase 4: XLSX/CSV Import

Codex делает:

- download XLSX template;
- download CSV template;
- upload;
- parser XLSX/CSV;
- validation;
- warnings/errors with row numbers;
- preview;
- ImportJob;
- append commit;
- replace commit;
- transaction;
- no partial import.

Результат:

- админ может загрузить вопросы массово и безопасно.

Проверка:

- valid XLSX import;
- valid CSV import;
- file with critical errors is not committed;
- warnings do not block commit;
- replace does not break old snapshot results.

Approval needed:

- желательно дать один реальный XLSX/CSV пример до финальной полировки.

### Phase 5: Public Catalog And Student Entry

Codex делает:

- public catalog;
- public test page;
- email identify;
- access check;
- activation code entry screen;
- pre-start screen;
- service states for no access/expired/used/revoked/payment processing.

Результат:

- ученик видит опубликованный тест, вводит email, понимает нужен ли доступ.

Проверка:

- published tests visible;
- draft/hidden/archived not visible;
- access check returns correct reasons;
- no correct answers are exposed.

Approval needed:

- Gate B must be approved before result/attempt ownership is finalized.

### Phase 6: Payments, Accesses, Codes, Emails

Codex делает:

- PaymentProvider interface;
- provider stub/sandbox adapter;
- create payment;
- webhook;
- idempotency;
- Access creation after success only;
- manual access;
- AccessCode generation and hash storage;
- code activation;
- admin lists for payments/accesses/codes;
- email after payment;
- email after manual access;
- event logs.

Результат:

- ученик получает доступ через оплату, ручную выдачу или код.

Проверка:

- repeated webhook creates one access;
- code cannot be activated twice;
- code raw value is returned once and not stored;
- manual access logs correctly;
- email failure does not break access creation.

Approval needed:

- Gate C before real provider integration;
- final email texts before production.

### Phase 7: Attempt Runtime

Codex делает:

- attempt start transaction;
- FIFO access selection;
- decrement attempts at start;
- snapshot creation;
- started attempt restore on refresh;
- answer save/upsert;
- timer based on server time;
- complete;
- expire;
- block answer edits after completion.

Результат:

- ученик может пройти тест, обновить страницу без потери попытки и завершить тест.

Проверка:

- no access -> cannot start;
- refresh -> no second decrement;
- answers can change before completion;
- answers cannot change after completion;
- expire checks backend time.

### Phase 8: Scoring, CE/CT Scale, Result

Codex делает:

- scoring engine;
- `single_choice`;
- `multiple_choice`;
- `short_text`;
- raw score;
- percent;
- level;
- topic results;
- mistakes;
- recommendations without AI;
- correct answers after completion only;
- ScoringScheme/ScoringScale support;
- scale snapshot;
- scaled score 0-100;
- result page;
- admin attempt details.

Результат:

- ученик получает результат, админ видит детали попытки.

Проверка:

- scoring unit tests for all question types;
- empty answers wrong;
- no partial points;
- old results unchanged after test edit;
- scaled score uses snapshot;
- active attempt never exposes correct answer.

Approval needed:

- Gate D before final CE/CT scoring acceptance.

### Phase 9: QA Hardening

Codex делает:

- e2e happy path;
- e2e import path;
- e2e payment webhook path with stub;
- e2e manual access;
- e2e code activation;
- security checks;
- mobile layout check;
- error/service states;
- event/email logs sanity.

Результат:

- MVP готов к staging/demo.

Проверка:

- full test suite;
- Playwright smoke;
- manual acceptance checklist.

Approval needed:

- Gate E before final launch prep.

### Phase 10: Launch Prep

Codex делает:

- production env checklist;
- seed/admin creation instructions;
- database migration checklist;
- payment webhook checklist;
- email sender checklist;
- smoke test checklist;
- release notes;
- known limitations.

Результат:

- можно открывать первый коммерческий запуск.

Проверка:

- production-like smoke test;
- payment sandbox success/failure;
- email delivery test;
- first real test content reviewed.

Approval needed:

- Gate F.

## Definition Of Done For Every Phase

Каждый phase считается завершенным только если:

- scope сверён с Final MVP Spec v2;
- вне-scope функции не добавлены;
- документация обновлена;
- релевантные тесты или ручные проверки выполнены;
- оставшиеся риски записаны;
- пользователь получил краткий отчет: что сделано, как проверить, что осталось.

## Рабочий Ритм

1. Codex берет следующий phase.
2. Codex проверяет relevant docs.
3. Codex делает изменения.
4. Codex запускает проверки.
5. Codex обновляет docs при необходимости.
6. Codex сообщает результат и конкретный список того, что нужно утвердить.

Если найдено спорное решение, Codex дает 2-3 варианта, плюсы/минусы и рекомендацию.

## Ближайший Следующий Шаг

Начать Phase 1: Technical Foundation.

Первое действие:

- привести `prisma/schema.prisma` к `docs/supporting/database-schema-api-v1.md` и `docs/07-supporting-docs-analysis.md`;
- затем проверить `prisma validate`;
- если локальная среда снова упирается в проблему OneDrive/кириллического пути и `pnpm`, зафиксировать это отдельно и предложить рабочий обход.
