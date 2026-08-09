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
| **C-02** | `READY` | `6574f75` | Реализовать Order/session/redirect handoff per `tasks/C-02.md` |

## Последний завершённый шаг

C-01: реализован public checkout hierarchy.
- Recovery email verification (OTP) перед Order (B1-04 enforcement).
- Checkout UI: product price/one-attempt → constraints → WEBPAY redirect notice → legal checkboxes (2, not preselected) → «Перейти к оплате картой».
- Redirect loader с fallback «Открыть страницу WEBPAY» (10 сек).
- Post-payment: status restore, refresh, «Попробовать оплатить снова» (terminal retry), «Перейти к началу теста» (paid).
- Gates: typecheck/lint clean, 503 tests PASS.
- Следующая READY-карточка: C-02 (Order/session/redirect handoff).

## Состояние рабочей копии

Clean. B3-02..B3-05 committed.

Unrelated (не коммитить): `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
