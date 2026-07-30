# Launch Readiness Pass Report

Дата: 2026-07-06

> Исторический отчёт. Он не описывает текущий payment launch verdict. Канонический target — WEBPAY hosted same-tab checkout, ЕРИП deferred; production `NO-GO`. См. `docs/payment-program/stage-7-launch-control-v1.md`.

## Что сделано

- Усилена серверная логика завершения попытки:
  - позднее обычное завершение теперь становится `EXPIRED`;
  - `finishedAt` для истекшей попытки фиксируется на времени окончания таймера;
  - попытка принудительного expire до окончания серверного таймера отклоняется.
- Новый старт попытки разрешен только для опубликованного теста.
- Публичный результат ученика теперь уважает настройки теста:
  - `showPercent`;
  - `showCorrectAnswers`;
  - `showTopicResult`;
  - `showRecommendations`.
- Admin API результатов продолжает возвращать полный результат для преподавателя.
- Исправлено сохранение `multiple_choice` при быстрых кликах по нескольким вариантам.
- Исправлено UX-состояние формы доступа: ошибки, информационные сообщения и успех теперь визуально различаются.
- Добавлены unit-тесты launch readiness safeguards.
- Уточнен e2e smoke-test, чтобы проверка текста `Ошибок нет.` была однозначной.
- Установлен Playwright Chromium для локальных e2e-проверок.

## Как проверить

- Открыть сайт: `http://localhost:3000`
- Открыть админку: `http://localhost:3000/admin`
- Запустить проверки:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
RUN_E2E_WITH_DB=true pnpm test:e2e
```

На Windows PowerShell:

```powershell
$env:RUN_E2E_WITH_DB='true'; pnpm test:e2e
```

## Выполненные проверки

- `pnpm typecheck` - passed.
- `pnpm test` - 28 tests passed.
- `pnpm lint` - passed.
- `pnpm build` - passed.
- `RUN_E2E_WITH_DB=true pnpm test:e2e` - 1 test passed.
- `GET http://localhost:3000/` - 200.
- `GET http://localhost:3000/admin` - 200.

## Оставшиеся риски

- Production WEBPAY ещё не подключён; local fake и assumed WEBPAY sandbox flow разрешены только для dev/test и не являются merchant evidence.
- Email ученика пока не подтверждается magic link/code; для платных продаж это остается security/product решением.
- Admin UI остается большим монолитным компонентом и требует будущего разделения по модулям.
- Публичная часть пока не является полноценной продающей страницей.
- Юридические тексты, политика обработки данных и требования платежного провайдера еще не закрыты.

## Следующие решения

- Утвердить следующий этап: product/UX redesign публичного каталога, страницы теста, попытки, результата и admin dashboard.
- До реальных продаж закрыть WEBPAY merchant agreement/protocol/credentials, real sandbox, legal/operations и QA gates из canonical launch-control.
