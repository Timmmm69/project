# Phase 6 Payments, Accesses And Access Codes Report

## Status

Phase 6 is complete for MVP development scope with mock payments.

Implemented:

- Public payment creation:
  - `POST /api/payments/create`.
- Mock payment webhook:
  - `POST /api/payments/webhook/mock`.
- Payment status endpoint:
  - `GET /api/payments/[paymentId]/status`.
- Public one-time access code activation:
  - `POST /api/access-codes/activate`.
- Admin payment list and detail:
  - `GET /api/admin/payments`;
  - `GET /api/admin/payments/[paymentId]`.
- Admin access list, manual access and revoke:
  - `GET /api/admin/accesses`;
  - `POST /api/admin/accesses/manual`;
  - `POST /api/admin/accesses/[accessId]/revoke`.
- Admin access code list, create and revoke:
  - `GET /api/admin/access-codes`;
  - `POST /api/admin/access-codes`;
  - `POST /api/admin/access-codes/[accessCodeId]/revoke`.
- Public test page actions for mock payment and access code activation.
- Admin dashboard block for payments, accesses and access codes.
- `PaymentProvider.MOCK` Prisma enum value and migration.
- Access code helper tests for normalization, hashing and generation.

## Scope Rules Preserved

- Payment creation only creates a `pending` payment.
- Access is created only after successful webhook, manual admin access or valid one-time code.
- Repeated successful webhook is idempotent and does not create a second Access.
- AccessCode raw value is shown once after creation and is never returned in list APIs.
- AccessCode storage uses only `codeHash`.
- Code activation email is not implemented because it is outside current MVP scope.
- Email failure is caught and logged; it must not break Access creation.
- Real Belarus payment provider is still behind the provider adapter decision.

## How To Check

Public mock payment flow:

1. Publish a test.
2. Open `/tests/[slug]`.
3. Enter student email and check access.
4. Click `Создать тестовую оплату`.
5. Click `Подтвердить тестовую оплату`.
6. Check access again; it should become available.

Access code flow:

1. Log in to `/admin`.
2. Select a test.
3. Create an access code and copy the shown code.
4. Open `/tests/[slug]`.
5. Enter student email, paste the code and activate it.
6. The same code must fail on second activation.

Manual access flow:

1. Log in to `/admin`.
2. Select a test.
3. Issue manual access to an email.
4. Open `/tests/[slug]` and check access with that email.

## Checks

Required checks for this phase:

- `prisma validate`
- `tsc --noEmit`
- `vitest run`
- `eslint .`
- `next build`

## Remaining Risks

- Real payment provider is not selected yet. Mock webhook is for local development only.
- Webhook signature verification must be added when the real provider is chosen.
- Manual browser testing needs a running PostgreSQL database and seeded data.
- Admin UI is intentionally functional, not polished; a visual UI pass can happen later without changing business logic.
