# WebPay Sandbox Checkout Manual Smoke

1. Apply migrations: `pnpm prisma migrate deploy`.
2. Seed the product: `pnpm seed:commercial`.
3. In a non-production `.env`, set `COMMERCIAL_CHECKOUT_ENABLED=true`, `PAYMENTS_MODE=webpay_sandbox`, all legal URLs, `SUPPORT_EMAIL`, and `WEBPAY_SANDBOX_*` credentials.
4. Open the imported authentic test and verify the 10 BYN checkout disclosure, legal links, adult checkbox, support contacts, one attempt, 90-day start window, and 120-minute timer disclosure.
5. Create an order with a new normalized email and one `Idempotency-Key`.
6. Create a payment session and confirm that the signed WebPay sandbox form contains server-defined 10.00 BYN only.
7. Complete a sandbox payment when WEBPAY credentials are available. The browser return may remain pending.
8. Deliver the verified notification or use refresh status. Confirm one granted access and a 90-day start deadline.
9. Refresh the page and replay the same notification. Confirm no second access.
10. Attempt a new order with the same normalized email. Confirm `EXISTING_ACCESS` and the appropriate next action.
11. Send an invalid signature and a validly-shaped amount mismatch. Confirm neither changes order/payment/access state.
12. Set `COMMERCIAL_CHECKOUT_ENABLED=false` and confirm the commercial CTA disappears while the generic MVP still works.

## Awaiting WEBPAY Sandbox Credentials

The repository contains a sandbox-only `wsb_*` form adapter and deterministic local fake provider. The final WebPay field contract, status endpoint, test credentials, and real sandbox callback must be confirmed against the merchant documentation supplied by WEBPAY before any external sandbox transaction is relied upon. Production mode is intentionally unsupported.
