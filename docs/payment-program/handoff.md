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
| **D-01** | `READY` | `6574f75` | Обновить payment UX documents per `tasks/D-01.md` |

## Последний завершённый шаг

B3 consolidated security review (T-08): PASS (`reviews/B3-security-milestone.md`).
- B3-01..B3-05 все PASS, приняты консолидированным review: 24 критерия, 0 findings.
- Origin/Host/CSRF enforcement (10ff5fa), Durable rate limits (681d8ee), Cache/referrer policy (5656009), Payload sanitization (0c230f7), Analytics producers (6574f75).
- Gates: typecheck/lint clean, 503 tests PASS.
- Следующая READY-карточка: D-01 (обновить payment UX documents).

## Состояние рабочей копии

Clean. B3-02..B3-05 committed.

Unrelated (не коммитить): `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
