# Phase 5 Public Student Flow Report

## Status

Phase 5 is complete for MVP scope.

Implemented:

- Public catalog at `/`.
- Public test page at `/tests/[slug]`.
- Public tests API:
  - `GET /api/public/tests`;
  - `GET /api/public/tests/[slug]`.
- Student email identification:
  - `POST /api/students/identify`.
- Backend-only access check:
  - `POST /api/access/check`.
- Access states:
  - `can_start`;
  - `continue_attempt`;
  - `no_access`;
  - `expired`;
  - `revoked`;
  - `no_attempts`.
- Public serializer that does not expose admin-only fields like `status`, `deletedAt`, or `createdByAdminId`.
- Unit test for public test serialization.

## Scope Notes

- This phase does not create payments, access codes, manual access, attempts, or scoring.
- The start/continue buttons are intentionally not implemented yet. They belong to later phases.
- Access is checked only on the backend.
- Catalog and test pages show only `published` tests.

## Checks

Passed:

- `prisma validate`
- `tsc --noEmit`
- `vitest run`
- `eslint .`
- `next build`

Unit tests: 17 passed.

## Remaining Risks

- Manual browser testing is still needed with a running dev server and seeded/published test.
- In the next phase, payment/manual/code access creation must connect to the access states implemented here.
- Attempt start must still enforce access on the backend and must not rely on the UI state.
