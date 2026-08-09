# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `1269a80` | Production: `NO-GO`

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

Все implementation-карточки DONE (30 из 45):
- A-01..A-06: управление и документация — DONE
- B1-01..B1-05: verified authority и recovery — DONE
- B2-01..B2-07: payment state и восстановление — DONE (consolidated review PASS)
- B3-01..B3-05: security и analytics — DONE (consolidated review PASS)
- D-01: UX documents — DONE
- C-01..C-07: frontend — DONE

Оставшиеся: QA-01 (regression), QA-02 (final gate), D-02/D-03 (Figma), E-01..E-05 (merchant), O-01..O-04 (legal/ops) — см. board.md.

## Следующая задача

| Карточка | Статус | Требования |
|---|---|---|
| **QA-01** | `BACKLOG` | `tasks/QA-01.md` — полный payment regression pass |

**Суть QA-01:**
- Полный Order → WEBPAY redirect → callback → Access → Attempt цикл
- Duplicate click, reload, back, mobile return, callback replay, provider conflict
- Pending/unknown/PWA, terminal retry, recovery
- Отсутствие raw payload/card data/PII в logs, DB, analytics, URLs, referrer
- DB concurrency: exactly one Access, at most one active PaymentAttempt, durable rate limits, resolver read-only
- Миграции с чистой изолированной schema

**Не менять production verdict:** итог остаётся `NO-GO` до QA-02 и закрытия внешних gates.

## Состояние рабочей копии

Unrelated: `next-env.d.ts`, `pnpm-workspace.yaml`, `.serena/`, `docs/00-current-project-state.md`, `tmp/`

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates (E-01..E-05, O-01..O-04).
