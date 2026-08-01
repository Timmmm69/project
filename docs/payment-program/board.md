# Payment Program Board

Последнее обновление: **2026-08-01**
Planning/current baseline at board creation: `80c6838ce54e8e0768b4264698343e98be7cbaea`  
Historical audit baseline: `adf23554a1bac5a6f751fa4fc9a80f2bf64371f2`  
Production verdict: **NO-GO**

## 1. Правила источника истины

1. `docs/00-final-mvp-spec-v2.md` и `AGENTS.md` остаются верхним источником истины.
2. Пользователь утвердил Payment UX Contract как целевую payment UX-спецификацию: WEBPAY hosted same-tab redirect; ЕРИП не показывается в first-launch checkout; production остаётся NO-GO.
3. `A-04` принята независимым review и разнесла WEBPAY/ЕРИП/NO-GO решение по каноническим документам.
4. `acc-01a-session-bridge-decision-v1.md` и `acc-01a-recovery-spec-v1.md` авторитетны для bounded ACC-01A implementation.
5. `docs/payment-program/sources/payment-core-audit-2026-07-18.md` — историческое evidence на sibling-ветке `adf23554a1bac5a6f751fa4fc9a80f2bf64371f2`; текущая revalidation находится в `audit-revalidation-2026-07-30.md` и ожидает review A-03.
6. История чата не является источником истины. Новый чат обязан читать репозиторные документы.

## 2. Workflow и права на статусы

| Статус | Значение | Кто переводит дальше |
|---|---|---|
| `NEEDS_REVALIDATION` | Исторический finding требует проверки на текущем SHA | Чат A-03 |
| `BACKLOG` | Определена, но зависимости не закрыты | Program/implementation chat после evidence |
| `READY` | Решения и зависимости закрыты | Implementer при claim |
| `IN_PROGRESS` | Один чат владеет карточкой и записал base SHA | Implementer |
| `IN_REVIEW` | Implementation завершён, evidence и handoff заполнены | Independent/consolidated reviewer либо Tier 3 self-check |
| `CHANGES_REQUIRED` | Review/self-check нашёл обязательные исправления | Новый implementation pass |
| `BLOCKED_EXTERNAL` | Нужен merchant/legal/operational input | Только после authoritative evidence |
| `DONE` | Пройден требуемый risk-based review tier | Reviewer для Tier 1/2; implementer для Tier 3 |
| `SUPERSEDED` | Заменено утверждённым решением с ссылкой | Reviewer/program governance |

Review tier определяется по `reviews/README.md`. Отдельный reviewer обязателен
для крупных и критичных payment/security/migration/launch блоков. Связанные
средние карточки объединяются в consolidated milestone review. Малые безопасные
docs/test/hygiene шаги проходят `SELF_CHECKED` без отдельного чата; их evidence
всё равно включается в ближайший milestone review или QA-02. Reviewer не
исправляет implementation в review pass.

## 3. Сводка

| Статус | Количество |
|---|---:|
| `NEEDS_REVALIDATION` | 0 |
| `BACKLOG` | 13 |
| `READY` | 10 |
| `IN_PROGRESS` | 1 |
| `IN_REVIEW` | 1 |
| `CHANGES_REQUIRED` | 0 |
| `BLOCKED_EXTERNAL` | 10 |
| `DONE` | 10 |
| `SUPERSEDED` | 0 |
| **Всего** | **45** |

Текущий feature milestone: B1-05 — `IN_REVIEW` на accepted baseline `1d9b758`.
Последняя принятая feature-карточка: B1-04 — `DONE` (reviewed SHA `df106dd`).
A-07 остаётся long-lived program-control `IN_PROGRESS`;
production остаётся `NO-GO`.

## 4. Реестр задач

| ID | Поток | Название | Статус | Риск | Зависимости |
|---|---|---|---|---|---|
| [A-01](tasks/A-01.md) | A — Управление и документация | Создать переносимую доску и review protocol | `DONE` | `HIGH` | — |
| [A-02](tasks/A-02.md) | A — Управление и документация | Закрепить источники и их иерархию | `DONE` | `CRITICAL` | `A-01` |
| [A-03](tasks/A-03.md) | A — Управление и документация | Повторно проверить 35 audit findings | `DONE` | `CRITICAL` | `A-02` |
| [A-04](tasks/A-04.md) | A — Управление и документация | Согласовать WEBPAY, ЕРИП и production NO-GO | `DONE` | `CRITICAL` | `A-02` |
| [A-05](tasks/A-05.md) | A — Управление и документация | Создать launch-control и WEBPAY evidence documents | `DONE` | `HIGH` | `A-03`, `A-04` |
| [A-06](tasks/A-06.md) | A — Управление и документация | Сверить analytics measurement plan | `DONE` | `HIGH` | `A-03`, `A-04` |
| [A-07](tasks/A-07.md) | A — Управление и документация | Поддерживать полную traceability | `IN_PROGRESS` | `HIGH` | `A-03` |
| [B1-01](tasks/B1-01.md) | B1 — Verified authority и recovery | Реализовать verified commercial session | `DONE` | `CRITICAL` | `A-03`, `A-04` |
| [B1-02](tasks/B1-02.md) | B1 — Verified authority и recovery | Реализовать ACC-01A recovery backend | `DONE` | `CRITICAL` | `B1-01` |
| [B1-03](tasks/B1-03.md) | B1 — Verified authority и recovery | Реализовать безопасный continuation и destination guards | `DONE` | `CRITICAL` | `B1-01`, `B1-02` |
| [B1-04](tasks/B1-04.md) | B1 — Verified authority и recovery | Требовать verified email до Order | `DONE` | `CRITICAL` | `B1-01`, `B1-03` |
| [B1-05](tasks/B1-05.md) | B1 — Verified authority и recovery | Восстанавливать Existing Order/Access/Attempt/Result | `IN_REVIEW` | `CRITICAL` | `B1-03`, `B1-04` |
| [B2-01](tasks/B2-01.md) | B2 — Payment state и восстановление | Дополнить immutable commercial snapshot | `READY` | `HIGH` | `A-03`, `A-04` |
| [B2-02](tasks/B2-02.md) | B2 — Payment state и восстановление | Добавить payment_status_unknown projection | `READY` | `HIGH` | `A-03` |
| [B2-03](tasks/B2-03.md) | B2 — Payment state и восстановление | Добавить paid_without_access reconciliation | `BACKLOG` | `CRITICAL` | `B2-02`, `B2-06` |
| [B2-04](tasks/B2-04.md) | B2 — Payment state и восстановление | Восстанавливать provider session после crash | `BLOCKED_EXTERNAL` | `HIGH` | `A-03`, `E-02` |
| [B2-05](tasks/B2-05.md) | B2 — Payment state и восстановление | Формализовать terminal retry | `READY` | `HIGH` | `A-03` |
| [B2-06](tasks/B2-06.md) | B2 — Payment state и восстановление | Добавить safe support DTO | `READY` | `HIGH` | `A-03` |
| [B2-07](tasks/B2-07.md) | B2 — Payment state и восстановление | Расширить recovery на pending Order/payment | `BACKLOG` | `HIGH` | `B1-02`, `B1-03`, `B1-05`, `B2-02` |
| [B3-01](tasks/B3-01.md) | B3 — Security и analytics | Усилить Origin/Host/CSRF enforcement | `READY` | `CRITICAL` | `A-03` |
| [B3-02](tasks/B3-02.md) | B3 — Security и analytics | Ввести durable rate limits и cooldown | `READY` | `HIGH` | `A-03` |
| [B3-03](tasks/B3-03.md) | B3 — Security и analytics | Добавить private cache/referrer policy | `READY` | `HIGH` | `A-03` |
| [B3-04](tasks/B3-04.md) | B3 — Security и analytics | Удалить raw provider payload persistence | `READY` | `CRITICAL` | `A-03` |
| [B3-05](tasks/B3-05.md) | B3 — Security и analytics | Добавить authoritative analytics producers | `READY` | `HIGH` | `A-06` |
| [D-01](tasks/D-01.md) | D — UX и Figma | Обновить payment UX documents | `READY` | `HIGH` | `A-04`, `A-05`, `A-06` |
| [D-02](tasks/D-02.md) | D — UX и Figma | Создать payment-only Figma package | `BACKLOG` | `HIGH` | `D-01` |
| [D-03](tasks/D-03.md) | D — UX и Figma | Собрать Figma accessibility evidence | `BACKLOG` | `HIGH` | `D-02` |
| [C-01](tasks/C-01.md) | C — Frontend | Реализовать checkout hierarchy | `BACKLOG` | `HIGH` | `B1-04`, `D-02` |
| [C-02](tasks/C-02.md) | C — Frontend | Реализовать Order/session/redirect handoff | `BACKLOG` | `HIGH` | `B1-05`, `D-02` |
| [C-03](tasks/C-03.md) | C — Frontend | Отрисовать все payment return states | `BACKLOG` | `HIGH` | `B2-02`, `B2-03`, `B2-06`, `D-02` |
| [C-04](tasks/C-04.md) | C — Frontend | Реализовать polling и manual cooldown | `BACKLOG` | `HIGH` | `B2-02`, `B3-02`, `D-02` |
| [C-05](tasks/C-05.md) | C — Frontend | Восстанавливать state после browser/mobile transitions | `BACKLOG` | `HIGH` | `B1-05`, `B2-07`, `D-02` |
| [C-06](tasks/C-06.md) | C — Frontend | Реализовать responsive и accessibility требования | `BACKLOG` | `HIGH` | `D-03`, `C-01`, `C-02`, `C-03`, `C-04`, `C-05` |
| [C-07](tasks/C-07.md) | C — Frontend | Убрать legacy payment UI из canonical checkout | `BACKLOG` | `HIGH` | `A-04`, `C-01` |
| [E-01](tasks/E-01.md) | E — Merchant dependencies | Получить merchant agreement и документацию | `BLOCKED_EXTERNAL` | `CRITICAL` | `A-04` |
| [E-02](tasks/E-02.md) | E — Merchant dependencies | Подтвердить WEBPAY protocol contract | `BLOCKED_EXTERNAL` | `CRITICAL` | `E-01` |
| [E-03](tasks/E-03.md) | E — Merchant dependencies | Заменить assumed sandbox adapter | `BLOCKED_EXTERNAL` | `CRITICAL` | `E-02`, `B2-04` |
| [E-04](tasks/E-04.md) | E — Merchant dependencies | Выполнить настоящую sandbox matrix | `BLOCKED_EXTERNAL` | `CRITICAL` | `E-03` |
| [E-05](tasks/E-05.md) | E — Merchant dependencies | Подтвердить production configuration и rollback | `BLOCKED_EXTERNAL` | `CRITICAL` | `E-04`, `O-01`, `O-02`, `O-03`, `O-04`, `QA-01` |
| [O-01](tasks/O-01.md) | O/QA — Legal, operations и приёмка | Утвердить seller и legal public copy | `BLOCKED_EXTERNAL` | `CRITICAL` | `A-04` |
| [O-02](tasks/O-02.md) | O/QA — Legal, operations и приёмка | Утвердить support channel и runbook | `BLOCKED_EXTERNAL` | `HIGH` | `A-04` |
| [O-03](tasks/O-03.md) | O/QA — Legal, operations и приёмка | Определить tax receipt и manual refund process | `BLOCKED_EXTERNAL` | `HIGH` | `A-04` |
| [O-04](tasks/O-04.md) | O/QA — Legal, operations и приёмка | Настроить production email и recovery QA | `BLOCKED_EXTERNAL` | `CRITICAL` | `B1-02`, `O-01` |
| [QA-01](tasks/QA-01.md) | O/QA — Legal, operations и приёмка | Провести полный payment regression pass | `BACKLOG` | `CRITICAL` | `B1-05`, `B2-01`, `B2-03`, `B2-04`, `B2-05`, `B2-07`, `B3-01`, `B3-02`, `B3-03`, `B3-04`, `B3-05`, `C-01`, `C-02`, `C-03`, `C-04`, `C-05`, `C-06`, `C-07`, `D-03`, `E-04`, `O-04` |
| [QA-02](tasks/QA-02.md) | O/QA — Legal, operations и приёмка | Финальное независимое ревью и production gate | `BACKLOG` | `CRITICAL` | `A-07`, `QA-01`, `E-05` |

### 4.1. Контроль принятых карточек

Последний независимо принятый feature state: B1-01 implementation `4014eee`,
review acceptance commit `7b6521d`. Для Tier 1/2 `DONE` требует review report;
Tier 3 фиксирует `SELF_CHECKED` evidence прямо в карточке.

| Карточка | Accepted implementation/correction SHA | Review evidence | Verdict |
|---|---|---|---|
| A-01 | `82ead81b8b333773bdd923298cae0ca30d8bc847` | `reviews/A-01.md`; `reviews/A-01-rereview-2026-07-30.md` | `DONE` |
| A-02 | `2a54a09` | `reviews/A-02.md` | `DONE` |
| A-03 | `2850e91` | `reviews/A-03.md` | `DONE` |
| A-04 | `2435e8b` | `reviews/A-04.md` | `DONE` |
| A-05 | `c2a1133` | `reviews/A-05.md` | `DONE` |
| A-06 | `96e95f864dc5fc88a46a28ee86cc5ca68d78c07d` | `reviews/A-06.md` | `DONE` |
| B1-01 | `4014eee` | `reviews/B1-01.md` | `DONE` |
| B1-02 | `6cdab4a` | `reviews/B1-02.md` | `DONE` |
| B1-03 | `7b94ab2` | `reviews/B1-03.md` | `DONE` |
| B1-04 | `df106dd` | `reviews/B1-04.md` | `DONE` |

При каждом следующем принятом Tier 1/2 review reviewer обязан атомарно:

1. записать reviewed/final SHA и evidence в карточку и review report;
2. обновить registry status, dependency unlocks и counts;
3. обновить затронутые строки разделов 5–9;
4. проверить, что все `DONE` имеют report, а mock/placeholder не закрыл external gate;
5. записать точное продолжение в `handoff.md`.

Для Tier 3 те же механические обновления выполняет implementer без создания
отдельного reviewer chat.

A-07 остаётся program-control карточкой `IN_PROGRESS` до финальной сверки с
QA-02. Текущий checkpoint не означает, что будущие requirements уже выполнены.

## 5. Audit traceability — 35 IDs

| Audit ID | Карточки/evidence | Обязательство |
|---|---|---|
| ORD-01 | A-03, B2-01, QA-01 | Server price/currency regression |
| ORD-02 | B2-01 | Full immutable snapshot |
| ORD-03 | B1-04, C-01 | Verified email before Order |
| ORD-04 | A-03, B1-04, QA-01 | One Order per checkout flow |
| ORD-05 | B1-05 | Existing pending Order resolver |
| ORD-06 | B1-03, B1-05, C-03 | Existing Access/Attempt/Result; no repurchase |
| PAY-01 | A-03, QA-01 | Separate PaymentAttempt regression |
| PAY-02 | A-03, QA-01 | At most one active attempt |
| PAY-03 | B2-05 | Terminal retry consistency |
| PAY-04 | B2-04, C-02 | Reopen existing provider session |
| PAY-05 | B2-04 | Crash/lost response recovery |
| PAY-06 | C-03, QA-01 | Browser return is not proof |
| PAY-07 | E-01, E-02, E-03, E-04 | Merchant-approved authority |
| ACC-01 | A-03, QA-01 | Atomic paid + exactly-one Access |
| ACC-02 | B2-03, C-03, O-02 | paid_without_access |
| STA-01 | B2-05, C-03, QA-01 | Canonical persisted states |
| STA-02 | B2-02, C-03 | Transient unknown projection |
| STA-03 | B2-02, E-02, E-03 | Authoritative refresh |
| STA-04 | C-04 | 60-second polling |
| STA-05 | B3-02, C-04 | Durable cooldown |
| STA-06 | B2-06, C-03 | Safe public order reference |
| STA-07 | B2-06, O-02, C-03 | Support DTO/panel |
| REC-01 | B1-05, C-05 | Reload restoration |
| REC-02 | C-05 | Back/pageshow/foreground |
| REC-03 | B1-02, B1-03, B2-07 | Verified recovery for payment |
| SEC-01 | B1-03, B1-04, B3-01 | Enumeration resistance and identify-bypass prevention |
| SEC-02 | B3-01, B3-02 | CSRF/client identity/rate limits |
| SEC-03 | B3-03 | Cache/referrer/URL leakage |
| CARD-01 | D-03, C-06, QA-01 | No card-data handling |
| CARD-02 | B3-04 | Provider payload safety |
| ANA-01 | A-06, B3-05 | Canonical event/privacy schemas |
| ANA-02 | B3-05 | Missing producers |
| DOC-01 | A-02, A-05, A-06, D-01, O-01 | Missing canonical documents |
| DOC-02 | A-04, A-05, E-05, QA-02 | Explicit launch gates |
| UI-01 | D-01, D-02, D-03, C-01..C-07 | Exact states/copy/mobile/a11y |

Текущие статусы и evidence всех 35 строк:
`audit-revalidation-2026-07-30.md` (12 `IMPLEMENTED`, 10 `PARTIAL`, 9
`MISSING`, 2 `CONTRADICTED`, 2 `MERCHANT_BLOCKED` на revalidated baseline).
Реализованные строки сохраняются как regression invariants в `QA-01/QA-02`;
ссылка на карточку не означает, что требование уже реализовано.

## 6. Payment UX acceptance traceability — 32 критерия

| ID | Критерий | Карточки |
|---|---|---|
| FLOW-01 | End-to-end path is unambiguous | D-01, C-01, C-02, C-03 |
| FLOW-02 | No card data in our UI | D-03, B3-04, QA-01 |
| FLOW-03 | Figma has no bank-form imitation | D-02, D-03 |
| FLOW-04 | Redirect, not popup | C-02, C-07 |
| FLOW-05 | Return never implies success alone | C-03, QA-01 |
| FLOW-06 | Access is not granted by redirect | QA-01 |
| FLOW-07 | Duplicates do not create second Order/Access | B1-04, B2-04, QA-01 |
| CHK-01 | 10 BYN/one attempt/90d/120m/primary-only/no subscription | B2-01, C-01 |
| CHK-02 | Email verified before Order | B1-04, C-01 |
| CHK-03 | Required checkboxes not preselected | C-01 |
| CHK-04 | Provider handoff explained | C-01, C-02 |
| CHK-05 | Seller/support/legal blocks present | C-01, O-01, O-02 |
| STATE-01 | All seven user-facing payment states | B2-02, B2-03, C-03 |
| STATE-02 | No repeat payment from pending/unknown/PWA | B2-03, C-04 |
| STATE-03 | Terminal retry uses same Order | B2-05, C-03 |
| STATE-04 | Automatic polling capped at 60 seconds | C-04 |
| STATE-05 | Manual refresh creates no finance entities | B2-02, C-04, QA-01 |
| STATE-06 | Reload/Back/mobile/re-entry restore state | B1-05, B2-07, C-05 |
| STATE-07 | Support uses public reference only | B2-06, O-02, C-03 |
| A11Y-01 | No 320px horizontal scroll | D-03, C-06 |
| A11Y-02 | Single CTA remains visible with keyboard/safe-area | D-03, C-06 |
| A11Y-03 | Focus order and return defined | D-03, C-06 |
| A11Y-04 | Accessible polling without announcement spam | D-03, C-04, C-06 |
| A11Y-05 | Field errors and summary linked | C-01, C-06 |
| A11Y-06 | States not color-only | D-03, C-06 |
| A11Y-07 | Reduced motion supported | D-03, C-06 |
| A11Y-08 | 200% zoom supported | D-03, C-06 |
| COPY-01 | Exact section 11 copy in Figma | D-01, D-02 |
| COPY-02 | Provider/logo placeholders never ship | D-02, D-03, QA-02 |
| COPY-03 | No prohibited official/guarantee claims | O-01, D-01, QA-02 |
| COPY-04 | Marketing page is not merchant protocol evidence | E-01, E-02, QA-02 |
| COPY-05 | Real launch remains NO-GO until gates | A-05, E-05, QA-02 |

## 7. Provider dependencies — 20 пунктов

Все строки остаются `BLOCKED_EXTERNAL`: public PDF, local fake provider и
assumed sandbox protocol не являются merchant-approved evidence.

| № | Dependency | Владелец | Карточки | Gate status |
|---:|---|---|---|---|
| 1 | Merchant agreement and eligibility | Merchant onboarding | E-01 | `BLOCKED_EXTERNAL` |
| 2 | Sandbox and production credentials | Merchant onboarding / Release | E-01, E-05 | `BLOCKED_EXTERNAL` |
| 3 | Merchant-specific documentation | Merchant onboarding | E-01 | `BLOCKED_EXTERNAL` |
| 4 | Integration method and endpoints | Merchant integration | E-02 | `BLOCKED_EXTERNAL` |
| 5 | Signature and callback requirements | Merchant integration / Security | E-02 | `BLOCKED_EXTERNAL` |
| 6 | Real sandbox session | Payments QA | E-04 | `BLOCKED_EXTERNAL` |
| 7 | Real callback/signature evidence | Payments QA / Security | E-04 | `BLOCKED_EXTERNAL` |
| 8 | Authenticated status API | Merchant integration / Payments QA | E-02, E-04 | `BLOCKED_EXTERNAL` |
| 9 | Authoritative status mapping | Merchant integration | E-02 | `BLOCKED_EXTERNAL` |
| 10 | Callback retry configuration | Merchant integration / Payments QA | E-02, E-04 | `BLOCKED_EXTERNAL` |
| 11 | Status rate limits | Merchant integration / Security | E-02, B3-02 | `BLOCKED_EXTERNAL` |
| 12 | Session lifecycle and late success | Merchant integration / Payments QA | E-02, E-04 | `BLOCKED_EXTERNAL` |
| 13 | Test card/scenario matrix | Merchant integration / Payments QA | E-02, E-04 | `BLOCKED_EXTERNAL` |
| 14 | Return/cancel behavior | Merchant integration / Payments QA | E-02, E-04 | `BLOCKED_EXTERNAL` |
| 15 | 3-D Secure and mobile behavior | Merchant integration / Payments QA | E-02, E-04 | `BLOCKED_EXTERNAL` |
| 16 | Supported schemes/methods | Merchant integration | E-02 | `BLOCKED_EXTERNAL` |
| 17 | Official logo/brand rules | Merchant integration / Design | E-02, D-02 | `BLOCKED_EXTERNAL` |
| 18 | Branded hosted-page constraints | Merchant integration / Design | E-02, D-02 | `BLOCKED_EXTERNAL` |
| 19 | Embedded-page admissibility if ever considered | Merchant integration; out-of-scope confirmation only | E-02 | `BLOCKED_EXTERNAL` |
| 20 | Production acquiring/settlement | Release / Finance | E-05 | `BLOCKED_EXTERNAL` |

## 8. Legal/operational dependencies

| Dependency | Владелец | Карточки | Gate status |
|---|---|---|---|
| Seller information | Seller / Legal | O-01 | `BLOCKED_EXTERNAL` |
| Legal qualification/NPD eligibility | Seller / Legal / Tax advisor | O-01 | `BLOCKED_EXTERNAL` |
| Final public offer | Legal / Product Owner | O-01 | `BLOCKED_EXTERNAL` |
| Adult/email wording | Legal / Product Owner | O-01 | `BLOCKED_EXTERNAL` |
| Refund policy/manual process | Legal / Operations | O-01, O-03 | `BLOCKED_EXTERNAL` |
| Privacy pages/processor inventory | Legal / Privacy owner | O-01 | `BLOCKED_EXTERNAL` |
| Tax receipt process | Seller / Accounting / Operations | O-03 | `BLOCKED_EXTERNAL` |
| Support email/hours | Support owner | O-02 | `BLOCKED_EXTERNAL` |
| Pending/duplicate/PWA runbook | Support / Payments operations | O-02 | `BLOCKED_EXTERNAL` |
| Production email/recovery QA | Email operations / Security QA | O-04 | `BLOCKED_EXTERNAL` |
| Release/browser evidence | Payments QA / Release owner | QA-01, QA-02 | `BACKLOG` |

## 9. Figma handoff traceability

| Requirement | Владелец | Карточки | Current status |
|---|---|---|---|
| 19 desktop frames: email, verification, review, creation/redirect/fallback, pending, terminal/unknown/PWA, existing entities и recovery | Product Design | D-02 | `BACKLOG` |
| Те же 19 mobile frames на 360 px с одинаковой state semantics | Product Design | D-02 | `BACKLOG` |
| 320 × 568 overflow, CTA, keyboard и safe-area evidence | Accessibility / Frontend QA | D-03, C-06 | `BACKLOG` |
| Components: `PaymentMethodCard`, `CheckoutSummary`, `VerifiedEmailRow`, `RequiredLegalCheckbox`, `ExternalPaymentNotice`, `PaymentStatusPanel` variants, `OrderReference`, `PollingStatus`, `SupportEscalation`, `StickyCheckoutAction` | Product Design | D-02 | `BACKLOG` |
| Loader/reduced-motion и focus/error/a11y annotations | Product Design / Accessibility | D-02, D-03 | `BACKLOG` |
| Exact section 11 copy, source/CTA/prohibited-action/focus annotations на каждом frame | Payment UX / Product Design | D-01, D-02 | `READY / BACKLOG` |
| Existing visual system; no new visual direction | Product Design reviewer | D-01, D-02 | `READY / BACKLOG` |
| No card inputs, embedded bank form, ЕРИП или неподтверждённые provider/card-scheme assets | Product Design / Security reviewer | D-02, D-03 | `BACKLOG` |
| Evidence: Figma link, frame/variant inventory, 1440/360 screenshots, 320 overflow, focus, contrast, placeholder scan, card-field scan и contract comparison | Product Design / Accessibility reviewer | D-03 | `BACKLOG` |

## 10. Изменяемые интерфейсы

- `POST /api/commercial/orders`: email берётся из verified authority, не из недоверенного body.
- Recovery API и verified commercial session: строго по ACC-01A; legacy `student_session` не является fallback.
- Status DTO: безопасные projections `payment_status_unknown`, `paid_without_access`, cooldown и support без sensitive identifiers.
- Commercial snapshot: backfill-safe расширение, используемое при Access grant.
- Provider adapter: остаётся production-disabled до merchant-approved contract/evidence.

## 11. Обязательные program invariants

- Scoring/access/payment truth остаётся backend-only.
- Browser return, CTA или URL parameter никогда не подтверждают оплату.
- Duplicate click/reload/callback/status не создают второй Order/Access.
- Card inputs, PAN/CVV и embedded bank form запрещены.
- Pending/unknown/paid_without_access не допускают повторную оплату.
- Mock/sandbox assumption не закрывает merchant dependency.
- Production остаётся `NO-GO` до `QA-02` и отдельного явного решения.
