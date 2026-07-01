# Phase 7 Attempt Runtime Report

## Status

Phase 7 is complete for attempt runtime scope.

Implemented:

- Student signed cookie/session after `POST /api/students/identify`.
- Attempt start:
  - `POST /api/attempts/start`.
- Attempt restore/view:
  - `GET /api/attempts/[attemptId]`.
- Answer save/upsert:
  - `POST /api/attempts/[attemptId]/answers`.
- Manual completion:
  - `POST /api/attempts/[attemptId]/complete`.
- Timer expiration:
  - `POST /api/attempts/[attemptId]/expire`.
- Public attempt page:
  - `/attempts/[attemptId]`.
- Snapshot creation at attempt start.
- FIFO Access selection by nearest `expiresAt`, then oldest `createdAt`.
- Attempt decrement inside transaction.
- DB-level unique partial index preventing more than one active `started` attempt per student/test.
- Active attempt responses hide correct answers, points, scoring rule and explanation.

## Scope Rules Preserved

- Student still has no password and no personal account.
- Attempt APIs require signed student cookie and verify ownership.
- Refresh/second start returns existing started attempt and does not decrement another attempt.
- Correct answers stay in snapshot but are not returned during active attempt.
- Answers can be changed only while attempt status is `STARTED`.
- Backend checks timer expiration before marking attempt `EXPIRED`.
- Scoring and result page are intentionally not implemented here; they belong to the next module.

## How To Check

1. Identify student email on a public test page.
2. Ensure the email has Access.
3. Click `Начать тест`.
4. Refresh the attempt page; the same attempt should open.
5. Go back to the test page and click start again; it should restore the same attempt.
6. Save/change answers.
7. Complete the attempt.
8. Try saving another answer; API should reject it.
9. Start is blocked if there is no active Access.

## Checks

Required checks for this phase:

- `prisma validate`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Remaining Risks

- Manual browser testing still needs running PostgreSQL and seeded/published data.
- Result page and scoring are the next module, so completed attempts currently show a completion state without calculated score.
- The student session currently uses a signed cookie with 7-day TTL; if product requirements change, TTL can be tightened.
