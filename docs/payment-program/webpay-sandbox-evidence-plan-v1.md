# WEBPAY Real Sandbox Evidence Plan v1

Версия: 1.0  
Дата: 2026-07-30  
Владелец: Payments QA / Merchant integration owner  
Статус: `BLOCKED_EXTERNAL`

## Preconditions

Real sandbox pass начинается только после E-01/E-02 и реализации E-03:

- merchant-specific sandbox credentials получены безопасным каналом;
- fields/signatures/callback/status API подтверждены authoritative docs;
- adapter не использует assumed protocol;
- legal/support test values утверждены;
- production остаётся выключен.

Local fake provider и mocked WEBPAY HTTP responses полезны для regression, но не закрывают эту matrix.

## Evidence package для каждого сценария

- UTC timestamp и environment identifier;
- redacted request/response field inventory;
- signature verification outcome без secret/signature disclosure;
- public Order/PaymentAttempt references;
- DB state before/after;
- Access count before/after;
- relevant application/provider log references без PII/raw URL;
- browser/device/3DS context;
- expected и actual outcome;
- reviewer verdict.

## Real sandbox matrix

| Scenario | Expected invariant | Blocking |
|---|---|---|
| Successful card payment | Provider-verified paid; exactly one Access | Да |
| Callback replay | No duplicate transition/Access/analytics | Да |
| Concurrent duplicate callbacks | Exactly one terminal transition and Access | Да |
| Invalid signature/auth | No payment state change | Да |
| Wrong merchant/order reference | No state change; safe validation event | Да |
| Amount mismatch | No paid transition/Access | Да |
| Currency mismatch | No paid transition/Access | Да |
| Provider payment ID conflict | No overwrite/double grant | Да |
| User cancel | Cancelled state; no Access; safe retry policy | Да |
| Provider failure | Failed state; no Access | Да |
| Session expiry | Expired state/recovery according to contract | Да |
| Late success after pending/expiry | Contractual reconciliation; no second payment/Access | Да |
| Browser return before callback | Pending/unknown; return is not proof | Да |
| Lost browser return | Server callback/status still reconciles | Да |
| Lost create-session response | Recover session or safe reconciliation; no second active attempt | Да |
| Status API unavailable/timeout | `payment_status_unknown`; no repeat payment | Да |
| Rate limit/429 | Cooldown and `Retry-After`; no unsafe retry storm | Да |
| Mobile browser return/foreground | State restores without duplicate submit/payment | Да |
| 3-D Secure success/failure/cancel | Correct terminal/pending behavior | Да |
| Unsupported card scheme | Safe provider error/copy; no Access | Да |
| Completed Result repurchase attempt | Existing Result path; no repeat purchase | Да |
| Paid without Access fault injection | Derived PWA, reconciliation/support, no repeat payment | Да |

## Browser/accessibility matrix

- desktop Chromium/WebKit/Firefox as supported;
- 320 px and 360 px mobile widths;
- reload, Back, bfcache/pageshow, focus/foreground;
- 10-second redirect fallback;
- 60-second polling and manual cooldown;
- keyboard-only and visible focus;
- 200% zoom;
- reduced motion;
- screen-reader announcement without noisy polling;
- no card inputs or embedded bank form.

## Failure policy

Любое нарушение amount/currency/signature/idempotency/exactly-one-Access/card-data boundary — `CRITICAL`. Missing recovery/security evidence — минимум `HIGH`. Critical/high finding блокирует E-04/E-05/QA-02.

## Exit criteria

- Все blocking scenarios имеют authentic sandbox evidence.
- Mock evidence явно отделено.
- Provider docs/version и credentials environment идентифицированы.
- Findings исправлены и повторно проверены.
- Независимый reviewer выставил E-04 `DONE`.
- Production всё ещё `NO-GO` до E-05 и QA-02.
