# Payment E-POS Preparation Report

Дата: 2026-07-09

> `SUPERSEDED FOR CANONICAL FIRST-LAUNCH CHECKOUT`. Этот документ сохраняется как историческое evidence legacy ExpressPay/E-POS/ЕРИП scaffold. Целевой checkout v1 — WEBPAY hosted same-tab internet acquiring; ЕРИП отложен и не показывается. Legacy account/QR/instructions/raw payload flow нельзя включать как production fallback. Актуальный gate: `docs/payment-program/stage-7-launch-control-v1.md`.

## Что было сделано в legacy scaffold

- Расширена модель `Payment` под Express Pay / E-POS / ЕРИП:
  - provider invoice id;
  - provider account number;
  - payment URL;
  - QR URL / QR payload;
  - payment instructions;
  - provider status;
  - raw provider payload;
  - raw webhook payload;
  - `cancelled_at`;
  - `expired_at`;
  - ручной статус НПД-чека.
- Добавлен статус оплаты `expired`.
- Добавлен provider enum `expresspay_epos`.
- Добавлены env placeholders для Express Pay / E-POS.
- Создан `PaymentProviderAdapter` interface.
- Создан `MockPaymentProvider`.
- Создан `ExpressPayEposProvider` как безопасная adapter-заготовка без выдуманной реальной интеграции.
- Создан общий payment service:
  - backend сам берет сумму из `Test.price`;
  - pending payment не создает `Access`;
  - success payment создает `Access`;
  - repeated success не создает второй `Access`;
  - failed/cancelled/expired не создают `Access`;
  - provider payload сохраняется.
- `POST /api/payments/create` теперь работает через provider abstraction.
- Добавлены dev endpoints:
  - `POST /api/dev/payments/:payment_id/simulate-success`;
  - `POST /api/dev/payments/:payment_id/simulate-failed`.
- Добавлен общий webhook endpoint:
  - `POST /api/payments/webhook/:provider`.
- Старый mock webhook оставлен совместимым, но переведен на общий payment service.
- `GET /api/payments/:payment_id/status` теперь требует student session и не раскрывает чужие платежи.
- Admin payments получили provider поля и ручную отметку НПД-чека:
  - `POST /api/admin/payments/:payment_id/npd-receipt-created`.
- Student UI показывает payment status, provider account, instructions, payment link/QR payload, dev simulate кнопки для mock.
- Исправлен race при быстром выборе нескольких ответов в `multiple_choice`: сохранения теперь идут очередью.

## Как проверить

```bash
pnpm prisma migrate dev
pnpm typecheck
pnpm test
pnpm lint
pnpm build
RUN_E2E_WITH_DB=true pnpm test:e2e
```

На Windows PowerShell:

```powershell
$env:RUN_E2E_WITH_DB='true'
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/russian_tests_mvp?schema=public'
$env:ENABLE_MOCK_PAYMENTS='true'
$env:PAYMENT_PROVIDER='mock'
pnpm test:e2e
```

## Выполненные проверки

- `pnpm prisma migrate dev --name prepare_expresspay_epos_payments` - passed.
- `pnpm typecheck` - passed.
- `pnpm test` - 28 tests passed.
- `pnpm lint` - passed.
- `RUN_E2E_WITH_DB=true pnpm test:e2e` - 1 test passed.
- `pnpm build` - passed.

## Исторический список входов для legacy Express Pay / E-POS

- sandbox или production режим;
- API base URL;
- token;
- service id;
- secret/signature secret;
- notification URL requirements;
- exact webhook payload examples;
- official status mapping from provider docs;
- test payment instructions;
- provider cabinet settings;
- legal/payment page requirements;
- final self-employed payment details.

## Что не сделано специально

- Не реализована реальная Express Pay HTTP-интеграция без официальной документации и credentials.
- Не реализована автоматическая интеграция с НПД-приложением.
- Не добавлены подписки, пакеты тестов, промокоды, автоматические возвраты или CRM.

## Оставшиеся legacy-риски

- `ExpressPayEposProvider` пока является безопасной заготовкой: при выборе provider без credentials он возвращает понятную configuration error.
- Реальную проверку webhook signature нужно сделать строго по официальной документации Express Pay.
- Admin payments UI остается базовым и требует отдельного UX pass.
