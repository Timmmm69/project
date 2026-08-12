# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `13aa274` | Production: `NO-GO`

## Протокол для нового агента

**Обязательное чтение:** только этот файл. Остальное — по мере необходимости.

**Команды:** `pnpm typecheck` / `pnpm lint` / `pnpm test` через `cmd /c "pnpm ..."` (PowerShell блокирует скрипты).

**Неприкасаемые файлы:** `next-env.d.ts`, `pnpm-workspace.yaml`, `.serena/`, `docs/00-current-project-state.md`, `tmp/`.

**Hard rules:**
- Один атомарный commit на implementation-карточку.
- Не трогать чужие файлы.
- Не расширять scope без отдельного утверждения.
- Не закрывать production/external gates на mock/sandbox.
- После commit: обновить карточку, board, handoff.

## Текущий статус

Все implementation-карточки DONE (32 из 45):
- A-01..A-06: управление и документация — DONE
- B1-01..B1-05: verified authority и recovery — DONE
- B2-01..B2-07: payment state и восстановление — DONE (consolidated review PASS)
- B3-01..B3-05: security и analytics — DONE (consolidated review PASS)
- D-01: UX documents — DONE
- C-01..C-07: frontend — DONE
- QA-01: payment regression pass — DONE
- QA-02: final independent review and production gate — DONE

Оставшиеся: D-02/D-03 (Figma), E-01..E-05 (merchant), O-01..O-04 (legal/ops) — см. board.md.

## Следующая задача

| Карточка | Статус | Требования |
|---|---|---|
| **D-02** | `READY` | `tasks/D-02.md` — создать payment-only Figma package |

**Не менять production verdict:** итог остаётся `NO-GO` до закрытия E-01..E-05, O-01..O-04 external gates и повторного QA-02.

**QA-02 evidence:** `reviews/QA-02-final-gate.md` — все 31 implementation-карточка PASS. Production NO-GO: 10 BLOCKED_EXTERNAL, E2E заблокирован Docker, A-07 не финализирован.

## Состояние рабочей копии

Unrelated: `next-env.d.ts`, `pnpm-workspace.yaml`, `.serena/`, `docs/00-current-project-state.md`, `tmp/`

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates (E-01..E-05, O-01..O-04).
