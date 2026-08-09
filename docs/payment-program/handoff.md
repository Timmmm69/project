# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `931f7f9` | Production: `NO-GO`

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
| **B3-03** | `READY` | `931f7f9` | `tasks/B3-03.md` — приватный cache/referrer policy |

## Последний завершённый шаг

B3-02 реализован: Work-in-progress на `931f7f9` (не закоммичен).
- Process-memory limiter заменён на PostgreSQL-based (`CommercialRateLimitEvent` + advisory locks).
- Trusted identity: `deriveCommercialClientKey()` через B3-01 trusted proxy policy.
- Namespace: ORDER_CREATE, PAYMENT_SESSION_CREATE, STATUS_REFRESH, CHECKOUT_FLOW, BRUTE_FORCE.
- `Retry-After` в 429 ответах.
- 11 новых unit тестов; lint + typecheck + 452 тестов — PASS.
- Миграция: `20260809082143_add_commercial_rate_limits`.

## После реализации B3-02

1. ~~Заменить process-memory limiter на PostgreSQL-based.~~
2. ~~Trusted client identity через B3-01 trusted proxy policy.~~
3. ~~Разнести по namespace.~~
4. ~~Retry-After в ответах.~~
5. ~~Тесты.~~
6. ~~Обновить карточку, board, handoff.~~
7. Закоммитить с сообщением `feat(payment): persist commercial rate limits and cooldowns`.
8. `docs(payment): accept B3-02 ...` — после commit.

## Состояние рабочей копии

Modified (B3-02 implementation): `prisma/schema.prisma`, `src/lib/api-response.ts`, `src/lib/commercial/rate-limit.ts`, `src/lib/commercial/route-helpers.ts`, `src/app/api/commercial/checkout-flows/route.ts`, `src/app/api/commercial/orders/route.ts`, `src/app/api/commercial/orders/[publicId]/payment-session/route.ts`, `src/app/api/commercial/orders/[publicId]/refresh-status/route.ts`, `tests/unit/commercial-rate-limit.test.ts`, `tests/unit/commercial-order-verified-authority.test.ts`, `tests/unit/commercial-payment-status-projection.test.ts`, `docs/payment-program/board.md`, `docs/payment-program/handoff.md`, `docs/payment-program/tasks/B3-02.md`.

New: `prisma/migrations/20260809082143_add_commercial_rate_limits/`.

Unrelated: `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
