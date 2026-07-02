# Phase 9 Report: QA Hardening

## What Was Done

- Added Playwright MVP smoke scenario:
  - creates a published fixture test;
  - checks student email access state;
  - creates and confirms mock payment;
  - starts an attempt;
  - answers all MVP question types;
  - completes the attempt;
  - checks the result page.
- Made Playwright server readiness use `/api/health` so skipped e2e tests do not require PostgreSQL.
- Added default Playwright web server env for local test runs:
  - `DATABASE_URL`;
  - `SESSION_SECRET`;
  - `ENABLE_MOCK_PAYMENTS=true`.
- Updated public test access UI copy so it no longer says that start/continue will appear in a future phase.
- Re-ran core automated checks.

## E2E Run Modes

Default mode:

```bash
pnpm test:e2e
```

This starts the dev server and skips DB-dependent MVP smoke unless `RUN_E2E_WITH_DB=true` is set.

Full DB-backed smoke mode:

```bash
RUN_E2E_WITH_DB=true pnpm test:e2e
```

Requirements:

- PostgreSQL is running.
- Prisma migrations are applied.
- `DATABASE_URL` points to the local test/development database.

## Manual Acceptance Checklist

Admin:

- Admin can log in.
- Admin can create a test.
- Admin can add questions of all 3 MVP types.
- Admin can import XLSX/CSV and commit only valid imports.
- Admin can publish a valid test.
- Admin can issue manual access.
- Admin can create an access code and see the raw code only once.
- Admin can see payments, accesses, codes, attempts and result details.

Student:

- Published test appears in catalog.
- Draft/hidden/archived tests do not appear publicly.
- Student can identify by email without password.
- Student cannot start without access.
- Student can receive access through mock payment.
- Student can receive access through manual access.
- Student can activate a valid one-time code.
- Refreshing a started attempt restores it and does not spend another attempt.
- Student can change answers before completion.
- Student cannot change answers after completion.
- Timer expiration completes and scores the attempt.
- Result page shows score, percent, level, topics, recommendations and mistakes.
- Correct answers are visible only after completion.

Security/Business Rules:

- Access is created only after payment success, manual admin action or valid code.
- Repeated webhook does not create a second access.
- Access code hash is stored, raw code is not stored.
- Scoring is backend-only.
- Snapshot protects old results from later test edits.
- Mock payments remain disabled in production.

## Checks Run

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`

`pnpm test:e2e` passed in default skipped mode because no local PostgreSQL server is available in this environment.

## Remaining Risks

- Full DB-backed e2e smoke still needs to be run once PostgreSQL is available.
- Real payment provider integration is still behind Gate C.
- Real CE/CT scale tables are still behind Gate D.
- Launch content, final email texts and legal texts are still behind Gate E.
- UI is functional MVP-level; visual polish remains a separate pass.
