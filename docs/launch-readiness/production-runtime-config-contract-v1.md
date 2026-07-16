# Production Runtime Configuration Contract v1

## Version

1.0

## Date

2026-07-16

## Status

DRAFT IMPLEMENTATION EVIDENCE — CENTRAL REVIEW REQUIRED — NO PRODUCTION ACTIVATION

## Baseline SHA

`f309de1edbae197fddd426d388fa03e51365c09e`

## Scope

This scope adds a provider-independent, pure, fail-closed configuration contract foundation. It classifies an explicitly supplied environment map and returns an immutable report containing only a canonical environment, `VALID` or `INVALID`, and ordered unique closed issue codes.

The contract is not connected to application startup, routes, middleware, Next.js configuration, package scripts, CI, deployment, or any provider runtime.

Mobile relevance: `N/A — no UI or HTTP endpoint is changed.`

## Environment classification matrix

| Execution mode | Deployment label | Canonical environment | Result |
| --- | --- | --- | --- |
| `development` / `dev` | absent or development alias | `development` | valid |
| `test` | absent or `test` | `test` | valid |
| `production` / `prod` | absent or production alias | `production` | valid |
| `production` / `prod` | `preview`, `stage`, or `staging` | `staging` | valid |
| any other combination | any | none | invalid |

Only `NODE_ENV`, `APP_ENV`, `DEPLOYMENT_ENV`, and `VERCEL_ENV` participate in classification. `NODE_ENV` is the execution mode. The other three keys are equal-status deployment labels: conflicting canonical labels are rejected without hidden priority. Unknown non-empty labels are rejected, and raw labels are never returned.

## Core required areas

The following areas are required for canonical `staging` and `production` environments:

| Area | Contract |
| --- | --- |
| Application origin | Absolute HTTPS URL, root path only, without credentials, query, or fragment |
| Database configuration | Parseable URL using the `postgres:` or `postgresql:` protocol; no connection is attempted |
| Session secret | Present, at least 32 UTF-8 bytes, and free of the closed placeholder markers |
| Access-code pepper | Present, at least 32 UTF-8 bytes, free of the closed placeholder markers, and byte-distinct from the session secret |
| Admin secret | A non-empty plaintext admin password is forbidden; a password hash is not required by this scope |
| Verified commercial session | `off` requires no key-ring parsing; `shadow` and `enforce` delegate validation to the existing verified-session parser |

Development and test do not apply the production-like core requirements. This permits local HTTP origins without weakening staging or production.

## Production-like forbidden modes

The staging/production contract rejects:

- mock-payment activation or mock provider selection;
- local fake commercial provider activation;
- commercial checkout or WebPay sandbox activation;
- recovery activation or fake/test recovery mailer modes;
- any exact `RUN_`-prefixed key with normalized value `true`.

These checks inspect only the named values and the exact `RUN_` prefix. Other environment values are not scanned.

## Closed issue vocabulary

The ordered, unique issue vocabulary is:

1. `ENVIRONMENT_INVALID`
2. `CORE_APP_ORIGIN_INVALID`
3. `CORE_DATABASE_CONFIGURATION_INVALID`
4. `CORE_SESSION_SECRET_INVALID`
5. `CORE_ACCESS_CODE_PEPPER_INVALID`
6. `CORE_SECRET_REUSE_FORBIDDEN`
7. `CORE_PLAINTEXT_ADMIN_SECRET_FORBIDDEN`
8. `UNSAFE_PAYMENT_TEST_MODE`
9. `UNSAFE_COMMERCIAL_TEST_MODE`
10. `UNSAFE_RECOVERY_MODE`
11. `UNSAFE_TEST_EXECUTION_MODE`
12. `VERIFIED_SESSION_CONFIGURATION_INVALID`

No per-variable issue codes are generated.

## Security/privacy boundary

The validator accepts a caller-supplied readonly map and does not read the global environment. It performs no logging and no console, network, database, filesystem, email, or provider operation. Reports contain no raw values, environment variable names, URLs, database details, secret properties, provider identifiers, email, token, cookie, answer, question, or payment credential.

Verified-session parser failures are mapped to one safe issue. Parser error codes, key versions, and key material remain internal. Analytics configuration is deliberately excluded: the contract does not read analytics variables, and changing them does not alter the report.

## Testing evidence

Evidence recorded from the exact bounded branch:

- focused unit/integration suite: PASS — 2 files, 64 tests;
- full test suite: PASS — 38 files and 1,053 tests passed; 8 database-dependent files and 166 tests skipped by their existing guards;
- typecheck: PASS;
- lint: PASS;
- production build: PASS;
- diff check: PASS.

The suites use only synthetic local fixtures. They require no PostgreSQL, Prisma client, network, email, production data, production credentials, or provider request.

## Manual smoke

The bounded synthetic-fixture suite covers:

- valid development, test, staging, and production;
- conflicting and unknown environments;
- invalid application and database URLs;
- weak, placeholder, and reused secrets;
- plaintext admin password;
- mock payment, fake commercial provider, and sandbox checkout activation;
- recovery and `RUN_` activation;
- valid and invalid verified-session `shadow` and `enforce` modes.

Manual smoke result: PASS through the 64-test bounded synthetic-fixture suite.

## Rollback

Revert the single bounded commit. No database, migration, deployment, feature-flag, or provider rollback is required.

## Known exclusions

This scope is not:

- startup enforcement;
- liveness;
- readiness;
- database connectivity proof;
- migration proof;
- deployment configuration;
- backup/restore;
- rollback evidence;
- monitoring;
- provider approval;
- production activation.

It also does not add an HTTP endpoint, database query, application wiring, analytics event, instrumentation, log, metric, dashboard, package script, or CI change.

## Next dependent scope

`liveness/readiness boundary`
