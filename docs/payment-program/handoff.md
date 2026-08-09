# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `6574f75` | Production: `NO-GO`

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
B1, B2-02..B2-07, B3-01..B3-05 — смотри `board.md` раздел 4.1 для SHA и review evidence.

## Следующая задача

| Карточка | Статус | Base SHA | Требования |
|---|---|---|---|
| **B3 consolidated review (T-08)** | `READY` | `6574f75` | Consolidated security review B3-01..B3-05 per `reviews/README.md` |

## Последний завершённый шаг

B3-05 закоммичен: `6574f75` — `feat(payment): emit authoritative payment analytics`.
- 6 новых event schemas: `payment_session_created`, `payment_pending`, `payment_failed`, `payment_cancelled`, `payment_expired`, `payment_return_viewed`.
- Producers только после commit: `ensurePaymentSessionCreatedAnalytics` + `ensurePaymentPendingAnalytics` (attempt creation), `ensurePaymentTerminalAnalytics` (notification processing), `ensurePaymentReturnViewedAnalytics` (UX-only из status route).
- `safelyWriteAnalyticsEvent` гарантирует, что ошибка analytics не откатывает transaction.
- `skipDuplicates` предотвращает duplicate/replay events.
- Browser CTA/return не создаёт `payment_confirmed`.
- 503 tests PASS, typecheck/lint clean.

## Состояние рабочей копии

Clean. B3-02..B3-05 committed.

Unrelated (не коммитить): `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
