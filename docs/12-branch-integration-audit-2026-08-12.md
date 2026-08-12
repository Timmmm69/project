# Branch integration audit — 2026-08-12

## Result

- Integration base: GitHub `main` at `adf2355`.
- Integration branch: `codex/integrate-payment-main-20260812`.
- All 28 topic pull requests (`#1`–`#28`) were already merged into GitHub `main` and were not merged again.
- 27 local topic tips match their merged PR heads. The remaining local tip for PR `#1` is one CI/lockfile commit behind the merged PR head; that change is already in GitHub `main`.
- 60 payment-program commits were replayed from the unpublished local `main` in their original order.
- The preliminary estimate was 64 commits; the exact ancestry audit found 63 source commits absent from GitHub `main`: 60 retained and the three superseded foundations listed below.

## Deliberately not replayed

Three old foundation commits were superseded by the later implementations already accepted through PRs `#2`–`#7`:

- `4014eee` — verified student session foundation;
- `6cdab4a` — recovery backend foundation;
- `7b94ab2` — recovery continuation and destination guards.

Their later payment work and documentation were retained. Replaying these three code foundations would have duplicated squash-merged work and weakened newer contracts from GitHub `main`.

## Conflict policy applied

Conflicts were resolved in this order: Final MVP Spec v2, approved decisions, accepted GitHub `main` contracts, then the unpublished payment implementation. In particular, the integration retains:

- strict transactional proof of the Order → Payment → Access relationship;
- verified-session and recovery destination guards;
- the pre-attempt screen, without creating an attempt during payment access claim;
- immutable commercial order snapshots;
- payment idempotency, backend analytics and sanitized provider payloads;
- the later UX, analytics and infrastructure work already present on GitHub.
- the accepted recovery-access panel alongside the newer verified-email payment checkout.

## Uncommitted work from the original workspace

The original workspace was left untouched. Its uncommitted files were classified as follows:

- excluded as generated or service data: `next-env.d.ts`, `.serena/`, `tmp/`;
- excluded as stale or unverifiable documentation: `DESIGN.md`, `docs/00-current-project-state.md`, the local QA commit-SHA edit;
- excluded as unrelated visual redesign: catalog/layout/global-style edits, `public/images/exam-prep-study.png`, and `src/app/icon.svg`;
- excluded as unnecessary build-policy changes: `pnpm-workspace.yaml` (the frozen install already succeeds without them).

These files remain available in the original workspace and can be reviewed in a separate design change. None is required for the payment integration or current MVP contracts.
