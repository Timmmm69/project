# INF-01C runtime migration compatibility boundary v1

## Baseline and problem

This boundary is based on exact approved `main` commit
`bf5972a12c85f63893da36fea485d6a2ac36f2a4`.

INF-01B proves that production runtime configuration is valid and PostgreSQL is reachable. A
successful connectivity query alone does not prove that the database migration history is complete
or compatible with the application build. The service could otherwise report ready while an
expected migration is missing or unfinished, an applied checksum differs, or the database contains
a newer successful migration unknown to this repository.

## Scope

INF-01C extends the existing readiness primitive by one migration-compatibility step. It adds a
checked-in canonical manifest, a read-only `_prisma_migrations` probe, focused unit and PostgreSQL
integration coverage, and one adjacent CI step. It does not change the Prisma schema or any existing
`migration.sql` file, add a migration, execute migrations at runtime, or activate production.

## Canonical manifest contract

`src/server/runtime-readiness/migration-manifest.ts` is the only runtime expected-state contract.
For each repository migration it contains the exact directory name and the lowercase SHA-256 digest
of the exact `migration.sql` file bytes, in ascending canonical repository order. The array and every
entry are immutable.

The manifest is server-side checked-in source. Production runtime does not scan the filesystem,
derive expected state from environment variables, or contain database credentials. A unit test reads
the real `prisma/migrations/*/migration.sql` files only in the test environment and proves exact
membership, order, checksums, unique names, closed checksum format, and immutability.

The baseline manifest contains 14 migrations.

## Compatibility rules

Migration state is compatible only when all of these conditions hold at the same time:

1. Every manifest migration has exactly one successful non-rolled-back row with the exact name and
   checksum, non-null `finished_at`, null `rolled_back_at`, and `applied_steps_count > 0`.
2. No expected migration lacks such a successful row.
3. No successful non-rolled-back migration is absent from the manifest.
4. No unresolved row has both null `finished_at` and null `rolled_back_at`.
5. No migration name has two successful non-rolled-back rows.
6. Any other non-rolled-back row fails closed.

A historical row with non-null `rolled_back_at` is ignored only when its name is expected, a separate
valid successful non-rolled-back row exists for that expected migration, and no unresolved row exists.
Any violation produces only the internal `MIGRATION_INCOMPATIBLE` reason.

## Query boundary

The canonical production adapter uses the existing Prisma singleton for one logical read-only query
to `_prisma_migrations`. It reads only `migration_name`, `checksum`, `finished_at`, `rolled_back_at`,
and `applied_steps_count`. It does not read product tables or user data, write, start a transaction,
retry, run Prisma migration commands, invoke a shell, or scan the production filesystem.

If the query throws or the table cannot be read after connectivity succeeds, the probe returns false
and readiness fails closed as `MIGRATION_INCOMPATIBLE`. Readiness code does not log raw database
diagnostics. The existing fixed Prisma operational signal `Database operation failed.` remains the
only safe client-level error signal.

## Readiness ordering

Evaluation is sequential and fail-closed:

1. Invalid runtime configuration returns `NOT_READY / CONFIGURATION_INVALID`; neither probe runs.
2. Valid configuration runs the PostgreSQL connectivity probe once. False or thrown returns
   `NOT_READY / DATABASE_UNAVAILABLE`; the migration probe does not run.
3. Reachable PostgreSQL runs the migration probe once. False or thrown returns
   `NOT_READY / MIGRATION_INCOMPATIBLE`.
4. All three successful checks return `READY`.

There are no retries. Unit tests can inject connectivity and migration probes independently. The
production route is statically wired to the canonical adapters and has no request-controlled
override.

## HTTP non-disclosure

The public route remains `GET /api/health/ready`. Success remains status `200` with exactly:

```json
{
  "success": true,
  "data": {
    "service": "ce-ct-online-tests-mvp",
    "status": "ready"
  }
}
```

Configuration, database, and migration failures all remain status `503` with exactly:

```json
{
  "success": false,
  "error": {
    "code": "SERVICE_NOT_READY",
    "message": "Service is not ready."
  }
}
```

Both outcomes retain `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The response does
not expose internal outcomes, migration names or counts, checksums, row contents, Prisma errors,
database URLs, schemas, environments, diagnostics, or a `details` field. `GET /api/health` remains
the independent static liveness boundary.

## Security and privacy

The probe reads Prisma-owned migration metadata only. It does not access production credentials,
product records, user data, payments, recovery data, email data, analytics data, or authentic test
content. No raw error is logged or serialized, and no migration action is initiated by an HTTP
request.

## Automated tests and integration evidence

Focused unit coverage proves manifest/filesystem consistency and detectable mismatch; all compatible,
missing, unknown, checksum-mismatched, unfinished, duplicate, and historical rollback cases; ordered
probe calls; at-most-once behavior; immutable closed outcomes; exact indistinguishable HTTP responses
and headers; diagnostic non-disclosure; and independent liveness.

The guarded PostgreSQL integration is
`tests/integration/runtime-migration-compatibility.test.ts`. With
`RUN_INF01C_MIGRATION_COMPATIBILITY_INTEGRATION=true`, CI uses only the synthetic
`inf01c_migration_compatibility_ci` schema, applies current repository migrations as test setup, and
runs only that integration file. It proves the real Prisma migration history matches the manifest,
the canonical production probe returns compatible, the full primitive returns `READY`, migration
metadata and representative product data are unchanged, and an injected incompatibility maps safely.

The existing INF-01B PostgreSQL integration remains separately required.

## Manual smoke

1. With valid configuration and a reachable migrated synthetic PostgreSQL schema, confirm liveness
   returns its exact `200` and readiness returns its exact `200`, including required headers.
2. Inject a missing migration result and confirm liveness remains exact `200` while readiness returns
   the safe exact `503`.
3. Inject a checksum mismatch result and confirm readiness returns the same exact `503`.
4. Make PostgreSQL unavailable and confirm readiness returns the same exact `503` without calling the
   migration probe.
5. Inspect responses and logs for absence of names, checksums, internal outcomes, raw Prisma/database
   diagnostics, credentials, and product data.

## Rollback

Revert the single INF-01C implementation commit. This removes the manifest, compatibility probe,
third readiness step, focused tests, CI step, and this document. No database or data rollback is
required because INF-01C adds no migration, runtime migration execution, or production activation.

## Exclusions

INF-01C does not add automatic or startup migration execution, deployment-provider configuration,
container or Kubernetes probes, backups, restore, rollback automation, release-version endpoints,
monitoring, metrics, dashboards, payments, email, recovery, analytics, UX, scoring, authentic
content, Prisma schema changes, new migrations, Git hooks, production automation, or production
activation.

## Maintenance rule

Every future PR that adds or changes a Prisma migration must update the canonical manifest in the
same PR and pass both the manifest/filesystem consistency test and the guarded migration compatibility
PostgreSQL integration test. Existing applied migration files should remain immutable.
