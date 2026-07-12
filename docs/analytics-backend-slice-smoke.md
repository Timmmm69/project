# Backend analytics payment/access slice — manual smoke

This runbook covers only `payment_confirmed`, `access_granted`, `payment_validation_failed`, and `backend_operation_failed`. It does not complete ANA-02 and must not be used for production enablement.

## Prerequisites

1. Use a local/test PostgreSQL database and synthetic commercial fixtures only.
2. Apply migrations and generate Prisma Client.
3. Never use a real provider secret as `ANALYTICS_ID_HMAC_KEY`.
4. For enabled checks set a synthetic key of at least 32 characters and a non-secret version such as `smoke-v1`.

## Smoke 1 — analytics disabled

1. Set `ANALYTICS_ENABLED=false`; analytics key variables may be absent.
2. Complete a local fake-provider purchase.
3. Confirm that Order and PaymentAttempt are `PAID` and exactly one Access exists.
4. Confirm that no matching rows were added to `analytics_events`.

## Smoke 2 — fake provider success

1. Set `ANALYTICS_ENABLED=true`, `ANALYTICS_ID_HMAC_KEY=<synthetic-32+-character-key>`, and `ANALYTICS_ID_KEY_VERSION=smoke-v1`.
2. Complete a fresh local fake-provider purchase.
3. Confirm exactly one `payment_confirmed` and one `access_granted`.
4. Confirm `payment_provider=fake`, `payment_environment=test`, and `verification_method=fake_provider`.
5. Inspect `properties_json`: it must contain keyed hashes, not raw public/database IDs, email, answers, scores, provider references, or secrets. `analytics_id_key_version` is an envelope column, never a property.

## Smoke 3 — duplicate notification

1. Replay the successful notification two to five times, including a concurrent replay if the harness supports it.
2. Confirm exactly one Access and one canonical event for each transition key.
3. Confirm the commercial state remains `PAID`.

## Smoke 4 — rejected payment event

1. Send controlled invalid signature/callback, amount/currency mismatch, merchant-reference mismatch, and unavailable-status cases.
2. Confirm no new paid transition or Access for each rejected case.
3. Confirm a safe `payment_validation_failed` with an allowlisted `validation_reason`.
4. Confirm no raw provider body, signature, merchant reference, provider payment ID, URL, exception, or message is present.

## Smoke 5 — WEBPAY status test double

1. Configure the existing WEBPAY sandbox test double; do not use real credentials.
2. Send a callback that triggers the mandatory server-side status refresh.
3. Confirm the callback alone does not make PaymentAttempt or Order paid.
4. Return an authoritative paid status response and confirm one `payment_confirmed` with `verification_method=status_api` and one `access_granted`.
5. Confirm no event claims `verification_method=callback` for this flow.

## Smoke 6 — database inspection

Inspect recent rows without exporting operational `event_logs` as analytics:

```sql
SELECT event_name, event_version, environment, traffic_class,
       traffic_class_assignment_source, emitting_layer,
       analytics_id_key_version, properties_json
FROM analytics_events
ORDER BY received_at DESC
LIMIT 50;
```

Verify:

- no email or deterministic email hash;
- no raw UUID primary key or opaque public ID in `properties_json`;
- no merchant reference, provider payment ID, signature, token, URL, payload, or free text;
- no answer, question content, accepted/correct key, or explanation;
- no raw/primary/scaled score or lookup data;
- only the four implemented event names;
- `event_version` is the only schema-version field;
- external commercial traffic is `external_user/default_external_user`; only trusted tests may use `synthetic/test_fixture`;
- canonical success transition keys are unique and are not copied into `properties_json` or client responses.
- `analytics_id_key_version` is present in the envelope whenever properties include an entity hash, absent when there are no entity hashes, and never duplicated in `properties_json`.

## Failure isolation checks

1. With `ANALYTICS_ENABLED=true` and a missing or short HMAC key, complete a fake-provider payment; Order, PaymentAttempt, and Access must still commit while analytics rows may be absent.
2. Use the controlled server-side analytics-writer failure test double; confirm the same domain outcome and that a later paid callback/status refresh creates the two canonical events without a second Access.
3. Trigger a WEBPAY invalid callback and unavailable status response while analytics is misconfigured; each route response must remain safe and payment/access state must stay unchanged.
4. Trigger a fake checkout provider failure while the writer fails; Order and PaymentAttempt must become `FAILED`, and the original provider error must remain the returned error.

## Expected limitations

This slice has no frontend funnel, external sink, worker, reconciliation job, retention job, dashboard, historical backfill, or HMAC rotation command. Production enablement remains prohibited pending review.
