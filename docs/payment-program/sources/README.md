# Payment Program Source Register

Последнее обновление: 2026-07-31

## Иерархия и правило разрешения конфликтов

Источники применяются сверху вниз:

1. `AGENTS.md` — правила работы и запреты проекта.
2. `docs/00-final-mvp-spec-v2.md` — главный источник истины по MVP и scope.
3. `docs/11-approved-decisions-current.md` — утверждённые уточнения, если они не противоречат Final MVP Spec.
4. `docs/payment-program/sources/payment-ux-contract-v1.md` — целевой payment UX/copy/state contract в своей bounded-области.
5. `acc-01a-session-bridge-decision-v1.md` и `acc-01a-recovery-spec-v1.md` — security/session/recovery contract в bounded ACC-01A области.
6. Provider, merchant и legal evidence — обязательные внешние ограничения в соответствующей области, но не разрешение на production activation.
7. `docs/payment-program/sources/payment-core-audit-2026-07-18.md` — только историческое evidence на audited SHA.

Нижестоящий источник может детализировать вышестоящий только внутри заявленной области и только при отсутствии конфликта. Конфликт не разрешается молча: до решения владельца он записывается в `docs/payment-program/source-reconciliation.md` и блокирует зависимую реализацию. История чатов не является источником истины.

## Реестр

| Источник | Владелец | Версия/дата | Статус | Область авторитетности |
|---|---|---|---|---|
| `AGENTS.md` | Project governance / Product Owner | Current repository version | `ACTIVE` | Порядок источников, MVP-запреты, технические invariants, approval gates |
| `docs/00-final-mvp-spec-v2.md` | Product Owner | v2 | `APPROVED / PRIMARY` | Полный MVP scope, роли, flows, сущности, API, acceptance criteria |
| `docs/11-approved-decisions-current.md` | Product Owner | Current; исходная фиксация 2026-07-01 | `ACTIVE OVERLAY` | Утверждённые локальные, security, payment, email и product-решения без изменения основного scope |
| `docs/payment-program/sources/payment-ux-contract-v1.md` | Product Owner / Payments Product Lead | v1.0; 2026-07-18 | `USER-APPROVED TARGET; PROVIDER ACTIVATION BLOCKED` | Checkout hierarchy, WEBPAY handoff/return, payment UX states, copy, recovery UX, accessibility и payment analytics |
| `acc-01a-session-bridge-decision-v1.md` | Security / Architecture owner | v1.0; 2026-07-13 | `APPROVED FOR BOUNDED DEV/TEST` | Verified destination-session bridge; production activation не разрешена |
| `acc-01a-recovery-spec-v1.md` | Security / Product owner | v1.0; 2026-07-13 | `APPROVED FOR BOUNDED DEV/TEST` | OTP lifecycle, recovery state machine, guards, privacy и production fail-closed requirements |
| `C:\Users\novik\Downloads\требования к сайту (87).pdf` | WEBPAY / acquiring requirements owner; application owner отвечает за исполнение | Получено 2026-07-27; SHA-256 `6AF4699F0681EAFE1B7B2AA7C17DDC4560DE9A0422A4E0296727A616810292C7` | `EXTERNAL LEGAL/MERCHANT EVIDENCE; CURRENTNESS REQUIRES PROVIDER CONFIRMATION` | Требования к сайту, продавцу, оплате, безопасности, возвратам, цифровой услуге, BYN-ценам, чеку и оформлению заказа; не определяет API/signature protocol |
| `docs/payment-program/sources/payment-core-audit-2026-07-18.md` | Historical auditor | 2026-07-18; audited SHA `adf23554a1bac5a6f751fa4fc9a80f2bf64371f2` | `HISTORICAL EVIDENCE / NEEDS_REVALIDATION` | Finding inventory и evidence только для audited SHA; не описывает текущую реализацию без A-03 |

## Контроль импортированных и внешних источников

| Репозиторный/внешний файл | Исходный путь | Исходный SHA-256 | Контроль |
|---|---|---|---|
| `docs/payment-program/sources/payment-ux-contract-v1.md` | `C:\Users\novik\Downloads\payment-ux-contract-v1.md` | `557344B6C84DDC8B9F2767F72108A040D5D666A912EC5AF6FE0D6806D39D9DBF` | Exact equal после нормализации только line endings; A-01 re-review пройден |
| `docs/payment-program/sources/payment-core-audit-2026-07-18.md` | `C:\Users\novik\.codex\attachments\8c9b0de7-7486-4666-88ae-705be8bb1a14\pasted-text.txt` | `976AF910B17A76932E6B1B1433C5BF8F27ABFA622605CE9E5D9298CC2A7A7C2C` | Exact equal после нормализации только line endings; A-01 re-review пройден |
| `acc-01a-session-bridge-decision-v1.md` | Предоставленный проектный source в корне рабочей копии | `33A4B2FD5395C6A1DA316F1423F78B056BB08F302E85FCA84E44712915B4ABC7` | Принимается в репозиторий A-02 без изменения текста |
| `acc-01a-recovery-spec-v1.md` | Предоставленный проектный source в корне рабочей копии | `CAA70E5929A39EA4BED164C0C3573FA31474AC411B96F4FEE6810BBB25689090` | Принимается в репозиторий A-02 без изменения текста |
| Внешний WEBPAY PDF | `C:\Users\novik\Downloads\требования к сайту (87).pdf` | `6AF4699F0681EAFE1B7B2AA7C17DDC4560DE9A0422A4E0296727A616810292C7` | Оригинал остаётся внешним evidence; обязательные требования трассируются в A-05/E/O-задачах |

## Канонические производные артефакты

| Артефакт | Владелец | Версия | Статус | Назначение |
|---|---|---|---|---|
| `docs/payment-program/stage-7-launch-control-v1.md` | Product Owner / Payments Program | v1.0 | `CANONICAL / NO-GO` | Единый production gate register, activation rule и rollback |
| `docs/payment-program/webpay-onboarding-dossier-v1.md` | Merchant onboarding owner | v1.0 | `BLOCKED_EXTERNAL` | Реестр merchant/legal/protocol/credential inputs |
| `docs/payment-program/webpay-sandbox-evidence-plan-v1.md` | Payments QA / Merchant integration owner | v1.0 | `BLOCKED_EXTERNAL` | Настоящая sandbox matrix и правила evidence |
| `docs/payment-program/analytics-measurement-plan-v1.md` | Payments Product / Backend Analytics | v1.0 | `CANONICAL DESIGN; IMPLEMENTATION PARTIAL; NO-GO` | Authority, producer boundaries, privacy allowlist и implementation gaps для payment/access analytics |

## Baselines

- Expected main, указанный аудитом: `bf5972a12c85f63893da36fea485d6a2ac36f2a4`.
- Фактический audited `origin/main`: `adf23554a1bac5a6f751fa4fc9a80f2bf64371f2`.
- Baseline при создании доски: `80c6838ce54e8e0768b4264698343e98be7cbaea`.
- Base SHA A-02: `1a07bb898556a511197541934f04b6790f7aaff1`.
- Любой новый чат обязан заново прочитать актуальный HEAD; перечисленные baselines не заменяют проверку.

## Минимальный boot sequence нового чата

1. Прочитать `AGENTS.md`.
2. Прочитать Final MVP Spec и approved decisions.
3. Прочитать этот source register и `docs/payment-program/source-reconciliation.md`.
4. Прочитать `docs/payment-program/board.md`, активную карточку и `handoff.md`.
5. Прочитать только bounded sources активной карточки.
6. Проверить актуальные HEAD и working tree; не считать предыдущий чат источником истины.
