# Payment Program Handoff

Последнее обновление: 2026-07-30

## Активная карточка

- ID: `A-04`
- Статус: `IN_REVIEW`
- Implementer: текущая goal-сессия, 2026-07-30
- Base SHA: `b40eb78`
- Final SHA: атомарный A-04 commit, содержащий этот handoff; reviewer берёт точный SHA из HEAD
- Next owner: отдельный независимый reviewer
- Production verdict: `NO-GO`

## Выполнено

- Final MVP Spec и approved decisions выбирают WEBPAY hosted same-tab checkout как target v1.
- ЕРИП зафиксирован как отложенная capability и запрещён в first-launch UI.
- `PAY-01A = READY`; `PAY-01B = BLOCKED`.
- Browser return не подтверждает оплату и не создаёт Access.
- Backend/provider verification остаётся единственным источником истины.
- Card inputs, PAN/CVV и embedded bank form запрещены.
- Production и реальные платежи остаются `NO-GO` до внешних и технических gates.
- Legacy E-POS/ЕРИП scaffold не является canonical checkout и должен оставаться отключённым/изолированным.
- Runtime/schema/API не менялись.

## Проверки

- В canonical docs отсутствуют утверждения, что provider не выбран.
- WEBPAY/ЕРИП/PAY-01A/PAY-01B/NO-GO assertions согласованы между Final MVP Spec и approved decisions.
- `SRC-PAY-01` отражает A-04 implementation pending review; `SRC-PAY-03` остаётся маршрутизирован A-05.
- Запрещённые MVP-функции не добавлены.
- `git diff --check` повторяется на final commit.

## Точное продолжение

Reviewer:

1. Читает `AGENTS.md`, Final MVP Spec, approved decisions, board, A-04, source register, reconciliation и этот handoff.
2. Проверяет diff от `b40eb78` до текущего HEAD.
3. Повторяет canonical contradiction scan и `git diff --check`.
4. Проверяет, что provider/runtime не активирован и production остался `NO-GO`.
5. Не исправляет implementation.
6. Создаёт `docs/payment-program/reviews/A-04.md` с `DONE` либо `CHANGES_REQUIRED`.

После `A-04 = DONE` приоритет — A-03 revalidation всех 35 audit findings. A-05 остаётся заблокирована до A-03.

## Правило передачи при заполнении контекста

Если контекст текущего агента приближается к 90%, он создаёт нумерованный `handoff-1.md` с активной целью, полным планом goal mode, текущими SHA/status/evidence, рабочей копией и точным продолжением. Следующий агент обязан продолжить ту же цель и при своём пороге около 90% создать следующий нумерованный handoff, передав это правило дальше.

## Состояние рабочей копии

Unrelated modified/untracked файлы, не принадлежащие payment-program commits:

- `next-env.d.ts`;
- `pnpm-workspace.yaml`;
- `docs/00-current-project-state.md`;
- `.serena/`;
- `tmp/`.

## Незакрытые решения и блокеры

- A-04 требует независимого verdict.
- A-03 ещё не перепроверил 35 findings на текущем HEAD.
- A-05 должен согласовать README, E-POS report и WebPay sandbox docs с launch-control.
- Merchant agreement/protocol/credentials, seller/legal/support/receipt/hosting и production email остаются внешними gates.
- Production остаётся `NO-GO`.
