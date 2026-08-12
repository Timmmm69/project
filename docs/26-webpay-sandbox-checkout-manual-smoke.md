# WebPay Sandbox Checkout Manual Smoke

> `DEV/TEST ASSUMPTION ONLY`. Этот smoke использует assumed `wsb_*` adapter и не является merchant-approved sandbox evidence. Для real sandbox применяется `docs/payment-program/webpay-sandbox-evidence-plan-v1.md`; production остаётся `NO-GO`.

1. Apply migrations: `pnpm prisma migrate deploy`.
2. Seed the product: `pnpm seed:commercial`.
3. In a non-production `.env`, set `COMMERCIAL_CHECKOUT_ENABLED=true`, `PAYMENTS_MODE=webpay_sandbox`, all legal URLs, `SUPPORT_EMAIL`, and `WEBPAY_SANDBOX_*` credentials.
4. Open the imported authentic test and verify the 10 BYN checkout disclosure, legal links, adult checkbox, support contacts, one attempt, 90-day start window, and 120-minute timer disclosure.
5. Create an order with a new normalized email and one `Idempotency-Key`.
6. Create a payment session and confirm that the signed WebPay sandbox form contains server-defined 10.00 BYN only.
7. Complete this step only with merchant-issued sandbox credentials and confirmed protocol. Otherwise use it only as a local assumed-flow check. The browser return may remain pending.
8. Deliver the verified notification or use refresh status. Confirm one granted access and a 90-day start deadline.
9. Refresh the page and replay the same notification. Confirm no second access.
10. Attempt a new order with the same normalized email. Confirm `EXISTING_ACCESS` and the appropriate next action.
11. Send an invalid signature and a validly-shaped amount mismatch. Confirm neither changes order/payment/access state.
12. Set `COMMERCIAL_CHECKOUT_ENABLED=false` and confirm the commercial CTA disappears while the generic MVP still works.

## Awaiting WEBPAY Sandbox Credentials

The repository contains a sandbox-only assumed `wsb_*` form adapter and deterministic local fake provider. The final WEBPAY field/signature/callback/status contract, test credentials and real sandbox evidence must come from merchant-specific documentation and E-01..E-04. This document cannot close merchant or production gates. Production mode is intentionally unsupported.
