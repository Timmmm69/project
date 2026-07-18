# INF-01B runtime readiness boundary v1

## Baseline and scope

This boundary is based on exact `main` commit
`1dbb638eaa90449c8e6dd0f2cc29704129fd4a37`.

INF-01B separates process liveness from deployment readiness. It preserves the existing static
`GET /api/health` endpoint and adds `GET /api/health/ready`. Readiness covers exactly two areas:
the existing production runtime configuration contract and PostgreSQL availability. It does not
activate production behavior or change any product, payment, email, recovery, analytics, or
authentic-test workflow.

## Liveness contract

`GET /api/health` remains a static process-liveness endpoint. While the application can serve an
HTTP request, it returns status `200` and exactly:

```json
{
  "success": true,
  "data": {
    "service": "ce-ct-online-tests-mvp",
    "status": "ok"
  }
}
```

Liveness does not validate runtime configuration, query PostgreSQL, inspect migrations, invoke
external services, or depend on the readiness primitive. There is no `/api/health/live` alias.

## Readiness contract

`GET /api/health/ready` first validates an explicitly supplied, server-side environment map with
`validateProductionRuntimeConfig`. A valid report permits one PostgreSQL probe. An invalid report
stops evaluation before the database. There are no query-string modes and no alternate readiness
route.

The immutable internal result vocabulary is closed:

- `READY`
- `NOT_READY / CONFIGURATION_INVALID`
- `NOT_READY / DATABASE_UNAVAILABLE`

Evaluation is fail-closed and ordered:

1. Invalid runtime configuration returns `CONFIGURATION_INVALID`; the database probe is not called.
2. Valid runtime configuration calls the injected database probe exactly once.
3. A `true` probe result returns `READY`.
4. A `false`, rejected, or thrown probe returns `DATABASE_UNAVAILABLE` without retry.

Internal reasons are not serialized into HTTP responses.

## PostgreSQL probe contract

The production probe uses the existing Prisma client for one logical, read-only `SELECT 1`. It does
not write, open a transaction, retry, or access product tables or records. It does not check payment,
email, recovery, analytics, authentic-test, or provider state. The probe catches database failures,
does not log them in readiness code, and returns only a boolean. The shared Prisma client retains
warning output. Raw Prisma error stdout is disabled; Prisma errors are emitted as events and mapped
to the single fixed operational signal `Database operation failed.`. The handler never logs or
serializes the raw event payload. It is installed only when a new singleton client is created, so
development reuse does not add duplicate listeners. Production and development use the same safe
redaction policy, and callers still receive thrown Prisma failures normally. The primitive accepts
an injected probe for tests; the production route is statically wired to the canonical Prisma probe
and exposes no request-controlled override.

## Security and privacy boundary

Environment values remain server-side. Neither success nor failure exposes the internal readiness
outcome, runtime environment, validator issue codes, environment variable names, URLs, database or
Prisma diagnostics, stack traces, timings, credentials, providers, or analytics state. Readiness
code does not log environment values or database error text.

Both readiness responses include:

```text
Cache-Control: no-store
Referrer-Policy: no-referrer
```

On readiness success, status is `200` and the exact body is:

```json
{
  "success": true,
  "data": {
    "service": "ce-ct-online-tests-mvp",
    "status": "ready"
  }
}
```

Both configuration failure and database failure return status `503` and the same exact body:

```json
{
  "success": false,
  "error": {
    "code": "SERVICE_NOT_READY",
    "message": "Service is not ready."
  }
}
```

No `details` field is present.

## Automated verification

Unit coverage proves configuration-first ordering, zero database calls for invalid configuration,
at-most-once probing, success/false/rejection mappings, immutable results, exact HTTP bodies and
headers, failure indistinguishability, diagnostic non-disclosure, and the unchanged independent
liveness contract.

The guarded PostgreSQL integration test is
`tests/integration/runtime-readiness.test.ts`. It runs only when
`RUN_INF01B_READINESS_INTEGRATION=true`, uses the synthetic `inf01b_readiness_ci` schema, confirms
the real read-only probe, obtains `READY` from valid synthetic configuration, verifies representative
synthetic product data is unchanged, and confirms a rejected injected probe maps safely to
`DATABASE_UNAVAILABLE`. CI applies the repository's existing migrations to that synthetic schema
only as test setup and then runs the guarded file.

## Manual smoke

1. Request `/api/health` and confirm the existing exact `200` response.
2. Make PostgreSQL unavailable and confirm `/api/health` still returns that response.
3. With valid server configuration and reachable PostgreSQL, request `/api/health/ready` and confirm
   the exact `200` response.
4. Test invalid configuration and unavailable PostgreSQL separately; confirm each returns the same
   exact safe `503` response.
5. Confirm all readiness responses include `no-store` and `no-referrer`.
6. Confirm response bodies and console output contain no secrets or internal diagnostics.

## Rollback

Revert the single INF-01B implementation commit. This removes the readiness route, primitive,
tests, CI step, and this document while leaving the pre-existing liveness endpoint unchanged. No
data rollback or migration rollback is required because INF-01B adds no schema or product-data
change.

## Known exclusions

INF-01B itself does not inspect `_prisma_migrations`, migration names or checksums, table or column
presence, or startup state. It does not run migrations at application startup, add startup
enforcement, check external providers, or activate production analytics or any other production
feature. Its dependent migration proof is defined by the
[INF-01C runtime migration compatibility boundary](./runtime-migration-compatibility-v1.md), which
extends readiness after the connectivity step without changing this INF-01B contract.
