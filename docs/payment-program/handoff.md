# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `681d8ee` | Production: `NO-GO`

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
| **B3-03** | `READY` | `681d8ee` | `tasks/B3-03.md` — приватный cache/referrer policy |

## Последний завершённый шаг

B3-02 закоммичен: `681d8ee` — `feat(payment): persist commercial rate limits and cooldowns`.
- PostgreSQL-based `CommercialRateLimitEvent` + advisory locks.
- `deriveCommercialClientKey()` через trusted proxy.
- Namespace: ORDER_CREATE, PAYMENT_SESSION_CREATE, STATUS_REFRESH, CHECKOUT_FLOW, BRUTE_FORCE.
- `Retry-After` в 429 ответах.
- 11 unit тестов; lint + typecheck + 452 тестов — PASS.
- Миграция: `20260809082143_add_commercial_rate_limits`.

## Состояние рабочей копии

Clean. B3-02 committed at `681d8ee`.

Unrelated (не коммитить): `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
