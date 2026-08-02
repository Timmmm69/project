# Payment Program Handoff

Последнее обновление: 2026-08-02

## Активная карточка

- Feature-карточка: `B2-06`
- Статус B2-06: `IN_REVIEW` до consolidated B2 milestone review
- B2-06 base SHA: `a86d4f64573c7d7342bab4fbf42e11e0694d6c74`
- Статус B2-02: `IN_REVIEW` до consolidated B2 milestone review
- B2-02 base SHA: `e590b3cc0abfaf1c5c2e4870918d88caac2362dd`
- Статус B2-01: `DONE`
- B2-01 base SHA: `7068ad5`
- B2-01 implementation/reviewed SHA: `20adce9`
- Принятая B1-05: `DONE`, reviewed SHA `4a6a013` от base `1d9b758`
- Принятая B1-04: `DONE`, reviewed SHA `df106dd` от base `dcf58d3`
- Принятая B1-03: `DONE`, reviewed SHA `7b94ab2` от base `f38ddec`
- Принятая B1-02: `DONE`, reviewed SHA `6cdab4a` от base `8d682b7`
- Принятая зависимость B1-01: `DONE`, reviewed SHA `4014eee`
- Program-control A-07: `IN_PROGRESS`, traceability обновлена через B1-03
- Production verdict: `NO-GO`

## Последний завершённый шаг

- B2-06 добавляет strict safe status/support DTO: opaque public reference,
  category, safe timestamps/cooldown и allowlisted actions; internal/provider/
  merchant IDs, email, payload, secrets, raw URLs/errors исключены.
- DTO/unknown regression 12/12 PASS; full unit regression 416 PASS,
  139 DB-gated skipped; lint/typecheck PASS.
- B2-02 реализует transient `payment_status_unknown` без DB enum: timeout,
  malformed/untrusted и unavailable provider outcome сохраняют последний
  confirmed business state и запрещают retry/Access.
- Route regression 6/6 PASS; full unit regression 410 PASS, 139 DB-gated
  skipped; lint/typecheck PASS.
- B2-01 принят независимым consolidated review: `DONE` для implementation
  `20adce9` от accepted base `7068ad5`.
- Order snapshot дополнен attempts/start-window/duration/retention/exam/display;
  Access grant и existing entitlement recovery переведены с mutable Product на
  immutable Order truth.
- Совместимость проверена реальным old Order на isolated 14→15 migration;
  snapshot backfill PASS, temporary `b201_ci` schema удалена.
- Lint/typecheck — PASS; unit resolver 56/56; full regression 404 PASS;
  commercial DB regression 15/15 PASS, включая Product mutation до callback.

## Точное продолжение

1. Сделать атомарный implementation commit B2-06 от `a86d4f6`.
2. Claim B2-03 от нового HEAD и реализовать paid_without_access reconciliation.
3. B2-02/B2-06 оставить `IN_REVIEW` до единого consolidated B2 review;
   production сохранить `NO-GO`.

## Другие READY-карточки

`B2-02`, `B2-05`, `B2-06`, `B3-01`, `B3-02`, `B3-03`, `B3-04`.

## Newly READY после A-06

`B3-05`, `D-01`.

## Правило передачи при заполнении контекста

При приближении контекста к 90% создать `handoff-2.md` с полной целью, plan goal mode, SHA/status/evidence и точным продолжением. Следующий агент передаёт это правило дальше через `handoff-3.md` и последующие номера.

## Состояние рабочей копии

Unrelated modified/untracked файлы:

- `next-env.d.ts`;
- `pnpm-workspace.yaml`;
- `docs/00-current-project-state.md`;
- `.serena/`;
- `tmp/`.

## Незакрытые решения и блокеры

- A-07 traceability остаётся long-lived `IN_PROGRESS` до QA-02; checkpoint
  2026-07-31 заполнен.
- Merchant agreement/protocol/credentials, seller/legal/support/receipt/hosting и production email остаются external gates.
- Current main содержит принятый B2-01 immutable snapshot milestone
  (`20adce9`; `reviews/B2-01.md`).
- Production остаётся `NO-GO`.
