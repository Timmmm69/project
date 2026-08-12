# Payment Core Audit Revalidation

Дата: 2026-07-30
Карточка: `A-03`
Current base SHA: `b172f70`
Historical audited SHA: `adf23554a1bac5a6f751fa4fc9a80f2bf64371f2`

## Важное расхождение baseline

Historical audited SHA не является предком текущего `main`. Merge base текущего HEAD и `adf2355` — `01eb2d3a8a52e5d7efe261e88cacce378212037e`; после него ветки разошлись.

Поэтому historical evidence нельзя переносить на текущий HEAD по дате или названию ветки:

- текущий `main` содержит commercial checkout commits и payment-program documentation;
- audited `origin/main` содержит более поздние verified-session/recovery/canonical-analytics/runtime-readiness commits, которых нет в текущем рабочем дереве;
- `src/server/auth/verified-student-session/`, `src/server/recovery/` и canonical analytics runtime files отсутствуют на текущем HEAD.

Ниже приведена новая проверка фактического текущего дерева. Она не утверждает, что изменения audited `origin/main` плохие или ненужные; они просто не присутствуют в текущей ветке.

## Нормализованные статусы

- `IMPLEMENTED` — текущий код и тесты прямо подтверждают требование; сохраняется как regression invariant.
- `PARTIAL` — часть механики есть, но критерий целиком не выполнен.
- `MISSING` — требуемой authoritative реализации нет.
- `CONTRADICTED` — текущий runtime явно допускает запрещённое контрактом поведение.
- `MERCHANT_BLOCKED` — без merchant-approved evidence требование нельзя считать выполненным.

## Revalidated gap matrix — 35/35

| ID | Current status | Current evidence | Strength | Следующий владелец |
|---|---|---|---|---|
| `ORD-01` | `IMPLEMENTED` | `src/lib/commercial/config.ts`; `createCommercialOrder` в `commercial-service.ts`; server-side product/price/currency проверки; `tests/e2e/commercial-checkout.spec.ts` | Code + test | `QA-01` regression |
| `ORD-02` | `PARTIAL` | `CommercialOrder` хранит test/name/price/currency/legal snapshot, но не полный attempt/start-window/duration/result contract; Access grant читает текущий product | Code | `B2-01` |
| `ORD-03` | `MISSING` | `createCommercialOrder` получает email из request input; verified commercial authority/session отсутствует в текущем дереве | Code + absence scan | `B1-01`, `B1-04` |
| `ORD-04` | `IMPLEMENTED` | Unique checkout flow relation, idempotency path и concurrency tests сохранены | Code + test | `QA-01` regression |
| `ORD-05` | `PARTIAL` | Existing pending order блокируется typed error, но безопасный verified resolver/token restoration отсутствует | Code + test | `B1-05` |
| `ORD-06` | `CONTRADICTED` | Active Attempt/unused Access учитываются, но completed Result не является запретом новой покупки | Code + test | `B1-05` |
| `PAY-01` | `IMPLEMENTED` | `CommercialPaymentAttempt`, public/provider refs и idempotency constraints присутствуют в schema/migrations | Schema + migration | `QA-01` regression |
| `PAY-02` | `IMPLEMENTED` | Partial unique active-attempt constraint, row locking и concurrency tests присутствуют | Schema + code + test | `QA-01` regression |
| `PAY-03` | `PARTIAL` | Новая attempt создаётся в том же Order, но terminal→pending aggregate transition не формализован единообразно | Code + test | `B2-05` |
| `PAY-04` | `IMPLEMENTED` | Сохранённые `paymentUrl/providerFields` позволяют вернуть existing active provider session без второй attempt | Code | `QA-01` regression |
| `PAY-05` | `MISSING` | Crash после provider create и до local finalize оставляет active attempt без recoverable provider session | Code path | `B2-04`, `E-02` |
| `PAY-06` | `IMPLEMENTED` | Browser return восстанавливает локальный Order; paid/access выдаются только server-side notification/status path | Code + security test | `QA-01` regression |
| `PAY-07` | `MERCHANT_BLOCKED` | `WebPaySandboxProvider` использует assumed `wsb_*`/status contract; merchant agreement/docs/credentials/real sandbox отсутствуют | Code + missing external evidence | `E-01..E-04` |
| `ACC-01` | `IMPLEMENTED` | Paid transition и exactly-one Access выполняются transactionally; unique constraints и replay/concurrency tests присутствуют | Code + schema + test | `QA-01` regression |
| `ACC-02` | `MISSING` | Нет derived `paid_without_access`, reconciliation и threshold; recovery state resolver из audited branch отсутствует в current HEAD | Code + absence scan | `B2-03` |
| `STA-01` | `IMPLEMENTED` | Persisted Order/Attempt states pending/paid/failed/cancelled/expired существуют; новый DB enum не требуется | Schema + state machine | `QA-01` regression |
| `STA-02` | `MISSING` | `payment_status_unknown` projection отсутствует в types, service и UI | Absence scan | `B2-02` |
| `STA-03` | `MERCHANT_BLOCKED` | Refresh route/server fetch есть, но authoritative verification protocol не подтверждён merchant contract | Code + missing external evidence | `E-02`, `E-03` |
| `STA-04` | `PARTIAL` | Status/refresh endpoints есть; 60-second frontend polling contract отсутствует | Code + frontend scan | `C-04` |
| `STA-05` | `PARTIAL` | Commercial limiter process-local/in-memory; durable limiter, trusted cooldown data и `Retry-After` отсутствуют | Code | `B3-02`, `C-04` |
| `STA-06` | `IMPLEMENTED` | Opaque `CommercialOrder.publicId` и hashed HttpOnly order token существуют | Schema + code | `QA-01` regression |
| `STA-07` | `MISSING` | Support email есть, но safe DTO с reference/timestamps/actions и support panel отсутствуют | Code + frontend scan | `B2-06`, `C-03`, `O-02` |
| `REC-01` | `PARTIAL` | Return URL/cookie восстанавливают конкретный Order после provider return; pre-return/reload resolver через verified authority отсутствует | Code + browser test | `B1-05`, `C-05` |
| `REC-02` | `MISSING` | `pageshow`, bfcache, visibility/focus/foreground и mobile-return handlers отсутствуют | Frontend absence scan | `C-05` |
| `REC-03` | `MISSING` | ACC-01A specs versioned, но recovery backend/session/OTP implementation отсутствует в текущем дереве | Repository path + absence scan | `B1-01..B1-03`, `B2-07` |
| `SEC-01` | `CONTRADICTED` | Order creation до verified email возвращает outcomes, различающие existing access/pending order | Code | `B1-04`, `B3-01` |
| `SEC-02` | `PARTIAL` | Missing Origin разрешается; raw forwarded address доверяется; commercial rate limit process-local | Code | `B3-01`, `B3-02` |
| `SEC-03` | `MISSING` | Commercial payment pages/API не задают системно `no-store`/`no-referrer`; public order ref остаётся в return URL | Header/route scan | `B3-03` |
| `CARD-01` | `IMPLEMENTED` | PAN/CVV/cardholder inputs и DB columns отсутствуют; hosted-page boundary закреплён в canonical docs | Code/schema scan + docs | `QA-01` regression |
| `CARD-02` | `PARTIAL` | Commercial event path хранит hash/allowlist, но legacy Payment продолжает raw create/webhook payload persistence; providerFields требуют sanitizer review | Code + schema | `B3-04` |
| `ANA-01` | `IMPLEMENTED` | Строгий реестр event schemas, privacy denylist, safe persistence/deduplication и unit tests полностью покрывают bounded canonical schema/privacy criterion | Code + test | `QA-01` regression |
| `ANA-02` | `PARTIAL` | `order_created`, `payment_confirmed`, `access_granted`, validation/backend failure producers есть; session/return/pending/terminal/unknown/PWA producers отсутствуют | Callsite scan + tests | `B3-05` |
| `DOC-01` | `PARTIAL` | Board/source register/reconciliation/ACC sources созданы, но девять launch/analytics/UX package documents и legal public-copy package ещё не готовы | Repository inventory | `A-05`, `A-06`, `D-01`, `O-01` |
| `DOC-02` | `IMPLEMENTED` | Final MVP Spec, approved decisions и board явно фиксируют `PAY-01A`, `PAY-01B`, WEBPAY target, deferred ЕРИП и production `NO-GO` | Docs + independent A-04 review | `QA-02` regression |
| `UI-01` | `MISSING` | Current form остаётся «Тестовая оплата» и не имеет полного state/copy/mobile/a11y package | Frontend scan | `D-01..D-03`, `C-01..C-07` |

## Итог по статусам

| Статус | Количество |
|---|---:|
| `IMPLEMENTED` | 12 |
| `PARTIAL` | 10 |
| `MISSING` | 9 |
| `CONTRADICTED` | 2 |
| `MERCHANT_BLOCKED` | 2 |
| **Всего** | **35** |

## Regression invariants

Следующие implemented IDs не удаляются из программы и остаются обязательными для `QA-01/QA-02`:

`ORD-01`, `ORD-04`, `PAY-01`, `PAY-02`, `PAY-04`, `PAY-06`, `ACC-01`, `STA-01`, `STA-06`, `CARD-01`, `ANA-01`, `DOC-02`.

## Card status routing

До независимого принятия A-03 все зависимые feature-карточки остаются `BACKLOG`, даже если по dependency graph они станут `READY` после verdict.

После `A-03 = DONE` reviewer открывает:

- `READY`: `A-05`, `A-06`, `A-07`, `B1-01`, `B2-01`, `B2-02`, `B2-05`, `B2-06`, `B3-01`, `B3-02`, `B3-03`, `B3-04`;
- `BLOCKED_EXTERNAL`: `B2-04` из-за зависимости `E-02`;
- `BACKLOG`: остальные revalidated B/C cards до закрытия их внутренних зависимостей.

## Проверки A-03

- Historical/current ancestry проверена через `git merge-base`.
- Все 35 IDs присутствуют ровно один раз в этой matrix.
- Все next-owner task IDs разрешаются в существующий реестр.
- Merchant-blocked строки не закрыты mock/sandbox evidence.
- Runtime-код, schema и tests в A-03 не изменялись.
