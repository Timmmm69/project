# Payment Program Handoff — единая точка входа

2026-08-09 | HEAD: `5656009` | Production: `NO-GO`

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
| **B3-04** | `READY` | `5656009` | `tasks/B3-04.md` — удалить raw provider payload persistence |

## Последний завершённый шаг

B3-03 закоммичен: `5656009` — `feat(payment): prevent cache and referrer leakage`.
- `PAYMENT_RESPONSE_HEADERS` в `api-response.ts` — `Cache-Control: no-store` + `Referrer-Policy: no-referrer` на все `apiSuccess`/`apiFailure`.
- 31 тест в `commercial-response-policy.test.ts`: positive/error headers, все статусы, Retry-After merge, no cacheable headers, no leak в body.
- 483 tests PASS, typecheck/lint clean.
- Recovery модуль уже имеет свои `RECOVERY_RESPONSE_HEADERS`.

## Состояние рабочей копии

Clean. B3-02 committed at `681d8ee`.

Unrelated (не коммитить): `next-env.d.ts`, `pnpm-workspace.yaml`.

## Блокеры

A-07 long-lived `IN_PROGRESS` до QA-02. Merchant/legal/production email — external gates.
