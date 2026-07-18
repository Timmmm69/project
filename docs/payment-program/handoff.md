# Payment Program Handoff

Последнее обновление: 2026-07-18

## Активная карточка

- ID: `A-01`
- Статус: `CHANGES_REQUIRED`
- Implementer: требуется новый отдельный implementation pass
- Reviewed implementation SHA: `dfec322fbbfac0a6a7318a103c69a319dbc8f8cb`
- Review report: `docs/payment-program/reviews/A-01.md`
- Production verdict: `NO-GO`

## Результат независимого ревью

- Подтверждены ровно 45 task files и 45 строк реестра; board links, card headings, статусы и зависимости совпадают.
- Сводка статусов до review verdict совпадала с реестром и карточками; после verdict board обновлён на `CHANGES_REQUIRED = 1`, `IN_REVIEW = 0`.
- Все 45 карточек входят в ацикличный dependency graph; неизвестных, self- и cycle dependencies нет.
- Подтверждено полное покрытие ровно 35 audit IDs, 32 UX acceptance criteria и 20 provider dependencies; legal/ops и Figma requirements имеют task owners.
- Source hierarchy, production `NO-GO` и запрет feature implementation до reconciliation сохранены.
- Implementation diff `80c6838ce54e8e0768b4264698343e98be7cbaea..dfec322fbbfac0a6a7318a103c69a319dbc8f8cb` содержит только `docs/payment-program/`; payment/feature-код не менялся.
- High-confidence secret scan по `docs/payment-program/` не обнаружил секретов.
- Обязательное source-equivalence evidence не прошло, поэтому verdict — `CHANGES_REQUIRED`.

## Обязательное исправление

Обе зарегистрированные source copies имеют общий с оригиналом полный normalized prefix, но содержат ровно два лишних LF в конце:

1. `sources/payment-ux-contract-v1.md`: normalized original length `53850`, imported length `53852`; первый diff на позиции `53850`.
2. `sources/payment-core-audit-2026-07-18.md`: normalized original length `28043`, imported length `28045`; первый diff на позиции `28043`.

Новый implementation pass должен:

1. удалить ровно два лишних завершающих LF из каждого импортированного файла, не меняя другой текст;
2. повторно подтвердить raw SHA-256 оригиналов из `sources/README.md`;
3. повторно сравнить обе пары после нормализации `CRLF`/`LF` и получить exact equality;
4. обновить A-01, board и handoff, вернуть `A-01` в `IN_REVIEW` и сделать отдельный атомарный implementation commit;
5. передать исправление новому независимому reviewer.

`A-02` не переводить в `READY`, пока `A-01` не получит `DONE` после повторного review.

## Состояние рабочей копии

Review изменяет только `docs/payment-program/`. Существовавшие до review modified/untracked файлы вне этого каталога не принадлежат A-01 и должны остаться нетронутыми:

- `next-env.d.ts`;
- `pnpm-workspace.yaml`;
- `acc-01a-recovery-spec-v1.md`;
- `acc-01a-session-bridge-decision-v1.md`;
- `docs/00-current-project-state.md`.

## Незакрытые решения/блокеры

- Source equivalence finding A-01 должен быть исправлен и повторно проверен.
- A-04 ещё не разнёс утверждённый WEBPAY/ЕРИП/NO-GO contract по Final MVP Spec и approved decisions.
- Audit findings ещё не перепроверены на актуальном HEAD; это A-03.
- Merchant, legal, support и production email gates остаются внешне заблокированными.
- Ни одна feature-карточка не разрешена к старту до `A-01 = DONE` и source reconciliation.
