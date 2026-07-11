# Commercial Checkout Integrity Manual Smoke

## Preconditions

- Use local PostgreSQL only and apply migrations with `pnpm prisma migrate deploy`.
- Seed an active `russian-training-variant-01` product for a published training test.
- Set `COMMERCIAL_CHECKOUT_ENABLED=true`, `PAYMENTS_MODE=webpay_sandbox`, and all legal/support values.
- For the browser-only fake flow set `COMMERCIAL_FAKE_PROVIDER_TEST_ONLY=true`. This flag must never be enabled in production.

## Browser Flow

1. Open the commercial test page and verify the commercial panel shows 10.00 BYN, one attempt, a 90-day start window, 120 minutes after start, and primary result wording.
2. Confirm the page does not promise a RIKZ scaled score and does not show generic mock payment controls beside the commercial checkout.
3. Create an order, open payment, and confirm the return URL includes `commercialOrder` and `paymentReturn=1`.
4. After verified payment, return to the test page. The page must restore only the order represented by the HttpOnly order token and display the paid state.
5. Click the action button. Claiming the order must set the existing student session, then start or restore the normal attempt flow.
6. Reload the return page and replay the provider notification. Verify that there is still exactly one commercial access.
7. Open checkout again while the attempt is started. The response must offer continuation, not create another order or payment attempt.

## Negative Checks

1. Request an order status or claim endpoint without the matching order cookie. Confirm a safe 403 response without email or order details.
2. Submit a different order idempotency key for the same email while an order is pending. Confirm `ORDER_ALREADY_PENDING` and no token rotation.
3. Submit a second payment-session key while an active payment attempt exists. Confirm that the existing session is reused or a typed active-session response is returned.
4. Send a notification with another provider, invalid signature, wrong amount, or wrong currency. Confirm no payment state change and no access.
5. Confirm WebPay sandbox refresh returns `PROVIDER_STATUS_REFRESH_UNAVAILABLE` until documented signed status semantics are available.

## Rollback

Set `COMMERCIAL_CHECKOUT_ENABLED=false`. Existing commercial orders, payment events, accesses, generic access codes, and manual access records remain intact.
