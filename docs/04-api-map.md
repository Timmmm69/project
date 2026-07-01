# API Map

API строится вокруг групп из Final MVP Spec v2.

## Public

- `GET /api/public/tests`
- `GET /api/public/tests/:slug`

## Student

- `POST /api/students/identify`
- `POST /api/access/check`

## Payment

- `POST /api/payments/create`
- `POST /api/payments/webhook/:provider`
- `GET /api/payments/:payment_id/status`

## Access codes

- `POST /api/access-codes/activate`
- `GET /api/admin/access-codes`
- `POST /api/admin/access-codes`
- `POST /api/admin/access-codes/:access_code_id/revoke`

Revocation is listed in endpoints, but Final MVP Spec v2 places revoke in later priority. Implement only if needed for P0 flow or explicitly approved.

## Attempts

- `GET /api/tests/:test_id/pre-start?email=...`
- `POST /api/attempts/start`
- `GET /api/attempts/:attempt_id`
- `POST /api/attempts/:attempt_id/answers`
- `POST /api/attempts/:attempt_id/complete`
- `POST /api/attempts/:attempt_id/expire`

## Results

- `GET /api/results/:attempt_id`

## Admin tests

- `GET /api/admin/tests`
- `POST /api/admin/tests`
- `GET /api/admin/tests/:test_id`
- `PATCH /api/admin/tests/:test_id`
- `DELETE /api/admin/tests/:test_id`
- `POST /api/admin/tests/:test_id/publish`
- `POST /api/admin/tests/:test_id/hide`
- `GET /api/admin/tests/:test_id/publish-check`

## Admin questions

- `GET /api/admin/tests/:test_id/questions`
- `POST /api/admin/tests/:test_id/questions`
- `PATCH /api/admin/questions/:question_id`
- `DELETE /api/admin/questions/:question_id`
- `PATCH /api/admin/questions/:question_id/order`

## Admin import

- `GET /api/admin/import/template`
- `POST /api/admin/tests/:test_id/import/validate`
- `POST /api/admin/import/:import_job_id/commit`
- `GET /api/admin/import/:import_job_id/errors`

## Admin operations

- `GET /api/admin/payments`
- `GET /api/admin/payments/:payment_id`
- `GET /api/admin/accesses`
- `POST /api/admin/accesses/manual`
- `GET /api/admin/attempts`
- `GET /api/admin/attempts/:attempt_id`

`resend-link` and CSV exports are P0.5 unless explicitly approved.
