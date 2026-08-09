# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `6574f75` | Production: `NO-GO` | Review: `B3-security-milestone` PASS

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

**DONE карточки (Tier 2, review evidence):**
B1, B2-02..B2-07, B3-01..B3-05 — смотри `board.md` раздел 4.1 для SHA и review evidence.
B3 security block принят consolidated review `reviews/B3-security-milestone.md`.

## Следующая задача

| Карточка | Статус | Base SHA | Требования |
|---|---|---|---|---|
| **C-03** | `READY` | `47b1a5e` | Отрисовать все payment return states per `tasks/C-03.md` |

## Последний завершённый шаг

C-02: реализован Order/session/redirect handoff.
- Машина состояний redirect: `idle` → `creating_order` → `creating_session` → `redirecting` / `fallback` / `session_error`.
- Idempotency keys (orderKey, paymentKey, checkoutFlowId) — создаются один раз, передаются в `Idempotency-Key` header.
- Same-tab redirect через `form.submit()`. Fallback через 10 сек с «Открыть страницу WEBPAY» без повторного API-вызова.
- Session error: «Не удалось открыть страницу оплаты» + retry через resolver перед повторной попыткой.
- Provider data не хранится в localStorage (только useRef в памяти).
- Gates: typecheck/lint clean, 503 tests PASS.
- Следующая READY-карточка: C-03 (payment return states).

## Состояние рабочей копии

Clean. B3-02..B3-05 committed.

Unrelated (не коммитить): `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
