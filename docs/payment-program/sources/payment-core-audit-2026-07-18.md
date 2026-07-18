Аудит завершён: платёжное ядро достаточно сильное по идемпотентности и concurrency, но Payment UX Contract v1 реализован лишь частично. Критические пробелы — подтверждение email до Order, восстановление существующего Order, `payment_status_unknown`, `paid_without_access`, повторный вход после завершённого теста и merchant-approved WEBPAY protocol.

Все координаты ниже относятся к audited SHA, а не к локальному `HEAD`.

## 1. Baseline

- Ожидаемый `main`: `bf5972a12c85f63893da36fea485d6a2ac36f2a4`.
- Фактический audited `origin/main`: `adf23554a1bac5a6f751fa4fc9a80f2bf64371f2`.
- Новый коммит: `adf2355 INF-01C: Add migration compatibility boundary`.
- Аудит выполнялся на изолированной копии `origin/main`.
- Локальный `HEAD` и существующие modified/untracked файлы не переключались и не изменялись.

## 2. Payment architecture summary

В репозитории одновременно существуют два платёжных слоя:

1. Канонический для целевого commercial checkout:

   `CommercialCheckoutFlow → CommercialOrder → CommercialPaymentAttempt → CommercialPaymentEvent → Access`

   Он содержит server-side `10 BYN`, product/order snapshot, opaque public ID, hashed order token, отдельные payment attempts, row locks, частичные уникальные индексы, authoritative-status обработку и exactly-one Access.

2. Legacy generic payment:

   `Payment → PaymentProviderAdapter → Access`

   Он сохраняет invoice/account/QR/instructions/raw provider payload и содержит ExpressPay/E‑POS/ЕРИП scaffold. Для нового WEBPAY checkout он не должен считаться каноническим.

Сильная сторона commercial слоя: браузерный return не подтверждает оплату; `PAID` и Access фиксируются в одной транзакции только после provider verification. Слабая сторона: конкретный `WebPaySandboxProvider` уже предполагает `wsb_*`, MD5 и status endpoint без merchant-specific подтверждения.

## 3. Backend gap matrix

| ID | Contract requirement | Current implementation | Evidence | Status | Risk | Depends on Figma | Depends on merchant docs | Recommended action |
|---|---|---|---|---|---|---|---|---|
| ORD-01 | Backend price `10 BYN` | Константы `1000/BYN`; product конфигурация проверяется сервером | `src/lib/commercial/config.ts:1-3`; `commercial-service.ts:297-315,423-432`; test `commercial-checkout.spec.ts:379-396` | IMPLEMENTED | LOW | No | No | Сохранить |
| ORD-02 | Полный product snapshot | Order хранит test/name/price/currency/legal, но не attempt limit, 90-day window, retention и exam mode; Access использует текущий Product | `prisma/schema.prisma:570-601`; `commercial-service.ts:475-494,865-878` | PARTIAL | HIGH | No | No | Снапшотить все купленные условия и использовать snapshot при Access grant |
| ORD-03 | Email подтверждён до Order | Order создаётся по введённой строке email; verified session не требуется | `orders/route.ts:9-29`; `commercial-service.ts:390-495` | MISSING | CRITICAL | No | No | Require verified-email authority before Order |
| ORD-04 | Один Order на `checkout_flow_id` | One-to-one relation, unique index, idempotent same-flow replay | `schema.prisma:555-587`; migration `20260712160000...:1-30`; `commercial-service.ts:337-387,443-464` | IMPLEMENTED | LOW | No | No | Сохранить |
| ORD-05 | Existing pending Order resolver | Другой flow для того же email получает только `ORDER_ALREADY_PENDING`, без current Order/reference/token | `commercial-service.ts:360-369,467-472,524-525`; test `commercial-checkout.spec.ts:404-410` | PARTIAL | HIGH | Yes | No | Возвращать безопасный resolver result после verified email |
| ORD-06 | Existing Access/Result, без новой покупки | Учитываются active Attempt и unused Access; completed Result намеренно разрешает новый Order | `commercial-service.ts:266-289`; test `commercial-checkout.spec.ts:445-466` | CONTRADICTED | HIGH | Yes | No | Добавить `VIEW_RESULT`, запретить repurchase до resolver decision |
| PAY-01 | Отдельный PaymentAttempt/provider/reference/idempotency | Сущность и ограничения существуют | `schema.prisma:604-632`; migration `20260711000000...:67-130` | IMPLEMENTED | LOW | No | No | Сохранить |
| PAY-02 | Не более одной active attempt | Partial unique index и row lock | migration `20260711120000...:1-9`; `commercial-service.ts:567-627`; test `commercial-concurrency.spec.ts:124-138` | IMPLEMENTED | LOW | No | No | Сохранить |
| PAY-03 | Terminal retry в том же Order | Создаётся новая attempt, но `state-machine.ts` объявляет Order terminal, тогда как service переводит его обратно в `PENDING` | `state-machine.ts:3-39`; `commercial-service.ts:597-614`; test `commercial-concurrency.spec.ts:281-295` | PARTIAL | MEDIUM | No | No | Формализовать aggregate transition terminal→pending через new attempt |
| PAY-04 | Повторно открыть existing provider session | Работает, если `paymentUrl/providerFields` уже сохранены | `commercial-service.ts:578-595,622-635` | IMPLEMENTED | LOW | Yes | Yes | Использовать existing session |
| PAY-05 | Crash/lost response вокруг session creation | Если provider создал session, но процесс завершился до local finalize, остаётся active attempt без fields, которую нельзя восстановить | `commercial-service.ts:599-617,638-692` | MISSING | HIGH | No | Yes | Добавить recoverable session-creation state/reconciliation |
| PAY-06 | Browser return не является payment proof | Return только восстанавливает локальный Order; callback инициирует server status verification | `commercial-checkout-form.tsx:51-67`; `payments/webpay/notify/route.ts:6-68`; test `commercial-security.test.ts:108-141` | IMPLEMENTED | LOW | No | Yes | Сохранить |
| PAY-07 | Authoritative WEBPAY status | HTTPS status response считается authoritative по полноте полей, но без merchant-approved auth/signature contract | `webpay-sandbox-provider.ts:127-172`; test `commercial-security.test.ts:143-160` | MERCHANT_BLOCKED | CRITICAL | No | Yes | Не активировать; заменить после merchant docs/sandbox evidence |
| ACC-01 | `PAID` и exactly-one Access | Order, attempt и Access меняются в одной транзакции; уникальные FK; replay no-op | `commercial-service.ts:736-911`; `schema.prisma:484-515`; tests `commercial-checkout.spec.ts:379-443`, `commercial-concurrency.spec.ts:613` | IMPLEMENTED | LOW | No | No | Сохранить |
| ACC-02 | `paid_without_access` | Recovery распознаёт аномалию только как `support_required`; status API возвращает `paid/none/NONE`; reconciliation отсутствует | `state-resolver.ts:330-372`; `commercial-service.ts:960-985`; test `recovery-state-resolver.test.ts:506-529` | PARTIAL | HIGH | Yes | No | Derived state + reconciliation + support threshold |
| STA-01 | pending/paid/failed/cancelled/expired | Все пять статусов существуют в Order и PaymentAttempt | `schema.prisma:118-144`; `state-machine.ts:3-30` | IMPLEMENTED | LOW | Yes | No | Не добавлять новые DB enum без необходимости |
| STA-02 | `payment_status_unknown` | Commercial enum/projection отсутствует; неподтверждённый status остаётся прежним или rejected | `providers/types.ts:3-21`; `webpay-sandbox-provider.ts:46-55`; `commercial-service.ts:837-839` | MISSING | HIGH | Yes | Yes | Добавить transient API projection, не обязательно DB enum |
| STA-03 | Status refresh | Cookie-authorized POST выполняет server-to-server fetch | `refresh-status/route.ts:11-40` | PARTIAL | HIGH | Yes | Yes | Сохранить API shape, заменить provider verification |
| STA-04 | 60-second auto polling | GET/POST можно опрашивать, но frontend polling отсутствует | `status/route.ts:9-18`; `commercial-checkout-form.tsx:51-67,145-155` | PARTIAL | MEDIUM | Yes | No | Определить polling contract после Figma |
| STA-05 | Manual refresh cooldown | In-memory `10/min`, без `Retry-After`, distributed enforcement или UI cooldown data | `commercial/rate-limit.ts:1-19`; `refresh-status/route.ts:14-16` | PARTIAL | MEDIUM | Yes | No | Persistent/trusted limiter и cooldown response |
| STA-06 | Safe `orderReference` | `CommercialOrder.publicId` opaque; доступ дополнительно защищён hashed HttpOnly token | `schema.prisma:570-588`; `security.ts:16-61`; `order-token.ts:5-22` | IMPLEMENTED | LOW | Yes | No | Отображать только publicId, не DB UUID/merchant ref |
| STA-07 | Support escalation data | Есть support email config, но нет status timestamps, safe support payload и отображения reference | `config.ts:10-19`; `commercial-checkout-form.tsx:216` | MISSING | MEDIUM | Yes | No | Добавить safe support DTO |
| REC-01 | Reload restoration | Return URL с `commercialOrder` + cookie восстанавливает status; reload/Back до provider return теряет in-memory order key/context | `commercial-service.ts:640-650`; `commercial-checkout-form.tsx:46-49,64-67` | PARTIAL | HIGH | Yes | No | Resolver через verified first-party session |
| REC-02 | Browser Back/mobile foreground | Нет `pageshow`, `visibilitychange`, focus или Back handlers | `commercial-checkout-form.tsx:1-225` | FRONTEND_ONLY | MEDIUM | Yes | No | Реализовать после утверждённых frames |
| REC-03 | Verified-email recovery | OTP recovery восстанавливает Access/Attempt/Result, но pending Order превращается в `support_required` | `state-resolver.ts:27-43,305-396`; test `recovery-state-resolver.test.ts:549-570` | PARTIAL | HIGH | Yes | No | Расширить recovery authority на current Order/payment |
| SEC-01 | Enumeration resistance | Order detail защищён token, но Order creation до email verification раскрывает `EXISTING_ACCESS`/`ORDER_ALREADY_PENDING` | `commercial-service.ts:451-472,515-525`; `route-helpers.ts:4-13` | CONTRADICTED | CRITICAL | No | No | Verified email gate + non-enumerating pre-verification response |
| SEC-02 | CSRF/rate limits | Same-origin helper разрешает отсутствующий Origin; rate limit доверяет raw `x-forwarded-for` и хранится в process memory | `route-helpers.ts:29-34`; commercial routes `:8-16`; `rate-limit.ts:1-19` | PARTIAL | HIGH | No | No | Strict Origin/Host, trusted proxy identity, durable limiter |
| SEC-03 | Cache/referrer/URL leakage | Commercial responses/page не задают `no-store/no-referrer`; return URL содержит public order reference | `api-response.ts:21-40`; `commercial-service.ts:640-650`; policy присутствует только в recovery `http-response.ts:3-40` | MISSING | MEDIUM | No | No | Private headers на payment pages/routes |
| CARD-01 | No card-data handling | Реальных PAN/CVV/cardholder inputs/columns нет; analytics scanner запрещает их | `analytics/privacy-scan.ts:138-160,250-267`; test `analytics-privacy-scan.test.ts:175-181` | IMPLEMENTED | LOW | Yes | Yes | Сохранить hosted-page boundary |
| CARD-02 | Provider payload safety | Commercial callback сохраняет hash + allowlist, но legacy Payment сохраняет raw create/webhook payload | `commercial/security.ts:64-70`; `schema.prisma:440-457`; `payments/payment-service.ts:31-42,206-225,273-279` | PARTIAL | HIGH | No | Yes | Запретить raw payload persistence или ввести mandatory sanitizer |
| ANA-01 | Canonical event/privacy schemas | Имена и privacy enforcement определены; email/hash/card/provider refs запрещены | `analytics/event-contract.ts:202-333`; `privacy-scan.ts:38-46,132-160` | IMPLEMENTED | LOW | No | No | Сохранить naming |
| ANA-02 | Payment event callsites | Есть checkout/order, payment confirmed, access granted, validation failure; остальные существуют только в registry | `commercial-service.ts:59-170`; отсутствие callsites подтверждено для session/return/pending/terminal/PWA | PARTIAL | HIGH | Partly | No | Добавить authoritative producers, не менять naming |
| DOC-01 | Required launch/UX/analytics documents | Все девять обязательных имен отсутствуют в audited `main` | Repository inventory | MISSING | HIGH | Partly | Partly | Отдельная documentation reconciliation task |
| DOC-02 | Explicit gates | Production code disabled и docs говорят о sandbox/mock, но нет единого `PAY-01A/PAY-01B/NO-GO` launch control | `commercial/config.ts:22-47`; `docs/26...:16-18`; `README.md:9,103-109` | PARTIAL | HIGH | No | Yes | Зафиксировать gates в canonical launch document |
| UI-01 | Exact WEBPAY copy/19 states/mobile/a11y | Текущий UI — “Тестовая оплата”, ручной refresh, без required state package | `commercial-checkout-form.tsx:190-223` | FRONTEND_ONLY | MEDIUM | Yes | Partly | Отдельные Figma и frontend tasks |

## 4. Payment state findings

| Contract state/capability | Backend mapping and API | Transitions and truth | Tests/gap |
|---|---|---|---|
| `payment_pending` | Order/attempt `PENDING`; status + refresh routes | Provider server truth; → paid/failed/cancelled/expired | Core tested; Figma required |
| `payment_paid` | `PAID/PAID` + Access | Terminal; browser cannot create it | Replay/concurrency tested |
| `payment_failed` | `FAILED/FAILED` | Terminal attempt; new attempt may reset aggregate Order to pending | Failed retry tested; state-machine alignment missing |
| `payment_cancelled` | `CANCELLED/CANCELLED` | Same intended terminal retry | Transition unit-tested; dedicated retry test missing |
| `payment_expired` | `EXPIRED/EXPIRED` | Same intended terminal retry | Transition unit-tested; dedicated retry test missing |
| `payment_status_unknown` | Нет commercial mapping | Unknown response rejected/keeps old state | Backend projection and tests missing |
| `paid_without_access` | Derived `PAID + no Access`; recovery → `support_required` | Нет reconciliation | Detection test exists; explicit API/analytics/resolution tests missing |
| `repeat_entry_after_payment` | status/claim routes и recovery | Access/active/result may resolve, но Order creation allows repurchase after completed result | Existing test explicitly expects repurchase |
| Existing Order | Same `checkout_flow_id` returns same Order; other flow gets 409 | New Order blocked while open | Current Order recovery missing |
| Existing Access | Pre-order lookup sees active Attempt/unused Access | Completed Result ignored; lookup happens before email ownership proof | Critical backend change |
| Terminal retry | New PaymentAttempt in same Order | Actual Order terminal→pending not represented in transition table | Failed case tested |
| Status refresh | Token-protected POST | Server-to-server provider query | Real WEBPAY semantics merchant-blocked |
| Automatic polling | API primitives exist | No 60-second client session | Frontend tests missing |
| Manual cooldown | 10 calls/minute in memory | No explicit cooldown metadata | Backend hardening and frontend tests missing |
| Support escalation | Только configured support email | Нет safe support DTO/reference panel | Backend + Figma |
| Safe `orderReference` | Opaque `publicId` | DB UUID/token/provider ref не нужны пользователю | Backend identifier implemented |
| Reload | Return URL + HttpOnly token | Работает после return, не гарантирован до него | Automated reload/Back evidence missing |
| Browser Back | Специальной логики нет | Зависит от bfcache | Frontend + resolver gap |
| Mobile foreground | Специальной логики нет | Status не обновляется автоматически | Frontend gap |
| Verified-email recovery | OTP recovery session | Access/Attempt/Result восстанавливаются; pending payment — нет | Extensive recovery tests; pending resolver missing |

## 5. ERIP inventory

| Location | Finding | Classification |
|---|---|---|
| `docs/00-final-mvp-spec-v2.md:757-781` | MVP перечисляет карту и ЕРИП, provider не выбран | Требует продуктового/document reconciliation: сохранить как higher-level capability, но не показывать в v1 checkout |
| `docs/02-architecture.md:35`, `docs/06-risks-open-decisions.md:13`, `docs/07-supporting-docs-analysis.md:260`, `docs/11-approved-decisions-current.md:56-62` | Provider всё ещё “не выбран” | Заменить новым решением WEBPAY + merchant-blocked gate |
| `prisma/schema.prisma:97-104`; migrations `20260701163000...:29`, `20260709120000...:2` | ERIP/ExpressPay enum values | Оставить как historical/out-of-scope provider option; не выводить в canonical checkout |
| `src/lib/payments/providers/index.ts:12-24`; `payments/webhook/[provider]/route.ts:15-23` | ERIP alias ведёт в ExpressPay/E‑POS scaffold | Изолировать от v1 public checkout; оставить только feature-off scaffold либо удалить отдельной задачей |
| `src/app/(public)/tests/[slug]/test-access-form.tsx:361-369` | Account/instructions/QR и link в новой вкладке | Legacy UI; не показывать в canonical WEBPAY checkout |
| `docs/22-payment-epos-preparation-report.md:1-42` | E‑POS/ЕРИП подготовка и raw payload | Оставить как historical report с superseded annotation |
| Supporting docs | Старые ЕРИП/provider-neutral требования | Historical/reference, не использовать как current checkout contract |
| Screenshots/fixtures | ERIP-specific screenshot или active commercial fixture не найден | NOT_APPLICABLE |
| Старый CTA | `Перейти к оплате` и generic payment copy | Заменить в Figma/frontend на explicit WEBPAY redirect copy |

## 6. Card-data boundary

Подтверждено:

- Ни frontend, ни Prisma schema не содержат card-number, PAN, expiry, CVV/CVC или cardholder fields.
- Commercial frontend создаёт только hidden provider handoff fields; карточные данные пользователь там не вводит.
- Callback raw body не сохраняется: хранится hash и allowlisted `redactedPayload`.
- Analytics scanner отклоняет email, email hash, PAN, Luhn-valid card values, CVV/CVC, cardholder, signatures и full provider references.
- Payment state/session не хранится в `localStorage` или `sessionStorage`.

Допустимые test-only совпадения:

- `tests/unit/analytics-privacy-scan.test.ts:49-58,175-181` содержит synthetic PAN/security keys только для negative privacy tests.
- WEBPAY/E2E fixtures содержат `wsb_*` и fake transaction identifiers, но не карточные реквизиты.
- `localStorage/sessionStorage` в `tests/e2e/recovery-ui.spec.ts:212-213` — проверка отсутствия утечки, не payment storage.

Потенциально опасные пути:

- Legacy `Payment.providerPayload` и `providerWebhookPayload` принимают raw adapter data без общей allowlist.
- `payment-service.ts:206-225` также помещает raw unknown provider payload в operational EventLog.
- `CommercialPaymentAttempt.providerFields` хранит полный server-created handoff набор. Сейчас он не содержит card data, но production adapter обязан иметь merchant-approved allowlist.

## 7. API/security findings

Положительное:

- Opaque `publicId`, отдельный secret lookup token, hash в БД, `HttpOnly`, `SameSite=Lax`.
- Status/refresh/claim закрыты order token.
- Callback и пользовательский refresh разделены.
- Replay защищён payload hash/event key uniqueness.
- Row locks и optimistic `updateMany` защищают paid/access transitions.
- Ошибка email после Access не может откатить generic Access; commercial Access вообще не зависит от email send.
- Fake provider запрещён в production; commercial checkout целиком non-production only.

Пробелы:

- Order создаётся до подтверждения владения email.
- `EXISTING_ACCESS` и `ORDER_ALREADY_PENDING` позволяют проверять состояние чужого email.
- CSRF helper принимает запрос без `Origin`.
- Raw `x-forwarded-for` можно подменить; limiter process-local и не масштабируется.
- Payment/status responses не имеют общего `Cache-Control: no-store` и `Referrer-Policy: no-referrer`.
- Return URL содержит opaque public order reference; без Referrer-Policy он может уйти как referrer на внешние legal/support links.
- Нет отдельного callback rate limit; replay ограничивает записи, но не стоимость status fetch.
- WEBPAY status fetch пока не имеет подтверждённой merchant authentication/signature boundary.

## 8. Analytics findings

Полностью реализовано:

- Canonical registry содержит `checkout_started`, `order_created`, `payment_session_created`, `payment_return_viewed`, pending/confirmed/terminal events, access и PWA derived events.
- `checkout_flow_id` связан с Order.
- `order_created` пишется post-commit и идемпотентно.
- `payment_confirmed` и `access_granted` создаются только backend.
- Email, email hash, raw URLs, card data, provider token/signature/reference запрещены privacy scanner.
- Frontend не может создать `payment_confirmed`.

Отсутствующие production callsites:

- `payment_session_created`;
- `payment_return_viewed`;
- `payment_pending`;
- `payment_failed`;
- `payment_cancelled`;
- `payment_expired`;
- `paid_without_access_detected`;
- `paid_without_access_resolved`.

Дополнительно `checkout_started` сейчас инициируется backend при создании `CommercialCheckoutFlow`, а не frontend при фактическом показе checkout. Это расходится с emitting-layer semantics measurement plan.

## 9. Documentation contradictions

В `origin/main` отсутствуют все девять обязательных документов:

- `stage-7-launch-control-v1.md`;
- `webpay-onboarding-dossier-v1.md`;
- `webpay-sandbox-evidence-plan-v1.md`;
- `analytics-measurement-plan-v1.md`;
- `ux-target-flow-spec-v1.md`;
- `ux-copy-pack-v1.md`;
- `ux-core-wireframes-v1.md`;
- `ux-state-wireframes-v1.md`;
- `ux-visual-system-v1.md`.

Также не найдены отдельные legal payment/public-copy документы; legal URLs существуют только как environment configuration.

Подтверждённые противоречия:

- `docs/11-approved-decisions-current.md:58-62` запрещает реализовывать WebPay до docs/credentials, но concrete sandbox protocol уже реализован.
- `docs/21-launch-readiness-pass-report.md:56-65` говорит, что provider не выбран и рабочий flow — mock.
- `README.md:9,103-109` описывает mock phase и всё ещё ожидает финального provider/documentation; commercial WEBPAY setup и gates не отражены.
- `docs/22-payment-epos-preparation-report.md` представляет E‑POS/ЕРИП подготовку без отметки, что она superseded для first-launch checkout.
- `docs/26-webpay-sandbox-checkout-manual-smoke.md:5-18` предлагает sandbox flow, хотя одновременно признаёт неподтверждённый field/status contract.
- `docs/27-commercial-checkout-integrity-manual-smoke.md:26` требует status refresh unavailable до documented semantics, но runtime выполняет status fetch при наличии URL.
- Комментарий `webpay-sandbox-provider.ts:62-63` называет `wsb_*` “documented v2 fields” без merchant-specific evidence.
- Явные `PAY-01A = READY`, `PAY-01B = BLOCKED`, real payments/production `NO-GO` не зафиксированы в repository launch-control документе.
- Final MVP Spec включает ЕРИП в MVP, тогда как новый контракт исключает его из first-launch checkout. Это можно совместить только явным уточнением: ЕРИП остаётся возможной будущей capability, но не отображается как v1 payment method.

## 10. Полностью реализованные требования

- Server-side 10 BYN/BYN validation.
- Order price/name/test/legal snapshot в текущем ограниченном объёме.
- Один Order на `checkout_flow_id`.
- Идемпотентный same-request replay.
- Отдельная PaymentAttempt.
- Один active PaymentAttempt на Order.
- Merchant reference и payment idempotency constraints.
- Same-tab POST form redirect.
- Browser return не подтверждает оплату.
- Callback signal сам по себе не подтверждает оплату.
- Atomic paid + Access.
- Exactly-one Access при callback replay/concurrency.
- Запрет downgrade уже оплаченного Order.
- Opaque public ID и hashed HttpOnly token.
- Backend pending/paid/failed/cancelled/expired.
- Fake/test provider boundary.
- Production commercial checkout disabled.
- Отсутствие card-data UI/schema.
- Analytics privacy scanner и backend-only payment confirmation.
- Recovery для Access, active Attempt и Result.

## 11. Подтверждённые backend gaps

Приоритетно:

1. Verified email authority до Order и устранение enumeration.
2. Resolver существующего pending Order с безопасной повторной авторизацией.
3. Запрет нового Order после completed Attempt/readable Result.
4. Полный immutable product/commercial snapshot.
5. `payment_status_unknown` как transient API projection.
6. Derived `paid_without_access`, automatic reconciliation и support state.
7. Восстановление provider session после crash/lost response.
8. Формализация terminal-retry transition.
9. Расширение verified recovery на pending Order/payment.
10. Persistent cooldown/rate limiting и trusted client identity.
11. Strict Origin/Host enforcement.
12. `no-store/no-referrer` для payment pages и API.
13. Safe support DTO с public reference и verification timestamps.
14. Удаление raw provider payload persistence из legacy слоя.
15. Недостающие authoritative analytics producers.

## 12. Frontend/Figma-only gaps

- 19 desktop + 19 mobile payment frames.
- Exact WEBPAY/card-boundary/cancel/pending/unknown/PWA copy.
- Creating Order/session/redirecting и 10-second fallback.
- 60-second polling window.
- Manual refresh cooldown presentation.
- Browser Back, `pageshow`, foreground and mobile return handling.
- Existing Order/Access/Result presentation.
- Support escalation panel с public order reference.
- 320 px overflow, sticky CTA, keyboard/focus/error summary.
- Screen-reader polling without announcement spam.
- Reduced motion, 200% zoom, non-color-only states.
- Approved WEBPAY/logo/scheme placeholders.
- Удаление generic “тестовая оплата” и popup/new-tab semantics из canonical flow.

## 13. Merchant-blocked gaps

- Merchant agreement и eligibility.
- Exact WEBPAY integration method/endpoints.
- Sandbox/production credentials.
- Checkout field contract.
- Signature/callback contract.
- Authenticated status API and response mapping.
- Real callback retry semantics.
- Session expiry, late success and reopen rules.
- Provider status-check rate limits.
- Real sandbox transaction evidence.
- Return/cancel/mobile/3DS behavior.
- Supported card schemes.
- Official logo/brand/hosted-page rules.
- Production acquiring/settlement configuration.

Текущий `WebPaySandboxProvider` нельзя использовать как evidence закрытия этих пунктов.

## 14. Рекомендуемая последовательность отдельных tasks

1. **A — Payment documentation reconciliation:** provider decision, ERIP scope, gates, launch docs, analytics plan; без UX redesign и legal sign-off.
2. **B1 — Verified checkout authority:** verified email before Order, non-enumerating resolver, Existing Order/Access/Result semantics.
3. **B2 — Backend state recovery:** unknown/PWA projections, reconciliation, session crash recovery, support DTO, terminal-retry consistency.
4. **B3 — Security/analytics hardening:** headers, Origin/Host, distributed rate limits, raw payload policy, missing canonical producers.
5. **D — Figma payment package:** exact frames, copy, responsive and accessibility evidence.
6. **C — Frontend behavior:** polling, fallback, Back/reload/mobile foreground and approved state rendering.
7. **E — Merchant integration:** заменить assumed WEBPAY adapter только после merchant docs/credentials; затем sandbox evidence.
8. Отдельно после этого — legal/operational sign-off и production gate review.

## 15. Рекомендуемый следующий bounded implementation scope

**Verified-email Order gate and existing-state resolver.**

Границы:

- требовать действующую verified email session для `POST /api/commercial/orders`;
- брать email из verified authority, а не доверять request body;
- до verification не раскрывать Order/Access/Result;
- после verification возвращать current pending Order, unused Access, active Attempt или readable Result;
- запретить repurchase после completed Attempt;
- не менять PaymentAttempt, WEBPAY adapter, Figma, analytics naming или production flags;
- добавить unit/integration/e2e tests для enumeration, pending restoration, completed Result и concurrent submit.

Этот scope закрывает самый высокий security/product риск и не зависит от merchant docs или визуального дизайна.

## 16. Проверки и отсутствие изменений

На exact audited SHA:

- `pnpm lint` — passed.
- `pnpm typecheck` — passed после генерации Prisma Client во временной копии.
- `pnpm test` — passed: 44 test files, 1234 tests; 12 DB-backed suites / 183 tests skipped штатными gates.
- DB-backed E2E не запускались: аудит не поднимал и не изменял локальную БД.
- Временная audit-копия удалена.
- Рабочее дерево после аудита имеет ровно те же pre-existing изменения: `next-env.d.ts`, `pnpm-workspace.yaml`, `acc-01a-recovery-spec-v1.md`, `acc-01a-session-bridge-decision-v1.md`, `docs/00-current-project-state.md`.
- Код, документация, schema, migrations, branch, commit и PR не создавались и не изменялись.

PAYMENT BACKEND AND DOCUMENTATION GAP AUDIT COMPLETE — NO CHANGES MADE

