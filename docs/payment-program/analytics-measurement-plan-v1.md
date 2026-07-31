# Payment analytics measurement plan v1

- Версия: `1.0`
- Дата: 2026-07-31
- Владелец: Payments Product / Backend Analytics
- Статус: `CANONICAL DESIGN; IMPLEMENTATION PARTIAL; PRODUCTION NO-GO`

## 1. Назначение и границы

Этот документ определяет канонические payment/access events, их источник истины,
момент фиксации и допустимый payload. Он не разрешает production activation и не
заменяет merchant, legal, security или QA gates.

При конфликте действует иерархия из
`docs/payment-program/sources/README.md`. Базовые требования этого плана взяты из
раздела 10 Payment UX Contract v1 и Final MVP Spec v2.

## 2. Непереговорные правила

1. Финансовое или доменное событие пишет только backend после указанного commit
   либо после авторитетной проверки provider signal.
2. CTA, browser return, URL/query/fragment, frontend loader, redirect и screenshot
   provider page не являются доказательством оплаты и никогда не создают
   `payment_confirmed`.
3. `payment_confirmed` допустим только после `callback`, `status_api` либо
   `fake_provider` в явно разрешённой среде.
4. Повторная доставка одного перехода состояния имеет тот же deterministic
   transition key и не создаёт вторую логическую запись.
5. Analytics выполняется после доменного commit или через безопасный outbox.
   Ошибка analytics не откатывает и не блокирует checkout render, Order,
   payment session, redirect, verification, Access, status return или recovery.
6. Frontend UX observations не получают права изменять Order, PaymentAttempt или
   Access. Backend принимает их только в allowlisted форме и отдельно от
   финансовых переходов.

## 3. Общий allowlist и privacy boundary

Обязательный envelope:

- `event_id`: UUID;
- `event_name`: имя из реестра ниже;
- `event_version`: `1`;
- `occurred_at`, `received_at`;
- `environment`: `development | test | sandbox | production`;
- `traffic_class`: `external_user | synthetic`;
- `traffic_class_assignment_source`;
- `emitting_layer`;
- `analytics_id_key_version` только вместе с keyed entity hashes.

Допустимые идентификаторы:

- random backend-issued `checkout_flow_id`;
- ephemeral `anonymous_session_id`, если он будет отдельно утверждён и не
  связывает пользователя между несвязанными flows;
- keyed analytics hashes для public Order, PaymentAttempt и Access IDs;
- provider enum, environment и allowlisted status/error categories.

Запрещены во всех событиях:

- email, email hash, имя, телефон и buyer/student assertions;
- PAN, masked PAN, CVV/CVC, expiry, cardholder и 3-D Secure data;
- provider payload, signature, secret, merchant/store ID и credentials;
- transaction/invoice/RRN/provider reference;
- точная сумма и валюта;
- raw URL, query, fragment, token, cookie и recovery/payment session token;
- raw/free-text error, response/request body, stack trace и произвольный текст;
- ответы, тексты заданий, ключи, primary/scaled score и lookup data.

Свойства, не перечисленные в строке события, запрещены strict-schema правилом.

## 4. Канонический реестр событий

Статусы реализации относятся к baseline `c137ba6`.

| Event | Класс и authority | Producer и emission boundary | Разрешённые properties | Состояние на baseline | Владелец gap |
|---|---|---|---|---|---|
| `checkout_started` | UX observation: checkout действительно показан с backend-issued flow ID; не доказывает Order/оплату | Checkout UI после успешного render; backend может валидировать и принять observation, но не создавать финансовый state | `checkout_flow_id`, `product_id`, `test_id`, `exam_mode` | `PARTIAL`: backend пишет при создании `CommercialCheckoutFlow`, до доказанного render | `B3-05` |
| `payment_return_viewed` | UX observation: status page показана с sanitized local status; не доказывает paid/Access | Return/status UI после успешного render безопасной backend projection | keyed `order_public_id_hash`, allowlisted `local_status`, `return_context` enum | `MISSING` | `B3-05` |
| `order_created` | Backend truth: committed Order с immutable backend snapshot | Backend только после commit Order | `checkout_flow_id`, keyed `order_public_id_hash`, `product_id`, `test_id` | `PARTIAL`: producer есть, но schema дополнительно содержит запрещённые `amount`/`currency` | `B3-05` |
| `payment_session_created` | Backend truth: committed PaymentAttempt и provider-session state | Backend после commit локального session state; raw redirect URL/provider ID не передаются | keyed `order_public_id_hash`, keyed `payment_attempt_public_id_hash`, `payment_provider`, `payment_environment`, allowlisted `session_state` | `MISSING` | `B3-05` |
| `payment_pending` | Backend truth: committed local pending | Callback/status/reconciliation service после авторитетного mapping и commit | keyed Order/PaymentAttempt hashes, `payment_provider`, `payment_environment`, `payment_status: pending`, `verification_method` enum | `MISSING` | `B3-05` |
| `payment_confirmed` | Backend truth: авторитетно подтверждённая и committed оплата | Callback/status API либо разрешённый fake provider после verification и commit | keyed Order/PaymentAttempt hashes, `payment_provider`, `payment_environment`, `payment_status: paid`, `verification_method` | `IMPLEMENTED` | — |
| `payment_failed` | Backend truth: committed authoritative/local terminal mapping | Payment processor после validation, legal transition и commit | keyed Order/PaymentAttempt hashes, provider/environment, `payment_status: failed`, `verification_method`, allowlisted `terminal_reason` | `MISSING` | `B3-05` |
| `payment_cancelled` | Backend truth: committed authoritative/local terminal mapping | Payment processor после validation, legal transition и commit | keyed Order/PaymentAttempt hashes, provider/environment, `payment_status: cancelled`, `verification_method`, allowlisted `terminal_reason` | `MISSING` | `B3-05` |
| `payment_expired` | Backend truth: committed authoritative/local terminal mapping | Payment processor/reconciler после validation, legal transition и commit | keyed Order/PaymentAttempt hashes, provider/environment, `payment_status: expired`, `verification_method`, allowlisted `terminal_reason` | `MISSING` | `B3-05` |
| `payment_validation_failed` | Backend security/operational truth: provider signal отклонён, business state не изменён | Verification boundary после отказа, без state transition | optional keyed Order/PaymentAttempt hashes, provider/environment, fixed `error_category`, allowlisted `validation_reason` | `IMPLEMENTED` | — |
| `access_granted` | Backend truth: exactly-one Access committed | Backend только после commit Access | keyed Access/Order/PaymentAttempt hashes, `product_id`, `test_id`, `exam_mode`, `access_source: paid`, `grant_reason` | `IMPLEMENTED` | — |
| `paid_without_access_detected` | Derived backend reconciliation truth | Reconciler после устойчивого чтения paid Order и отсутствующего Access; не из browser return | keyed Order/PaymentAttempt hashes, allowlisted `detection_source`, bounded `age_bucket`, `support_required` | `MISSING` | `B2-03`, `B3-05` |
| `paid_without_access_resolved` | Derived backend reconciliation truth | Reconciler после commit ровно одного Access либо allowlisted support resolution | keyed Order/PaymentAttempt/Access hashes, allowlisted `resolution`, bounded `resolution_time_bucket` | `MISSING` | `B2-03`, `B3-05` |
| `backend_operation_failed` | Backend operational truth; не меняет финансовый state сам по себе | Checkout/payment/access boundary после классифицированной ошибки | optional keyed entity hashes, random `error_event_id`, fixed `error_category`, `failure_stage`, allowlisted `error_code`, `retryable`, `severity` | `IMPLEMENTED` | — |

`product_cta_clicked` и `client_error_shown` остаются допустимыми UX-событиями
контракта, но не входят в обязательный backend truth registry A-06. Новый event
для кнопки `Перейти к оплате картой` в v1 не создаётся.

Transient projection `payment_status_unknown` не является новым payment state или
обязательным analytics event. Её UX/backend поведение принадлежит `B2-02`.

## 5. Текущий callsite inventory

| Event | Текущий producer | Проверенная граница |
|---|---|---|
| `checkout_started` | `src/lib/commercial/commercial-service.ts` | Создание backend checkout flow; render semantics пока не подтверждены |
| `order_created` | `src/lib/commercial/commercial-service.ts` | После создания Order; payload требует удаления amount/currency |
| `payment_confirmed` | `src/lib/commercial/commercial-service.ts` | Только из подтверждённого paid transition; duplicate transition idempotent |
| `access_granted` | `src/lib/commercial/commercial-service.ts` | После доменного Access result |
| `payment_validation_failed` | `src/lib/commercial/commercial-service.ts` | Отклонённый provider signal, без выдачи Access |
| `backend_operation_failed` | `src/lib/commercial/commercial-service.ts` | Классифицированная backend failure |

Общие enforcement points:

- schema registry: `src/lib/analytics/schemas.ts`;
- privacy guard: `src/lib/analytics/forbidden-payload.ts`;
- persistence/idempotency/failure isolation:
  `src/lib/analytics/analytics-service.ts`;
- keyed entity hashes: `src/lib/analytics/analytics-id.ts`;
- unit evidence: `tests/unit/analytics.test.ts`.

## 6. Implementation gaps и правило закрытия

`B3-05` обязан:

1. добавить strict schemas и authoritative producers для всех строк со статусом
   `MISSING`;
2. перенести `checkout_started` на доказанный render boundary либо документировать
   безопасный server acknowledgement, который действительно следует после render;
3. удалить `amount` и `currency` из `order_created` analytics payload;
4. доказать, что return/CTA/browser state не может вызвать
   `payment_confirmed`;
5. сохранить non-blocking analytics failure и deterministic transition
   idempotency;
6. добавить unit/integration tests на schema allowlists, forbidden payload,
   duplicate delivery и producer authority.

`paid_without_access_*` producers нельзя считать реализованными до закрытия
доменной reconciliation в `B2-03`. Mock или merchant assumption не является
evidence production readiness.

## 7. Acceptance evidence A-06

- Все 14 обязательных events имеют authority, producer boundary, allowlisted
  properties, baseline status и владельца gap.
- Все отсутствующие или частично соответствующие producers направлены в `B3-05`;
  PWA-derived события также зависят от `B2-03`.
- Privacy boundary прямо запрещает PII, email hash, card/provider secrets,
  provider references, точную сумму/валюту и raw URLs.
- Analytics failure isolation и prohibition на browser-created confirmation
  закреплены как invariants.
- Документ является design/control evidence; он не выдаёт отсутствующую
  реализацию за завершённую.
