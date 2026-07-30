# Payment Program Source Reconciliation

Дата: 2026-07-30
Base SHA: `1a07bb898556a511197541934f04b6790f7aaff1`
Статус: открытые противоречия перечислены; молчаливых разрешений нет.

## Найденные противоречия

| ID | Источники | Противоречие | Владелец решения | Маршрут | Gate |
|---|---|---|---|---|---|
| `SRC-PAY-01` | Final MVP Spec §30/§63; approved decisions §Payments; Payment UX Contract | A-04 implementation согласовала канонические документы с WEBPAY hosted same-tab target и отложенным ЕРИП; решение ожидает независимого review | Product Owner / Payments | `A-04` | Feature implementation заблокирована до принятия A-04 |
| `SRC-PAY-02` | Final MVP Spec §31; legacy Payment schema/report; audit `SEC-08` | A-04 запретила raw provider payload в целевой модели, но legacy schema/report/runtime ещё требуют отдельного удаления или allowlist sanitizer | Security / Payments | `A-05`, затем `B3-04` | Production `NO-GO` |
| `SRC-PAY-03` | README; E-POS report; WebPay smoke docs | README ещё называет провайдера невыбранным, E-POS report описывает legacy scaffold, а WebPay docs — assumed sandbox adapter | Program governance / Payments | `A-05` | Ни один sandbox document не является merchant-approved protocol |
| `SRC-PAY-04` | Payment UX Contract; текущий commercial checkout | Contract требует verified email/session/recovery, но runtime принимает email для Order без ACC-01A authority | Security / Product | `A-03`, затем `B1-01..B1-05` | Feature считается непроверенной до A-03 |
| `SRC-PAY-05` | Payment UX Contract; ACC-01A specs | Payment contract задаёт UX recovery, ACC-01A — security state machine; границы совместимы, но production email/provider inputs отсутствуют | Security / Product / Operations | `A-03`, `O-04` | Dev/test implementation допустима только после source gate; production запрещена |
| `SRC-PAY-06` | WEBPAY site-requirements PDF; текущие public/legal pages | Внешний документ требует подтверждённые seller, payment, refund, privacy, receipt, BYN, digital-delivery и site-registration данные; фактическое исполнение ещё не доказано | Legal / Merchant / Operations | `A-05`, `E-01`, `O-01..O-03` | `BLOCKED_EXTERNAL`, production `NO-GO` |
| `SRC-PAY-07` | WEBPAY site-requirements PDF; seller/NPD assumption | Допустимость конкретного статуса продавца для онлайн-тестов не подтверждена merchant agreement | Product Owner / Merchant / Legal | `E-01`, `O-01` | Нужен письменный provider/merchant evidence |

## Не являются конфликтами

- Final MVP Spec остаётся главным источником scope; Payment UX Contract не добавляет подписки, пакеты, автоматические возвраты или card-data UI.
- ACC-01A разрешает только bounded dev/test implementation и не активирует production.
- Browser return никогда не является доказательством оплаты; backend/provider verification остаётся источником истины.
- Исторический аудит не может автоматически изменить статус текущего кода; все 35 findings проходят A-03.

## Решения, уже зафиксированные пользователем, но ожидающие A-04

- Target checkout v1: WEBPAY hosted redirect в той же вкладке.
- ЕРИП не показывается в first-launch checkout и остаётся отложенной capability.
- Card inputs, PAN/CVV и embedded bank form запрещены.
- Production остаётся `NO-GO` до merchant, legal, security, sandbox и launch evidence.

Эти решения записаны для traceability, но изменение канонических payment-разделов выполняется только карточкой A-04 и проходит отдельное независимое ревью.
