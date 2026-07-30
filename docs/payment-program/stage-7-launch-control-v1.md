# Stage 7 Payment Launch Control v1

Версия: 1.0  
Дата: 2026-07-30  
Владелец: Product Owner / Payments Program  
Production verdict: `NO-GO`

## Целевой launch boundary

- `PAY-01A = READY`: утверждённый product/UX target — WEBPAY hosted POST redirect в той же вкладке.
- `PAY-01B = BLOCKED`: реальные платежи и production activation запрещены.
- ЕРИП отложен и отсутствует в first-launch checkout.
- Card inputs, PAN/CVV и embedded bank form запрещены.
- Browser return не подтверждает оплату и не создаёт Access.

## Gate register

`PASS` означает наличие проверенного evidence. `BLOCKED_EXTERNAL` нельзя закрыть mock, local fake или assumed sandbox protocol.

| Gate | Владелец | Требуемое evidence | Current status | Блокирует production |
|---|---|---|---|---|
| Source hierarchy и target decision | `A-01..A-04` | Independent review reports | `PASS` | Да |
| Audit revalidation | `A-03` | 35/35 current-state matrix + review | `PASS` | Да |
| Launch documents reconciliation | `A-05` | Этот register, dossier, sandbox plan, reconciled legacy docs | `IN_REVIEW_REQUIRED` | Да |
| Analytics plan | `A-06`, `B3-05` | Measurement plan, producers, privacy tests | `OPEN` | Да |
| Full traceability | `A-07` | Acceptance/provider/legal/Figma coverage review | `OPEN` | Да |
| Verified authority/recovery | `B1-01..B1-05` | Security implementation + tests + review | `OPEN` | Да |
| Payment state/recovery | `B2-01..B2-07` | Snapshot, unknown/PWA, retry, support, crash recovery | `OPEN` | Да |
| Security hardening | `B3-01..B3-04` | Origin/Host/CSRF, durable limits, private headers, payload sanitizer | `OPEN` | Да |
| UX/Figma evidence | `D-01..D-03` | Approved frames, exact copy, responsive/a11y evidence | `OPEN` | Да |
| Canonical frontend | `C-01..C-07` | Complete checkout/state/recovery/browser flow | `OPEN` | Да |
| Merchant eligibility/agreement | `E-01` | Written agreement/eligibility and merchant-specific docs | `BLOCKED_EXTERNAL` | Да |
| Merchant protocol | `E-02`, `E-03` | Confirmed fields/signatures/callback/status/expiry/retry contract and implemented adapter | `BLOCKED_EXTERNAL` | Да |
| Real sandbox | `E-04` | Evidence matrix from real merchant sandbox | `BLOCKED_EXTERNAL` | Да |
| Production acquiring/config | `E-05` | Settlement, production credentials/config, rollback approval | `BLOCKED_EXTERNAL` | Да |
| Seller/legal/privacy/refund | `O-01`, `O-03` | Approved public copy and manual refund/receipt process | `BLOCKED_EXTERNAL` | Да |
| Support/runbook | `O-02` | Support email/hours and incident runbooks | `BLOCKED_EXTERNAL` | Да |
| Production email | `O-04` | SMTP delivery, recovery/deliverability QA | `BLOCKED_EXTERNAL` | Да |
| Hosting/site registration | `E-01`, `O-01`, `E-05` | Applicable Belarus hosting/registration evidence, including WEBPAY site requirements | `BLOCKED_EXTERNAL` | Да |
| Final regression | `QA-01` | Security/concurrency/browser/payment matrix | `OPEN` | Да |
| Independent production gate | `QA-02` | No open critical/high findings or placeholders | `OPEN` | Да |

## Activation rule

Production activation разрешается только при одновременном выполнении всех условий:

1. Все blocking gates имеют `PASS`.
2. Merchant-specific protocol реализован по authoritative документации.
3. Real sandbox evidence принят независимым review.
4. Нет открытых `CRITICAL`/`HIGH` findings.
5. Нет placeholder seller/legal/support/email/provider values.
6. QA-02 явно меняет verdict с `NO-GO` на `GO`.

Отсутствие finding, зелёный mock test или локальная демонстрация сами по себе не являются evidence для production.

## Feature-off и rollback

- Немедленный feature-off: `COMMERCIAL_CHECKOUT_ENABLED=false`.
- Production commercial checkout сейчас дополнительно запрещён runtime guard.
- Local fake provider разрешён только в dev/test.
- При rollback существующие Order/Attempt/Access не удаляются и не переписываются.
- Rollback не отменяет уже подтверждённую оплату и не создаёт второй Access.
- Возврат к legacy ExpressPay/E-POS/ЕРИП UI не является допустимым production rollback.
- Production rollback procedure и ответственные лица утверждаются в E-05/O-02.

## Изменение verdict

Только независимый QA-02 reviewer может изменить production verdict. Любое изменение одновременно обновляет board, этот register, E-05 evidence, review report и handoff.
