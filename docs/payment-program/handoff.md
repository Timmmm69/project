# Payment Program Handoff

Последнее обновление: 2026-07-30

## Активная карточка

- Следующий приоритет: `A-04`
- Статус: `READY`
- Параллельно доступна: `A-03 = READY`
- Production verdict: `NO-GO`

## Последний завершённый шаг

- A-02 source hierarchy/reconciliation implementation: `13cccb4`.
- Независимый review: `CHANGES_REQUIRED` только по `LOW A02-DOC-HYGIENE-01`.
- Correction implementation: `2a54a09`.
- Correction re-review: `DONE`; оба `git diff --check` прошли, новых findings нет.
- A-02 переведена в `DONE`; A-03 и A-04 открыты как `READY`.

## Точное продолжение A-04

1. Записать claim и base SHA.
2. Точечно обновить Final MVP Spec и approved decisions:
   - WEBPAY hosted same-tab redirect — target checkout v1;
   - ЕРИП — отложенная capability, отсутствует в first-launch UI;
   - backend/provider verification — единственный источник истины;
   - card inputs/PAN/CVV/embedded form запрещены;
   - `PAY-01A = READY`, `PAY-01B = BLOCKED`;
   - production и реальные платежи остаются `NO-GO`.
3. Не активировать provider и не менять runtime-код.
4. Обновить conflict register, board, A-04 evidence и handoff.
5. Передать отдельному reviewer.

## Параллельный следующий шаг A-03

Повторно проверить все 35 audit findings на актуальном HEAD и записать evidence/status без предположения, что historical audit остаётся текущим.

## Состояние рабочей копии

Unrelated modified/untracked файлы, не принадлежащие payment-program commits:

- `next-env.d.ts`;
- `pnpm-workspace.yaml`;
- `docs/00-current-project-state.md`;
- `.serena/`;
- `tmp/`.

## Незакрытые решения и блокеры

- A-04 ещё не разнёс WEBPAY/ЕРИП/NO-GO decision по каноническим payment-разделам.
- A-03 ещё не перепроверил 35 findings на текущем HEAD.
- Merchant agreement/protocol/credentials, seller/legal/support/receipt/hosting и production email остаются внешними gates.
- Production остаётся `NO-GO`.
