# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `e087355` | Production: `NO-GO`

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
| **B3-02** | `READY` | `e087355` | `tasks/B3-02.md` — durable rate limits и cooldown |

### T-04 / B3-02: durable rate limits и cooldown

**Суть:** заменить process-memory limiter на PostgreSQL-based durable store. Без Redis.

**Namespace для лимитов:** recovery challenge, recovery OTP, order creation, payment-session creation, status refresh, recovery resolver read.

**Ключевые требования:**
- Client identity через B3-01 trusted proxy policy (`TRUSTED_PROXY`, `APP_URL`).
- Raw `x-forwarded-for` не authority.
- Каждая блокировка → `429` + корректный `Retry-After`.
- DTO cooldown от server-side truth, не от frontend.
- Restart / несколько instances не сбрасывают лимиты.
- Shared network ≠ объединение разных verified identities.

**Тесты:** два instance → один лимит, restart persistence, concurrent bypass, shared IP + разные verified users, 429 + Retry-After, раздельные квоты.

**Commit:** `feat(payment): persist commercial rate limits and cooldowns`

## После реализации

1. Обновить карточку B3-02 (статус, SHA, evidence).
2. Обновить `board.md` (строка B3-02 → `DONE`, counts, accepted table).
3. Обновить этот `handoff.md` (активная карточка → B3-03, последний шаг).
4. `docs(payment): accept B3-02 ...`

## Состояние рабочей копии

Unrelated: `next-env.d.ts`, `pnpm-workspace.yaml`, `.serena/`, `docs/00-current-project-state.md`, `tmp/`

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
