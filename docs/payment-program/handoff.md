# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `0c230f7` | Production: `NO-GO`

## Протокол для нового агента

**Обязательное чтение:** только этот файл. Остальное — по мере необходимости.

**Команды:** `pnpm typecheck` / `pnpm lint` / `pnpm test` через `cmd /c "pnpm ..."` (PowerShell блокирует скрипты).

**Неприкасаемые файлы:** `next-env.d.ts`, `pnpm-workspace.yaml`, `.serena/`, `docs/00-current-project-state.md`, `tmp/`.

**Hard rules:**
- Один атомарный commit на implementation-карточку.
- Не трогать чужие файлы.
- Не расширять scope без отдельного утверждения.
- Не закрывать production/external gates на mock/sandbox.
- Commit message по шаблону `feat(payment): ...` / `docs(payment): ...`.
- После commit: обновить карточку, board, handoff.

**DONE карточки (Tier 2, ждут consolidated B3 review):**
B1, B2-02..B2-07, B3-01 — смотри `board.md` раздел 4.1 для SHA и review evidence.

## Следующая задача

| Карточка | Статус | Base SHA | Требования |
|---|---|---|---|
| **B3-05** | `READY` | `0c230f7` | `tasks/B3-05.md` — authoritative analytics producers |

## Последний завершённый шаг

B3-04 закоммичен: `0c230f7` — `feat(payment): sanitize provider payload persistence`.
- `payload-sanitizer.ts` — рекурсивный санитайзер forbidden ключей (PAN, CVV, expiry, 3DS, signature, secret, token, raw body/request/response, payment URL, credentials).
- Применён к legacy `payment-service.ts`: `providerPayload`, `providerWebhookPayload`, event_logs.
- Миграция: `UPDATE payments SET provider_payload_json = NULL, provider_webhook_payload_json = NULL`.
- `containsForbiddenKeys()` для runtime privacy scan.
- 16 тестов в `commercial-payload-sanitizer.test.ts`.
- Canonical `redactedPayload` уже allowlisted; analytics защищены `forbidden-payload.ts`.
- Legacy изолирован от canonical WEBPAY checkout.
- 499 tests PASS, typecheck/lint clean.

## Состояние рабочей копии

Clean. B3-02..B3-04 committed.

Unrelated (не коммитить): `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
