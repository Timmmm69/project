# ACC-01A Recovery Specification v1

## 1. Version, date and status

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Date | 2026-07-13 |
| Scope | ACC-01A specification only |
| Implementation | Not started; the approved destination-session architecture permits sequential bounded dev/test implementation tasks |
| Production activation | Prohibited |
| ACC-01B | Separate blocked gate; not closed by this document |
| Status | APPROVED ACC-01A RECOVERY SPECIFICATION — SESSION ARCHITECTURE APPROVED — BOUNDED DEV/TEST IMPLEMENTATION MAY START — PRODUCTION ACTIVATION PROHIBITED |

This file is a product, security, data, API and UX contract for a future bounded implementation. It does not change an application, database, state machine, route, feature flag, provider configuration or launch status. It does not prove email delivery, privacy approval, accessibility compliance or production readiness.

## 2. Canonical sources

Source priority for this specification:

| Priority | Source | Use in ACC-01A |
| --- | --- | --- |
| 1 | Current Project instructions and approved Commercial Product Contract in the task brief | Narrow current product truth: 10 BYN, one Access/Attempt, 90-day start window, 120-minute timer, 12-month Result retention, primary-only limited launch |
| 2 | `stage-7-launch-control-v1.md` from `acc-01a-context-5-of-6 (3).zip` | ACC-01A/ACC-01B gate split, default-off, fake/dev-only delivery and production prohibition |
| 3 | Approved current UX sources: `ux-target-flow-spec-v1.md`, `ux-copy-pack-v1.md`, `ux-core-wireframes-v1.md`, `ux-visual-system-v1.md` and supplied `ux-state-wireframes-v1.md` | Canonical ACC-01/ACC-02/REC-01 states, 16 SWF IDs, existing copy keys, conditional activation, focus/mobile contracts |
| 4 | Approved authentic-mode, scoring and Result non-disclosure decisions reflected in current Project sources and repository main | Authentic Part A partial scoring; primary-only limited Result; no question-level scoring, correct/accepted answers, explanations or scaled score |
| 5 | Repository `main` `6cbdb2d2fdb58977a0a648e7e956edf95521a907`, inspected read-only | Current physical models, session mechanism, PRE/ATT/RES authorization, timer/result serialization and six implemented analytics events |
| 6 | Generic Final MVP sources, including `docs/00-final-mvp-spec-v2.md` and `docs/11-approved-decisions-current.md`, only where they do not conflict with newer narrower decisions | Generic fallback scope, backend ownership, transactions, snapshot and general security |
| 7 | Supporting reports and module docs | Detail only when consistent with priorities 1–6 |

Conflict rule: newer and narrower approved commercial/authentic/launch decisions govern ACC-01A; generic Final MVP rules apply only where compatible. P0.5/P1/desirable/future behavior remains excluded unless separately approved. Generic MVP remains a separate mode and must not be changed.

Repository facts used by the design:

- `CommercialProduct`, `CommercialOrder`, `CommercialPaymentAttempt`, `Access` and `Attempt` exist.
- A separate Prisma `Result` model does not exist. Result is a logical, persisted projection of a terminal `Attempt` and its scoring/snapshot fields, exposed through `RES-01`.
- Commercial `Access` has `commercialProductId`, `commercialOrderId`, `grantedAt` and `startDeadlineAt`; generic legacy access uses `expiresAt`.
- `Attempt.startedAt` plus the snapshot duration is server timer authority. Recovery must not write these values.
- Main `6cbdb2d...` implements `student_session` as a seven-day HMAC-signed HttpOnly cookie issued by `setStudentSessionCookie`; `requireStudent()` validates signature/expiry and re-reads User by exact id/email/role/non-deleted status.
- PRE/ATT/RES APIs on main require `student_session`; Attempt/answer/completion/result services additionally constrain records by `student.id`. Direct route/entity knowledge is not authorization.
- `POST /api/students/identify` can currently issue that same `student_session` from email input without OTP proof. Therefore a verified continuation exchange cannot safely rely on the current cookie unchanged: this is a `BLOCKING IMPLEMENTATION DEPENDENCY`.
- Main public Result serialization hides authentic correct/accepted answers and explanations, but still includes question-level fields and scaled-score fields; the primary-only limited-launch serializer remains an implementation gap.
- The approved plan has 32 analytics events while main implements six. This is an implementation gap, not a source conflict; ACC-01A does not expand either registry.
- Authentic Part A scoring on main is canonical: exact selection earns 2, one selection error earns 1, and two or more errors earn 0. Recovery never changes or recomputes it.

## 3. Problem, goals and success boundary

### Problem

The paid product intentionally has no password-based student account. A returning buyer can lose the local student session or Order cookie and currently lacks a safe, explicit way to reopen an unused Access, resume an active Attempt or reopen the existing Result. Treating raw email as authorization would create:

- email/account/order/access enumeration;
- takeover of another buyer's Access, active Attempt or Result;
- timer reset or duplicate Attempt creation during recovery;
- duplicate purchase pressure when a paid Order or Access already exists;
- leakage of email, OTP, recovery tokens, answer keys or score data through logs and analytics.

ACC-01A must solve the technical recovery contract in dev/test without claiming production email delivery. ACC-01B remains responsible for production provider selection, privacy review, DNS, delivery QA and explicit activation approval.

### Goals

1. Verify control of the adult buyer's normalized email with a one-time server-generated OTP.
2. Return the same neutral public request response for existing and nonexistent identities.
3. Establish a short-lived, server-verifiable, recovery-only session whose raw token is never persisted.
4. Resolve exactly one canonical state for one approved Commercial Product/Test scope.
5. Reuse existing Order/Access/Attempt/Result truth without creating or repairing business entities.
6. Preserve the original active Attempt timer and stored terminal result.
7. Provide deterministic fake/dev delivery and test inspection without a production provider.
8. Fail closed behind an independent default-off flag and forbid production activation.

Success for this document means one structurally sound, centrally reconciled contract. The destination-session architecture is approved in <code>acc-01a-session-bridge-decision-v1.md</code>, so sequential bounded dev/test implementation tasks may start. This approval does not make ACC-01A or ACC-01B READY and does not authorize production activation.

## 4. Product decisions and non-goals

### Fixed product decisions

- Recovery identity is the email controlled by the adult buyer; normalize with trim plus lowercase, using the same canonical email rules as existing User/Order ownership.
- Knowledge of an email, email hash, masked email, URL, client flag, AccessCode text or Order lookup token is not ownership proof.
- Recovery creates no purchase, Order, PaymentAttempt, Access, Attempt or Result.
- Recovery never changes payment or access state machines, `checkout_flow_id`, Order lookup tokens, attempts counters, snapshots, answers, scoring or lookup tables.
- Recovery never resets `startedAt`, `endsAt`, remaining time, `finishedAt` or stored result fields.
- One verified resolver response exposes exactly one canonical recovery state and one permitted next action family.
- Conflicting or unreadable records resolve to `support_required`; they are not silently repaired.
- Authentic Part A partial scoring remains canonical and unchanged.
- The first limited paid launch remains primary-result-only: no question-level scoring, correct/accepted answers, explanations or scaled score. Resolver returns no score or answer payload.
- Before ACC-01B, `recovery.email_route_cta` and `recovery.email_route_note` are absent from public REC-01 with no layout gap. ACC-01A dev/test is entered only by a direct internal dev/test URL, test harness or another non-public entry point. Support CTA remains absent until support activation.

### Non-goals

Production email provider; SMTP credentials; DNS/SPF/DKIM/DMARC; delivery proof; real-user activation; privacy/legal vendor sign-off; support-admin recovery; edits to Order/Payment; replacement/free second Access; password/account system; student history; cross-product result list; checkout/payment changes; automatic refunds; scoring/lookup/content changes; new analytics events; dashboard; Figma; application code; Prisma schema; migration; tests; configuration; commit or other Git mutation.

## 5. User flow

1. A returning user opens canonical `REC-01` with no valid local student or Order session.
2. With ACC-01A dev/test flag enabled, an internal direct URL/test harness/non-public entry enters `ACC-01`. Public REC-01 still shows `recovery.code_route_cta` first and `recovery.catalog_cta` second; email route/note remain absent until ACC-01B.
3. The user enters the adult buyer email. The backend validates format, normalizes it, applies abuse controls, creates or safely reuses a challenge and returns a neutral response.
4. Fake/dev mailer receives an OTP in dev/test. Public UI moves to `ACC-02/code_sent` regardless of whether User, Order or Access exists.
5. The user submits the OTP. Backend checks the challenge cookie, digest, expiry, one-time status and counters atomically.
6. Success consumes the challenge, rotates any pre-existing recovery session and sets a new HttpOnly recovery-only cookie.
7. `REC-01/resolving` reads the verified email and immutable Product/Test scope from the server-side session.
8. Resolver reads current backend truth and returns exactly one of:
   - `access_unstarted` → existing `PRE-01`;
   - `attempt_active` → existing `ATT-01`, with original timer;
   - `result_available` → existing `RES-01`, with stored result;
   - `start_window_expired`;
   - `no_access`;
   - `support_required`.
9. Resolver returns only the canonical state and a safe `CONTINUE` action; it never returns a directly authorizing entity URL.
10. A server-side continuation operation revalidates recovery session plus exact email/Product/Test/Access/Attempt scope, exchanges it for an ordinary verified student authorization mechanism, revokes recovery session and generates the destination for PRE-01, ATT-01 or RES-01.
11. Destination PRE/ATT/RES re-runs normal student authorization and ownership checks. Recovery cookie is never accepted by answer-save, completion, payment or provider APIs.
12. Explicit invalidation, expiry, continuation exchange or security revocation ends recovery authority.

An unknown network outcome never licenses a new Order/Access/Attempt/Result. The client first reads backend truth or safely retries the same idempotent operation.

## 6. Canonical state mapping

No screen, canonical state or copy key is added. The base wireframes are `WF-ACC1-D/M-01`, `WF-ACC2-D/M-01` and `WF-REC-D/M-01`.

Common requirements for every row: desktop preserves approved container width and DOM order; mobile 320–767 px uses one-column full-width controls, safe areas and no horizontal page scroll; keyboard order follows visual/DOM order; static headings are not ordinary tab stops; 200% zoom must reflow without overlap or loss of actions; inactive conditional blocks collapse without gaps; no state discloses another person, full email, raw OTP/token, Order/payment details, answers, keys or scores.

### Email verification family

| State / SWF | Backend entry and visible copy keys | Actions, disabled controls and retry | Focus and announcement |
| --- | --- | --- | --- |
| `idle` / `SWF-ACC01-IDLE-01` | No in-flight challenge. `email.input.title`, `email.input.purpose`, `email.input.label`, `email.send_code_cta`, `email.back_cta`. | Primary send; secondary back. Access/Result opening forbidden. Retry obeys server cooldown/limits. | Logical entry order; field error remains attached to input; ordinary reading or one transition announcement. |
| `sending` / `SWF-ACC01-SENDING-01` | One challenge request in flight. `email.sending`. | Send is native-disabled/hidden; no double submit. Only existing safe back/cancel semantics. | Keep focus on enabled control, otherwise move once to status/heading, never spinner; one polite `status`. |
| `code_sent` / `SWF-ACC02-CODE-SENT-01` | Challenge created for any syntactically valid email. `email.sent_neutral`, `email.code.title`, `email.code.sent_to_masked`, `email.code.label`, `email.code.verify_cta`, `email.code.resend_cta`, `email.code.resend_wait`, `email.code.change_email_cta`. | Verify primary; resend/change secondary. Resend disabled until server cooldown; no Access disclosure. | Focus to OTP field/heading once; resend countdown is not announced each second, only when action becomes available. |
| `verifying` / `SWF-ACC02-VERIFYING-01` | One verify request in flight. `email.code.verifying`; OTP remains readable. | Verify, resend and change-email disabled/hidden; no cancel semantics that create races. | Focus stays in OTP when possible; progress does not steal focus; one `status`, no polling repetition. |
| `invalid` / `SWF-ACC02-INVALID-01` | Atomic backend mismatch with attempts remaining. `email.code.invalid`, verify/resend/change keys. | Verify primary; resend/change secondary subject to limits. Session opening forbidden. | Keep focus in OTP; error linked with `aria-describedby` and announced once. |
| `expired` / `SWF-ACC02-EXPIRED-01` | Server clock is at/after challenge expiry or challenge superseded by expiry. `email.code.expired`, resend/change keys. | Resend primary; change secondary. Old code can never verify. | Focus to error/first available action once; one error announcement. |
| `rate_limited` / `SWF-ACC02-RATE-LIMITED-01` | Challenge/source verification limiter denies operation. `email.code.rate_limited`, `email.code.change_email_cta`. | Wait; change email secondary. Verify/resend disabled; Retry-After is server authority. | Focus remains stable or moves once to blocking heading; one `alert`, no countdown chatter. |
| `verified` / `SWF-ACC02-VERIFIED-01` | Challenge consumed and an active recovery session committed. `email.code.verified`. | No identity change under this session; automatically proceed to resolver. | Move once to next standalone heading; announce verified/resolving once. |

### Access recovery family

| State / SWF | Backend entry and visible copy keys | Actions, disabled controls and retry | Focus and announcement |
| --- | --- | --- | --- |
| `unverified` / `SWF-REC01-UNVERIFIED-01` | No valid recovery session. `recovery.title`, `recovery.description`, conditional `recovery.email_route_cta` and `recovery.email_route_note`, `recovery.code_route_cta`, `recovery.catalog_cta`. | Before ACC-01B, code route primary and catalog secondary; email route absent. No resolver/state disclosure. | Heading once; route actions in visual order; ordinary reading. |
| `resolving` / `SWF-REC01-RESOLVING-01` | Valid session; one read-only resolver request in flight. `recovery.resolving`. | Wait/retry only after an error; purchase and destination actions disabled. | Keep safe focus or move once to status; one polite `status`, no polling focus moves. |
| `access_unstarted` / `SWF-REC01-ACCESS-UNSTARTED-01` | Exactly one valid Access, no Attempt, start window open, attempts available. `recovery.state.can_start`, `recovery.state.can_start_cta`. | Go to PRE-01; direct start and any duplicate purchase forbidden. Resolver retry is read-only. | Heading then CTA; one confirmed transition announcement. |
| `attempt_active` / `SWF-REC01-ATTEMPT-ACTIVE-01` | Exactly one active Attempt for the Access. `recovery.state.active_attempt`, `recovery.state.active_attempt_cta`. | Continue ATT-01. New purchase/Attempt and timer reset forbidden. | Heading then CTA; announce once that time continues. |
| `result_available` / `SWF-REC01-RESULT-AVAILABLE-01` | Exactly one readable terminal Attempt/result projection within retention. `recovery.state.result_available`, `recovery.state.result_available_cta`. | Open RES-01. Completion/scoring rerun forbidden. | Heading then CTA; one transition announcement. |
| `start_window_expired` / `SWF-REC01-START-WINDOW-EXPIRED-01` | Valid unique Access with no Attempt and server start deadline elapsed. `recovery.state.start_window_expired`, `recovery.state.start_window_expired_description`, `recovery.catalog_cta`, conditional `recovery.support_cta`. | Before support activation catalog is primary; after activation support primary and catalog secondary. Start forbidden. | Blocking heading once; conditional CTA removal must not disturb order; one alert/heading announcement. |
| `no_access` / `SWF-REC01-NO-ACCESS-01` | Verified identity and scope, no recoverable Access and no paid-without-access inconsistency. `recovery.state.no_access`, `recovery.state.no_access_description`, `recovery.state.no_access_cta`. | Open the existing product page. No hidden creation or disclosure. | Heading then CTA; ordinary/one confirmed state announcement. |
| `support_required` / `SWF-REC01-SUPPORT-REQUIRED-01` | Paid-without-access, conflicting/legacy/unreadable records or invariant breach. `recovery.state.support_required`, `recovery.state.support_required_description`, `recovery.catalog_cta`, conditional `recovery.support_cta`. | Never pay again or auto-repair. Before support activation catalog only; after activation support primary. | Focus blocking heading once; `alert` or heading focus once; raw API message forbidden. |

Temporary API failures use existing `email.send_error_neutral`, `email.code.temporary_error`, `recovery.error` and `recovery.retry_cta`; they are component/error contracts, not new canonical states.

## 7. Threat model

| Threat | Attack/failure | Required control | Evidence expected later |
| --- | --- | --- | --- |
| Email enumeration | Compare body, status, timing or delivery result for existing/nonexistent email | Same 202 schema/copy; target-email limits suppressed from public response; bounded timing normalization; no account fields | Content/status/timing comparison |
| OTP brute force | Enumerate a low-entropy code | CSPRNG, keyed digest with separate pepper, constant-time compare, per-challenge/source limits, atomic lock | Unit + integration brute-force test |
| Resend abuse | Flood recipient or create many active codes | Cooldown, rolling limits, idempotency key, one active challenge rule, previous-code invalidation | Concurrent resend test |
| Challenge replay | Reuse correct OTP | Atomic ACTIVE→VERIFIED/consumed transition; every later presentation is REPLAY/non-active and can never issue or replace a session | Replay/concurrency test |
| Parallel verification | Two correct submits race | Row lock/conditional update; exactly one request consumes OTP and issues the session, every loser gets REPLAY/non-active | Barrier integration test |
| Session fixation | Attacker pre-seeds recovery cookie | Rotate challenge and session tokens on verification; never accept client-selected session ID | Cookie before/after test |
| Stolen recovery session | Cookie exfiltration/reuse | HttpOnly, Secure in production-like, SameSite, short absolute TTL, recovery-only authorization, revocation | Cookie and scope tests |
| Wrong-email state access | Resolver query swaps email/product | Email and scope only from server session; request body cannot override; destination rechecks ownership | Negative ownership tests |
| Race with payment/access grant | Grant commits while resolver reads | Read current committed truth; retry is read-only; paid/no Access becomes support_required, never auto-grant | Transaction-boundary test |
| Race with Attempt start | Start commits during resolver | Destination start is idempotent; resolver may return adjacent compatible state; final start route returns existing Attempt | Parallel resolver/start test |
| Race with completion | Attempt completes while resolver reads | Adjacent active/result responses acceptable; destination revalidates; no scoring from resolver/GET | Parallel completion test |
| Raw email/OTP logging | Framework/provider error serializes inputs | Redaction at request boundary; structured allowlisted logs; no body/header/cookie dumps | Log scan |
| Token/PII in analytics | Generic instrumentation captures fields/query | Strict registry allowlist; no recovery emission until approved implementation; forbidden-value scans | Network/storage scan |
| Accidental production flag | Env flag enabled during deploy | Production hard prohibition independent of flag; startup/config and request fail closed; route/CTA absent | Production-config negative test |
| Recovery token used for provider/payment | Reuse token as generic credential | Dedicated cookie name, verifier and audience; commercial/provider code rejects it; no analytics join | Cross-domain negative test |
| Recovery cookie used for a 120-minute Attempt | Answer/save/complete route accepts narrow recovery authority | Mandatory continuation exchange to a verified student authorization; recovery cookie revoked after exchange and rejected by destinations | Bridge and cross-cookie negative tests |
| Unverified student-session bypass | Existing email-only identify route mints the same student cookie | `BLOCKING IMPLEMENTATION DEPENDENCY`: harden/replace the verified student-session mechanism before recovery continuation is implemented | Identify/continuation/destination authorization tests |
| Test mailbox exposure | Test endpoint becomes public | Compile/mount only in test, second test-harness guard, no production fallback, one-time pop | Route-manifest/build test |
| CSRF | Cross-site request verifies/logs out/resends | SameSite plus same-origin checks on mutations; no state-changing GET | CSRF tests |
| Database disclosure | Offline attacker cracks OTP digest | HMAC with independent secret pepper and key version; code never stored raw | Schema/fixture scan |

Section 9 parameters are fixed for ACC-01A dev/test implementation. Residual risk remains until the destination-session dependency is resolved and runtime evidence exists.

## 8. Domain and data model

These are proposed additive recovery entities for a later task. They do not alter existing payment/access/attempt state machines. “No analytics” means the raw field may never be sent; any future approved event must use its own allowlisted pseudonymous identifier.

Privacy classes: `PII-R` restricted PII, `SECRET-D` secret derivative, `SEC-R` restricted security metadata, `INTERNAL` ordinary operational metadata.

### RecoveryChallenge

| Field | Purpose / source of truth | Nullability | Privacy | Retention | Logs | Analytics |
| --- | --- | --- | --- | --- | --- | --- |
| `id` UUID | Internal server identity | required | SEC-R | 7d after terminal in ACC-01A dev/test | correlation only | no |
| `productId`, `testId` | Immutable approved scope resolved server-side | required | INTERNAL | same row | safe IDs only in restricted logs | no raw IDs |
| `emailNormalized` | Delivery and later ownership lookup; server normalization | required | PII-R | erase/delete with terminal challenge after 7d dev/test | never value | prohibited, including hash |
| `emailFingerprint` | Keyed rate-limit/dedupe lookup, never ownership proof | required | SECRET-D | challenge row 7d; limiter key no more than 24h after last window | never value | prohibited |
| `challengeTokenHash` | Digest of high-entropy HttpOnly challenge cookie | required unique | SECRET-D | until row deletion | never | prohibited |
| `challengeKeyVersion` | Non-secret verification-key selector | required | SEC-R | same row | allowlisted | prohibited |
| `otpMac`, `otpKeyVersion` | HMAC of challenge-bound OTP; raw OTP never persisted | required | SECRET-D | clear MAC at terminal or delete row | never | prohibited |
| `status` | ACTIVE/VERIFIED/EXPIRED/LOCKED/SUPERSEDED/REVOKED | required | SEC-R | 7d after terminal in dev/test | enum only | no |
| `failedVerifyCount` | Atomic brute-force counter | required, default 0 | SEC-R | same row | bucket/code only | no |
| `expiresAt`, `resendAvailableAt` | Server-clock expiry/cooldown | required | SEC-R | same row | coarse state only | no |
| `verifiedAt`, `terminalAt` | Terminal evidence | nullable | SEC-R | same row | event code only | no |
| `supersededById` | Resend lineage; new challenge invalidates old | nullable | SEC-R | same row | correlation only | no |
| `createdAt`, `updatedAt` | Database audit timestamps | required | INTERNAL | same row | coarse timestamp allowed | no |

### RecoveryVerificationAttempt

| Field | Purpose / source of truth | Nullability | Privacy | Retention | Logs | Analytics |
| --- | --- | --- | --- | --- | --- | --- |
| `id`, `challengeId` | Internal attempt and parent | required | SEC-R | 7d after terminal challenge in dev/test | restricted correlation only | no |
| `operationId` | Idempotency/dedupe for one submit | required unique | SEC-R | same row | restricted correlation | no |
| `outcomeCode` | MATCH/NO_MATCH/EXPIRED/LOCKED/REPLAY/ERROR | required | SEC-R | same row | enum allowed | no |
| `attemptOrdinal` | Monotonic challenge counter snapshot | required | SEC-R | same row | bucket only | no |
| `occurredAt` | Server time | required | INTERNAL | same row | allowed | no |

It stores neither submitted OTP, OTP digest, email, IP nor user agent. Rate-limit counters may use a separate expiring store keyed by secret HMAC of email/source; raw source identifiers are not persisted in these rows.

### VerifiedRecoverySession

| Field | Purpose / source of truth | Nullability | Privacy | Retention | Logs | Analytics |
| --- | --- | --- | --- | --- | --- | --- |
| `id` UUID | Server session identity | required | SEC-R | 7d after terminal in ACC-01A dev/test | restricted correlation only | no |
| `challengeId` | Proof lineage | required | SEC-R | same row | correlation only | no |
| `tokenHash`, `tokenKeyVersion` | Digest/key selector for random cookie; raw token never persisted | required unique | SECRET-D | clear/delete on retention | never | prohibited |
| `emailNormalized` | Verified subject bound from challenge, not client | required | PII-R | erase with session row | never value | prohibited |
| `productId`, `testId` | Immutable resolver scope | required | INTERNAL | same row | restricted ID only | no raw IDs |
| `status` | ACTIVE/REVOKED/EXPIRED/ROTATED | required | SEC-R | same row | enum only | no |
| `issuedAt`, `expiresAt` | Absolute server lifetime | required | SEC-R | same row | coarse timestamp | no |
| `lastUsedAt` | Operational theft/cleanup signal, not sliding TTL | nullable | SEC-R | same row | not per-request | no |
| `revokedAt`, `revocationCode` | Explicit invalidation reason | nullable | SEC-R | same row | enum only | no |
| `rotatedFromId` | Lineage when a new successful verification revokes an older active recovery session for the same subject/scope | nullable | SEC-R | same row | correlation only | no |

No IP/user-agent binding is proposed: it produces brittle false rejections and additional sensitive data. Theft mitigation relies on cookie properties, short absolute TTL, narrow authorization and revocation; changing this requires approval.

### RecoveryDeliveryRecord (optional, dev/test only)

| Field | Purpose / source of truth | Nullability | Privacy | Retention | Logs | Analytics |
| --- | --- | --- | --- | --- | --- | --- |
| `id`, `challengeId` | Delivery correlation | required | SEC-R | no more than 24h in dev/test | correlation only | no |
| `adapterMode` | FAKE/TEST | required | INTERNAL | same row | enum | no |
| `deliveryStatus` | ACCEPTED/FAILED/UNKNOWN | required | SEC-R | same row | enum | no |
| `safeFailureCode` | Closed internal failure code | nullable | SEC-R | same row | enum | no |
| `createdAt`, `consumedAt` | Delivery/test inspection timing | required/nullable | INTERNAL | same row | allowed | no |

The record contains no recipient duplicate, body, subject, raw OTP or provider payload. The raw OTP exists only in the isolated in-memory test mailbox until one-time retrieval/TTL, never in PostgreSQL or ordinary logs.

### RecoverySecurityEvent

| Field | Purpose / source of truth | Nullability | Privacy | Retention | Logs | Analytics |
| --- | --- | --- | --- | --- | --- | --- |
| `id`, `correlationId` | Restricted incident correlation | required | SEC-R | 30d in ACC-01A dev/test | identifier allowed | no |
| `eventCode` | CHALLENGE_REQUESTED, VERIFY_REJECTED, RATE_LIMITED, SESSION_ISSUED/REVOKED, RESOLVER_CONFLICT | required | SEC-R | same row | enum allowed | no |
| `challengeId`, `sessionId` | Optional internal relationship | nullable | SEC-R | same row | restricted only | no |
| `reasonCode` | Closed allowlisted reason; no free text | nullable | SEC-R | same row | enum allowed | no |
| `occurredAt` | Server time | required | INTERNAL | same row | allowed | no |

This is operational security/audit evidence, not `AnalyticsEvent` and not a replacement for existing `EventLog`.

## 9. Token, challenge and session lifecycle

### Challenge lifecycle

1. Server validates only format and approved Product/Test scope before creating a challenge; it does not branch public output on User/Order/Access existence.
2. It generates independent CSPRNG values: high-entropy challenge cookie token and OTP. It persists only `challengeTokenHash` and a challenge-bound OTP HMAC/MAC with key version.
3. The raw challenge token is set HttpOnly; raw OTP is passed directly to the adapter and then discarded by application code.
4. Repeating the same request with the same idempotency key returns the same public outcome and does not send a second code.
5. A legitimate resend after cooldown creates a new challenge/OTP and atomically marks the prior ACTIVE challenge SUPERSEDED. All older codes fail.
6. Server time is sole authority for expiry, cooldown and Retry-After. Client timers are presentation only.
7. Verification locks/conditionally updates the challenge, compares in constant time, increments the counter and writes the attempt outcome in one transaction.
8. On success, one transaction consumes the OTP, changes challenge to VERIFIED, revokes any older ACTIVE recovery session for the same verified email fingerprint + Product/Test scope, and issues exactly one new ACTIVE recovery session.
9. The consumed OTP can never issue, replace or rotate a recovery session again. Every reuse returns REPLAY/non-active.
10. Logout/revocation sets session terminal and clears the cookie. Expiry is absolute; use does not extend it.

### Safe unknown outcome

- Challenge request with uncertain delivery still returns the neutral accepted response; retry with the same idempotency key must not resend.
- If verify commit/response is uncertain, client calls resolver first. A valid recovery cookie continues to resolver. If no valid cookie exists, the user requests a new challenge and new OTP; the consumed OTP is never accepted again.
- Resolver failure returns temporary error, never `no_access` by inference.
- Invalidation is repeatable; response loss is handled by another DELETE.

### Fixed ACC-01A dev/test security decisions

These values are accepted for implementation Task 1 in dev/test. They do not approve production retention or ACC-01B activation.

| ID | Parameter | Fixed decision |
| --- | --- | --- |
| SD-01 | OTP | 6 numeric CSPRNG digits |
| SD-02 | OTP TTL | 10 minutes, server clock |
| SD-03 | Resend cooldown | 60 seconds |
| SD-04 | Failed verification | 5 per challenge, then LOCKED |
| SD-05 | Email-fingerprint request limits | 3/15m and 10/24h; target-dependent rejection remains publicly neutral |
| SD-06 | Source request limits | 20/15m and 100/24h |
| SD-07 | Failed verify source limit | 20/hour |
| SD-08 | Token entropy | 256 random bits for challenge and recovery-session tokens |
| SD-09 | MAC/digests | HMAC-SHA-256; separate versioned keys for OTP, email fingerprint, challenge token and session token; constant-time comparison |
| SD-10 | Recovery session | 30 minutes absolute, no sliding extension |
| SD-11 | Cookie | HttpOnly, SameSite=Strict, Path=/, Secure in production-like environments |
| SD-12 | Timing normalization | Minimum 300ms plus bounded 0–200ms jitter and mandatory existing/nonexistent comparison test |
| SD-13 | Uniqueness | One ACTIVE challenge and one ACTIVE recovery session per verified email fingerprint + Product/Test scope; resend supersedes challenge; new successful verification revokes prior recovery session |
| SD-14 | CSRF | Same-origin Origin/Host validation plus SameSite cookie on every mutation |

ACC-01A dev/test retention is fixed at: terminal challenge/session/verification records 7d; fake delivery no more than 24h; security events 30d; limiter keys no more than 24h after the last window. Production retention remains an external `PRIV-01/ACC-01B` dependency and is not authorized here.

## 10. Recovery session and API contracts

### Session contract

Cookie name for the future implementation: `acc01a_recovery`. It is server-issued after OTP proof, HttpOnly, never JavaScript-readable, Secure in any production-like environment, SameSite=Strict and Path=`/`. Only recovery request/verify/resolve/continue/invalidate operations may consume it; PRE/ATT/RES, answer-save, completion, payment, provider and analytics code must reject or ignore it.

The cookie is not:

- a general login/account session;
- the existing `student_session`;
- an Order lookup token;
- a payment/provider credential;
- an analytics join key;
- permission to start/complete an Attempt without destination revalidation.

Session verification requires token digest match, ACTIVE status, unexpired server time, intact challenge lineage and exact server-stored Product/Test scope. Successful verification may update `lastUsedAt` at a coarse rate, never extend expiry. Database uniqueness permits one ACTIVE recovery session for the verified email fingerprint + Product/Test scope. A later successful verification revokes the older recovery session; it does not revoke or rotate an already-exchanged ordinary student session.

Current main `6cbdb2d...` mechanism is `student_session` issued by `setStudentSessionCookie`: a seven-day HMAC-SHA256 signed payload containing `userId`, `email`, `role=STUDENT` and `expiresAt`, with HttpOnly, SameSite=Lax, Path=/ and Secure only in production. `requireStudent()` validates signature/expiry and re-reads the exact non-deleted STUDENT User. PRE/ATT/RES APIs call `requireStudent()` and enforce `student.id` ownership.

Approved destination-session contract: <code>acc-01a-session-bridge-decision-v1.md</code> selects a parallel opaque server-side verified commercial student session. The legacy <code>student_session</code> remains generic-only; commercial/authentic PRE/ATT/RES and Attempt mutations accept only the verified session and have no fallback. Recovery continuation atomically exchanges valid recovery authority for that verified session after exact User/Product/Test/Access scope revalidation. Implementation proceeds only through sequential bounded dev/test tasks; <code>/api/students/identify</code> is never a verified issuer.

### Common API envelope

Success/error responses use stable enums and approved copy keys, never raw exception/provider messages. JSON bodies are strict and reject unknown fields with Zod in future implementation. Mutations enforce same-origin and `Content-Type: application/json`. Responses set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and must not include secrets in URL/query.

Forbidden in every public recovery response: raw/full email; existence of User/Order/Payment/Access/Attempt/Result before verification; Order/payment status; database/public entity IDs or directly authorizing destination URL; raw OTP/digest; challenge/session token/hash; access code; provider reference/payload/error; answers/content/keys/explanations; question-level scoring; primary/scaled score or lookup values; another user's data.

### POST /api/recovery/challenges

| Contract item | Definition |
| --- | --- |
| Auth/session | None; replaces any stale challenge cookie; recovery feature must be enabled in dev/test |
| Request | `{ email: string, productCode: "russian-training-variant-01", intent: "recovery", idempotencyKey: uuid }` |
| Success | `202 { state: "code_sent", messageKey: "email.sent_neutral", emailMasked: string, resendAfterSeconds: number }`; sets HttpOnly challenge cookie |
| Backend truth | Format normalization, configured product resolution, abuse decision, challenge commit and fake/dev adapter call; public body never confirms delivery/entity existence |
| Idempotency | Same key + same normalized request reuses outcome and sends at most once; key with different payload → safe 409 `IDEMPOTENCY_CONFLICT` |
| Rate limit | Target-email limiter is silently neutral; source/global limiter may return 429 `RATE_LIMITED` with bounded Retry-After, independent of target existence |
| Safe errors/status | 400 `INVALID_REQUEST` for malformed email/schema; 404 `FEATURE_UNAVAILABLE` when route disabled; 409 conflict; 429 source limit; 503 `TEMPORARY_UNAVAILABLE` only for failures independent of identity |
| Logging | request correlation + enum outcome only; no email/body/cookie/OTP |
| Analytics | Emit nothing in ACC-01A; do not add an event |
| Unknown outcome | 202 neutral if delivery state unknown; same-key retry does not resend |

Resend uses this same endpoint with a new idempotency key and the same server-bound scope. Before cooldown it produces the approved wait/rate-limit behavior without creating another active challenge.

### POST /api/recovery/challenges/verify

| Contract item | Definition |
| --- | --- |
| Auth/session | Valid HttpOnly challenge cookie; no email/challenge ID accepted from body |
| Request | `{ code: string, operationId: uuid }` |
| Success | `200 { state: "verified", messageKey: "email.code.verified", nextAction: "RESOLVE" }`; rotates challenge cookie away and sets recovery cookie |
| Backend truth | Atomic challenge state/expiry/counter/MAC check, OTP consumption, prior recovery-session revocation for the same subject/scope, and exactly one new session issue |
| Idempotency | First committed correct operation consumes OTP and issues one session; every retry/concurrent loser is REPLAY/non-active and never sets/replaces a session |
| Rate limit | Five attempts/challenge plus 20 failed verifies/hour/source; 429 with bounded Retry-After |
| Safe errors/status | 400 malformed; 401 `CODE_INVALID`; 409 `CHALLENGE_NOT_ACTIVE`; 410 `CODE_EXPIRED`; 429; 503 `OPERATION_OUTCOME_UNKNOWN` |
| Logging | challenge/operation correlation and allowlisted outcome only; never code/digest/cookie |
| Analytics | None; even approved `access_claim_completed` is not emitted until the analytics registry is implemented in a separate authorized task |
| Unknown outcome | Client calls resolver. Valid recovery cookie continues; without one, request a new challenge/OTP. The consumed OTP never issues another session |

Invalid, expired and rate-limited responses disclose only challenge validity for the requester-created challenge, never User/Access existence.

### GET /api/recovery/state

| Contract item | Definition |
| --- | --- |
| Auth/session | Valid recovery cookie; request contains no email/product/entity override |
| Request | No body; server reads immutable Product/Test scope from session |
| Success | `200 { state, screen: "REC-01", nextAction: enum(CONTINUE, null) }`, where `state` is exactly one of six verified outcomes; no entity URL or ID is returned |
| Backend truth | Current committed CommercialProduct/Test/User/Order/Access/Attempt terminal fields under precedence in section 11 |
| Idempotency | Pure read apart from coarse session last-used; creates/modifies no business entity |
| Rate limit | Read limiter protecting DB without changing state semantics; 429 retryable |
| Safe errors/status | 401 `RECOVERY_SESSION_REQUIRED`; 403 `SCOPE_NOT_ALLOWED`; 429; 503 `RESOLUTION_TEMPORARY_ERROR` |
| Logging | session correlation + resolved state enum; no email, entity payload or score |
| Analytics | No new emission. Existing destination analytics, if any, remains owned by that destination |
| Unknown outcome | 503 and remain `resolving`; never infer no_access or support_required from transport failure |

Example verified response shapes:

```json
{"state":"attempt_active","screen":"REC-01","nextAction":"CONTINUE"}
```

```json
{"state":"support_required","screen":"REC-01","nextAction":null}
```

No resolver response includes Order/payment status, Access details, entity ID/URL, timer timestamps, result aggregates or answer material.

### POST /api/recovery/continue

| Contract item | Definition |
| --- | --- |
| Auth/session | Valid recovery cookie; same-origin mutation; exact bridge dependency above must be resolved |
| Request | Strict `{ operationId: uuid }`; no email, product, Access, Attempt, Result or destination supplied by client |
| Success | `200 { nextAction: enum(OPEN_PRE, OPEN_ATTEMPT, OPEN_RESULT), nextUrl: string }` plus a newly issued/rotated verified ordinary student authorization cookie; destination is server-generated |
| Backend truth | Reverify recovery session; rerun section 11 resolver; prove exact email/Product/Test/User/Access/Attempt scope; exchange to hardened `student_session` or approved exact equivalent; mark recovery session EXCHANGED/revoked for all use except reading this idempotent exchange outcome |
| Forbidden effects | No User, Order, PaymentAttempt, Access, Attempt or Result creation; no start, save, completion, scoring, payment/provider call or timer mutation |
| Idempotency | `operationId` plus recovery-session exchange record yields one student-session exchange and one destination decision; retry never repeats a business action |
| Destination authorization | PRE/ATT/RES repeats ordinary verified student authorization through hardened `requireStudent()` or its approved equivalent and then checks `student.id` ownership |
| Recovery cookie scope | After success it cannot resolve domain state or access destinations; it may only read the already committed exchange outcome for unknown-response recovery |
| Safe errors/status | 401 `RECOVERY_SESSION_REQUIRED`; 409 `STATE_CHANGED_RETRY_RESOLVE`; 503 `CONTINUATION_OUTCOME_UNKNOWN`; no entity details |
| Logging/analytics | Restricted correlation + enum only; no analytics event, email, entity payload or token |
| Unknown outcome | First read the ordinary verified student session/state. If cookie delivery did not complete, read the committed exchange outcome and safely reissue the same authorization/destination; never start/complete/pay as recovery |

The recovery-only cookie never services the 120-minute Attempt. Only the exchanged ordinary verified student authorization may be used by existing attempt GET/save/complete and Result GET routes.

### DELETE /api/recovery/session

| Contract item | Definition |
| --- | --- |
| Auth/session | Cookie optional; same-origin mutation |
| Request/response | No body; `204`; clear cookie with matching attributes |
| Backend truth | ACTIVE session conditionally changes to REVOKED; absent/terminal is a no-op |
| Idempotency | Unlimited repeat produces 204 |
| Rate limit | Coarse abuse limit only |
| Safe errors/status | 204 normally; 404 if feature unavailable; 503 unknown outcome |
| Logging/analytics | Allowlisted SESSION_REVOKED event only; no analytics |
| Unknown outcome | Clear client cookie defensively and repeat DELETE |

### POST /api/test-only/recovery/messages/pop

| Contract item | Definition |
| --- | --- |
| Availability | Mounted only when `NODE_ENV=test`, ACC-01A flag on, fake test mailbox selected and a second test-harness secret/context is valid; nonexistent in dev preview/staging/production builds |
| Request | Header with test-harness authorization plus strict body `{ correlationId: uuid }`; no public email lookup |
| Success | `200 { code, expiresAt }` from isolated in-memory mailbox; one-time pop |
| Errors | 404 absent/consumed; 410 expired; no raw adapter error |
| Storage/logging | Raw code never persisted, logged, snapshotted or placed in test artifacts; mailbox TTL and cleanup mandatory |
| Analytics | None |

Unit/integration tests should prefer direct injected adapter inspection. The endpoint exists only for isolated browser automation and must have a build-manifest negative test proving public absence.

## 11. Resolver precedence

### Scope and query rules

1. Verify recovery session first. Invalid/expired session returns `unverified`; no domain query that could disclose state runs.
2. Load the exact `CommercialProduct` and Test stored in the session. ACC-01A is limited to configured `russian-training-variant-01`; arbitrary product selection and generic catalog-wide history are out of scope.
3. Resolve verified email to existing User and commercial Order records using current normalization. Email fingerprint is never ownership proof or analytics join.
4. Read all candidate Access and Attempt records needed to prove uniqueness; do not select an arbitrary “first” conflicting row.

### Ordered decision table

The order below is normative. Destination endpoints revalidate after navigation.

| Priority | Backend condition | Result | Rationale |
| --- | --- | --- | --- |
| 1 | Invalid session or scope mismatch | `unverified` / safe 401–403 | No disclosure before proof |
| 2 | Missing/corrupt Product/Test mapping, ambiguous User mapping, multiple conflicting Accesses/Attempts, impossible relations | `support_required` | Never guess or repair |
| 3 | Exactly one active Attempt (`STARTED`) for unique Access, regardless of elapsed start window | `attempt_active` | Attempt already consumed entitlement; timer continues from original start |
| 4 | Exactly one terminal `COMPLETED` or `EXPIRED` Attempt with readable persisted result fields/snapshot and within retention | `result_available` | Existing result outranks start-window state |
| 5 | Terminal Attempt without readable result, `CANCELLED` with no approved outcome, corrupt snapshot/scoring projection, result beyond unresolved retention behavior | `support_required` | GET must not score/rebuild |
| 6 | Unique paid Order in PAID state without its required Access, or broken paid linkage | `support_required` | `paid_without_access`; do not ask to repay or auto-grant |
| 7 | Order is `CREATED`/`PENDING`, or an active PaymentAttempt exists, but Access does not | `support_required` | Do not create a new Order, offer repeat payment or invent a recovery state; only a separately proven existing PAY-01 continuation may be used outside this resolver |
| 8 | Order/PaymentAttempt is `FAILED`, `CANCELLED` or `EXPIRED`, no Access exists | `no_access` only if the existing checkout state machine explicitly proves a new path is allowed; otherwise `support_required` | Recovery does not reinterpret payment terminality |
| 9 | Unique non-revoked Access, no Attempt, start deadline at/before server now | `start_window_expired` | Start prohibited |
| 10 | Unique non-revoked Access, no Attempt, start window open, `attemptsAvailable > 0` and invariants valid | `access_unstarted` | PRE-01 may perform existing start transaction |
| 11 | Access exists but is revoked, has zero availability without Attempt, mismatched source/order/product, or other unexplained invariant | `support_required` | Manual review, no silent downgrade |
| 12 | No Access, no Order/PaymentAttempt ambiguity, and the existing commercial state machine permits a fresh path | `no_access` | Product page may expose only an already-authorized new checkout path |

Commercial start deadline authority is `Access.startDeadlineAt`. For an unambiguous legacy/generic Access lacking it, `expiresAt` may be used only under an explicit compatibility adapter and the same ownership checks. Product inactivity blocks new checkout but must not erase a valid already-granted Access; a missing/deleted Test or unreadable scope is `support_required`.

Transport failure, timeout or an unknown database/provider outcome never resolves to `no_access`; it remains an unknown outcome and is retried/read back or escalated to `support_required`. If payment/access grant or start/completion commits concurrently, two resolver reads may return adjacent compatible states. A single response still returns exactly one state; continuation and the destination both revalidate before action.

## 12. Idempotency and concurrency

- Request idempotency uniqueness is server-enforced on operation key plus normalized intent/scope; payload mismatch is a conflict.
- At most one ACTIVE challenge exists for the email-fingerprint plus Product/Test scope. Resend atomically supersedes the previous row before the new code is usable.
- Verification uses a row lock or compare-and-set on ACTIVE, unexpired challenge plus atomic failure counter. Exactly one correct concurrent request consumes the OTP; every loser receives the safe replay/non-active contract and never issues or replaces a session.
- Successful verification, prior recovery-session revocation and issuance of exactly one new recovery session occur in one transaction. It revokes only an earlier recovery session for the same subject/scope, never an ordinary student session. Raw token is generated before commit but persisted only as digest.
- A consumed OTP is terminal. Retrying verify after any response loss never reissues, rotates or replaces a recovery session: first resolve with an already received cookie; without that cookie, request a new challenge and new OTP.
- Resolver is read-only and never calls payment verification, access grant, attempt start, completion or scoring.
- Parallel resolver results must be mutually compatible with committed transitions; arbitrary first-row selection is prohibited.
- Existing Attempt start remains authoritative: a repeated start returns the existing active Attempt and original `startedAt`/`endsAt`.
- Existing completion remains authoritative: a terminal Attempt is not rescored; Result GET only serializes stored terminal truth.
- No recovery token is accepted by payment/provider/order-claim APIs.
- Continuation exchange is idempotent by recovery-session identity: it reuses the committed ordinary student authorization/destination and never repeats a business action.
- Critical future writes (challenge consume/session issue/revocation/exchange) require transactions and database uniqueness/conditional updates, not frontend locks.

## 13. Fake/dev mailer contract

Future adapter interface:

```ts
type RecoveryMail = {
  recipient: string;
  code: string;
  expiresAt: Date;
  correlationId: string;
};

interface RecoveryMailer {
  sendVerificationCode(message: RecoveryMail): Promise<
    { status: "accepted" } |
    { status: "failed"; safeCode: string } |
    { status: "unknown"; safeCode: string }
  >;
}
```

This is illustrative contract text, not implementation.

Rules:

- ACC-01A provides only fake/dev/test implementation; it performs no SMTP/API network delivery.
- Raw OTP is passed only in process memory to the adapter and is not written to PostgreSQL, EmailLog body, console, traces or analytics.
- Dev mode may show delivery in a protected local developer tool, not a public user response; automated tests use injected mailbox inspection.
- Test mailbox behavior is deterministic in availability/order/clock under an injected clock, but production OTP generation must never be deterministic.
- Each test starts/ends with mailbox cleanup; one-time pop and TTL prevent reuse.
- Adapter failure never changes Order/Access and never exposes raw internal errors. Challenge public response remains neutral when target-dependent delivery is suppressed/unknown.
- Fake/test adapter and inspection route must fail closed outside dev/test. No automatic fallback from a missing production provider is permitted.
- ACC-01A introduces no production email environment variables and does not prove delivery.

## 14. Feature flag and environment contract

| Configuration | Contract |
| --- | --- |
| `ACC_01A_RECOVERY_ENABLED` | Independent boolean; default and missing value = false |
| Production hard gate | If runtime is production or production-like deployment policy forbids test features, recovery remains disabled even if flag=true; configuration is unhealthy/fail-closed |
| `RECOVERY_MAILER_MODE` | Only `fake` in development and `test` in test; any other/missing value while enabled fails closed |
| Product scope | Exact configured current commercial product code; mismatch fails closed, no catalog-wide search |
| Security secrets | Separate versioned synthetic dev/test keys for OTP/challenge/session/fingerprint; missing/short/reused keys fail closed |
| UI | Only an internal dev/test URL or harness may expose ACC-01A email entry; public code route remains first and catalog second. The email route, page and CTA are absent publicly, including when the dev/test implementation flag is off |
| API | Disabled routes return safe unavailable/404 semantics; they never partially create challenges |
| Support | Support CTA rendered only after independent support-channel activation |
| ACC-01B | No variable in ACC-01A may represent production provider readiness or close ACC-01B |

All email-entry route keys and `result.session_required_cta` remain absent from public routing and public bundles until production provider, privacy, DNS, delivery QA and explicit ACC-01B approval. ACC-01A may expose them only through an internal dev/test URL or harness. After ACC-01B, the already approved conditional keys may be activated only by a separate explicit decision. No literal placeholders or empty surfaces are allowed.

## 15. Privacy, logging and analytics

### Data rules

- Raw email is restricted operational PII. Store only where the recovery data model requires it; never log or send to analytics.
- Email fingerprint/HMAC is a limiter/dedupe aid, not ownership verification and is also prohibited from analytics.
- Raw OTP and raw challenge/session token are never persisted. Digests/MACs are secret derivatives and never logged/analysed.
- Request bodies, cookies, Authorization headers and query strings are excluded from normal logs/traces.
- Security logs contain only allowlisted event/reason codes, coarse time and restricted random correlation IDs. No IP/user agent is written to ordinary security events.
- Dev/test recovery retention is fixed by the separate retention contract in section 9. SD-14 defines CSRF protection. It is independent of 12-month product Result retention; production retention remains an external PRIV-01/ACC-01B legal/privacy gate.

### Mapping to approved analytics registry

The approved 32-event plan contains `access_claim_started`, `access_claim_completed`, `access_claim_failed`, `existing_access_detected`, `attempt_resumed`, `result_viewed` and derived `result_reopened`. The repository currently implements only six events. Because the task forbids event-list changes:

- ACC-01A emits no new analytics event.
- Future analytics work may map recovery to those already approved names only after their schemas are implemented and separately authorized.
- Existing destination events remain owned by PRE/ATT/RES and must not be duplicated by resolver.
- Recovery success cannot emit `access_granted`, because recovery does not grant Access.
- Operational `RecoverySecurityEvent` is never copied wholesale to analytics.

Forbidden analytics data: email in any form including masked/hash; raw OTP/MAC; recovery/challenge/session/Order lookup token; IP; user agent; answers; question text/options/content; keys/correct/accepted answers; explanations; exact primary/raw or scaled score; lookup values; provider references/secrets; raw URL/query; free-text errors.

Analytics outage must not block or roll back recovery/domain operations. No analytics identifier may be used for login, recovery, provider operations or support lookup.

## 16. UX and accessibility contract

Section 6 is normative per-state behavior. Additional cross-state requirements:

- Use only `ACC-01`, `ACC-02`, `REC-01` and their supplied `SWF-*` IDs.
- Use only approved copy keys. Component error keys already present in the copy pack may be used; no new copy key is invented.
- Email input has a visible label, `autocomplete=email`, appropriate mobile keyboard and linked field error.
- OTP is one logical field or an accessible grouped control with one name; support one-time-code autofill without forced focus hopping.
- Loading disables the actual trigger; `aria-disabled` alone is insufficient. Spinner is never a focus target.
- Field errors keep focus in the field. Standalone blocking/success states move focus once to their heading. Polling never repeatedly moves focus.
- Polite `status` is used for sending/verifying/resolving; blocking errors use one `alert` or heading focus, not both repeatedly.
- Resend countdown is text; do not announce every second. Announce when resend becomes available.
- No required animation; `prefers-reduced-motion` is respected.
- Desktop and mobile preserve the same backend meaning/action precedence. Mobile has one primary CTA and no competing purchase/code actions.
- At 200% zoom, content reflows, buttons grow vertically, no text/control is clipped, and no horizontal page scroll occurs.
- Keyboard-only user can submit, correct, resend when enabled, change email, resolve and reach the destination; focus return to opener/route action is deterministic.
- Masked email is derived from the just-submitted address and does not prove delivery/existence.
- This contract sets future test requirements; it does not claim WCAG or factual accessibility compliance.

## 17. Failure matrix

| Failure/class | Backend truth | Canonical UI | Retry / forbidden action | Support conditional | Security-sensitive |
| --- | --- | --- | --- | --- | --- |
| Invalid email format | No challenge | ACC-01 field error | Correct input; no resolver | no | low |
| Challenge request accepted neutrally | Challenge accepted/suppressed/unknown; entity existence unread | `code_sent` | Verify/resend after cooldown; no inference | no | yes |
| Fake-mailer internal failure | Challenge may exist, delivery failed/unknown | neutral send/delivery error according to identity-independent failure handling | Same-key retry does not send; new resend after cooldown; no raw error | only after activation | yes |
| Invalid code | Counter incremented, challenge ACTIVE if attempts remain | `invalid` | Retry within limit; no session | no | yes |
| Expired code | Server expiry elapsed | `expired` | New challenge; old code forbidden | no | yes |
| Reused/superseded code | Challenge terminal | `expired` or safe `CHALLENGE_NOT_ACTIVE` | New challenge; no replay | no | yes |
| Rate limit | Limiter/counter denies | `rate_limited` | Wait for server Retry-After; bypass forbidden | only if activated | yes |
| Challenge missing | No valid challenge cookie | ACC-01/ACC-02 safe restart | Request new challenge; no verification | no | yes |
| Recovery session missing/expired | No ACTIVE session | `unverified` | Reverify; no domain disclosure | no | yes |
| Resolver temporary error | Truth unknown | `resolving` then `recovery.error` | Safe GET retry; do not infer no_access | conditional | yes |
| No access | Verified unique scope, no Access/inconsistency | `no_access` | Product page; no hidden Access creation | no | medium |
| Start window expired | Unique Access/no Attempt/deadline elapsed | `start_window_expired` | Catalog/support; start forbidden | yes | medium |
| Active Attempt | Unique STARTED Attempt | `attempt_active` | Resume existing; new Attempt/timer reset forbidden | no | high |
| Result available | Readable terminal Attempt/result | `result_available` | GET existing RES-01; no completion/scoring | no | high |
| paid_without_access | PAID Order lacks required Access | `support_required` | Read-only retry/support; repeat payment/auto-grant forbidden | yes | critical |
| Pending payment without Access | Order `CREATED`/`PENDING` or active PaymentAttempt | `support_required` | No new Order or repeat payment; only an independently proven existing PAY-01 route may continue | yes | critical |
| Terminal failed/cancelled/expired payment without Access | Existing checkout state-machine decision required | `no_access` only when a new path is explicitly allowed; otherwise `support_required` | Recovery must not infer a fresh payment path | conditional | high |
| Inconsistent records | Multiple/mismatched/corrupt records | `support_required` | No arbitrary selection/repair | yes | critical |
| Unknown operation/transport outcome | Commit/response uncertain | Current progress/error state | Read truth or same-operation retry; never map to `no_access`; no new business entity | conditional | high |

## 18. Migration and compatibility plan

This is a future plan, not permission to migrate.

1. Use additive migration only: new recovery tables/enums/indexes/foreign keys; no destructive rewrite.
2. Do not alter existing `CommercialOrder`, `CommercialPaymentAttempt`, `Access`, `Attempt` or their state machines.
3. Do not create a separate Result table merely because UX names Result. The current logical Result is terminal Attempt serialization unless a separate centrally approved architecture decision changes that.
4. No backfill or production data migration is allowed without explicit permission and a reviewed data plan.
5. Generic MVP continues using existing student/access flows. ACC-01A resolver is gated and limited to the configured commercial product.
6. `rikz_russian_2026` and generic modes remain separate. Resolver does not read or change scoring logic; it only validates scope and persisted outcome readability.
7. Legacy Access can be resolved only when ownership, Test mapping, uniqueness and deadline semantics are unambiguous. Otherwise `support_required`.
8. Existing active Attempt opens with original snapshot, `startedAt` and calculated `endsAt`; old results remain based on their stored snapshot.
9. Cleanup job later deletes/erases expired recovery records according to fixed dev/test retention (terminal challenge/session 7 days, fake delivery at most 24 hours, security events 30 days, limiter keys at most 24 hours after the last window) and clears secret derivatives; it must not delete Order/Access/Attempt/Result. Production retention remains PRIV-01/ACC-01B work.
10. Rollback sequence: turn flag off and hide surfaces first; stop fake mailbox; revoke/expire recovery sessions; roll back application reads. Retaining unused additive tables is safer than destructive rollback. A schema rollback may drop only confirmed-empty recovery tables in non-production with explicit approval.
11. Production deployment/configuration and production data cleanup are ACC-01B/release work, not ACC-01A.

## 19. Future implementation decomposition

Do not execute these tasks under this specification request.

### Task 1 — recovery backend/domain and fake mailer

Scope: implement the approved parallel opaque server-side verified commercial session from <code>acc-01a-session-bridge-decision-v1.md</code> as the first bounded step, preserving legacy <code>student_session</code> as generic-only and forbidding fallback; then use fixed SD-01–SD-14 dev/test security parameters for additive Prisma design/migration, challenge/session tokens, rate limits, transactions/concurrency, fake/test adapter, request/verify/resolve/continue/invalidate/test-only APIs and tests. Recovery continuation exchanges recovery authority for the verified session. No UI, production provider or production activation.

Dependency/output: the approved verified destination-session architecture plus this specification → stable backend contract/evidence. Task 1 may start only as sequential bounded dev/test implementation work and must produce runtime evidence before Task 2; the approval does not authorize production activation.

### Task 2 — canonical UI/state integration

Scope: integrate only ACC-01/ACC-02/REC-01 and supplied SWF/copy keys; default-off flag; conditional CTA rules; destination navigation; desktop/mobile/keyboard/focus/live-region behavior; no new screen/copy; no production route activation.

Dependency/output: Task 1 APIs and typed state schemas → dev/test UI evidence. This task must finish before Task 3.

### Task 3 — browser, security and reconciliation evidence

Scope: browser/e2e and adversarial tests; concurrency barriers; timing/content comparison; cookie/CSRF checks; log/network/analytics scans; generic smoke; migration cleanup dry run; 12 manual runtime smokes; evidence report. No production provider, DNS, privacy sign-off or production enablement.

Dependency/output: Tasks 1–2 → reviewed ACC-01A development evidence. ACC-01B remains separate.

## 20. Acceptance criteria

The future implementation is acceptable only when all 40 criteria have evidence:

1. A valid-format request for an existing and nonexistent email has the same public HTTP status, schema and neutral copy.
2. Timing comparison enforces a 300 ms minimum plus 0–200 ms jitter and does not expose entity existence.
3. Invalid email format creates no challenge and returns only the approved field error.
4. Raw OTP is absent from every persistent store, ordinary log, trace, analytics row and saved test artifact.
5. Stored OTP verification uses a challenge-bound keyed MAC with versioned secret, not a plain hash.
6. Raw challenge and recovery session tokens are absent from every persistent store and log.
7. Challenge/session token digests are unique and verified with constant-time comparison.
8. OTP expires by server clock after 10 minutes and never verifies afterward.
9. Resend obeys the 60-second cooldown and atomically invalidates every previous code for that scope.
10. OTP verification is one-time; replay or a lost verify response cannot reissue, rotate or replace a session, and a client without the committed cookie must request a new challenge and OTP.
11. Invalid attempts atomically increment the counter and lock after five failures per challenge.
12. Request/verify limits enforce SD-04–SD-07 windows and safe Retry-After behavior.
13. Concurrent correct verification consumes the OTP once, leaves exactly one new ACTIVE recovery session, and every loser receives replay/non-active without replacement authority.
14. Successful verification revokes a prior recovery session for the same subject/scope and prevents fixation without revoking an ordinary student session.
15. Recovery cookie is HttpOnly, has approved SameSite/Path, and is Secure in production-like environments.
16. Recovery session has absolute expiry, explicit revocation and no sliding extension.
17. Recovery session is rejected by general login, PRE/ATT/RES GET/save/complete, Order lookup, payment/provider and analytics operations; it can never service the 120-minute Attempt.
18. Resolver performs no domain lookup before validating the recovery session.
19. Resolver takes email and Product/Test scope only from server-side session, not request overrides.
20. Every successful resolver response contains exactly one canonical verified recovery state plus only `CONTINUE` or null; continuation revalidates scope, exchanges to hardened ordinary student authorization, revokes recovery authority and performs no business action.
21. Access without Attempt and with an open start window resolves to `access_unstarted`/PRE-01.
22. Active Attempt resolves to the existing ATT-01 with unchanged `startedAt` and `endsAt`.
23. Terminal readable Attempt resolves to existing RES-01 without rerunning completion or scoring.
24. Start-window expiry resolves to `start_window_expired` and cannot start an Attempt.
25. No Access resolves to `no_access` only when no pending/active-payment ambiguity exists and the existing state machine permits a new path; `CREATED`/`PENDING` or active PaymentAttempt resolves to `support_required` without new Order or repeat payment.
26. PAID Order without Access resolves to `support_required`, never repeat-payment or auto-grant.
27. Conflicting, legacy-ambiguous or unreadable records resolve to `support_required`, never arbitrary first-row selection.
28. Repeated/concurrent resolver calls create no Order, PaymentAttempt, Access, Attempt or Result.
29. Recovered start uses existing start idempotency and cannot decrement attempts twice.
30. Result GET remains a read and cannot score; completed Attempt fields remain immutable.
31. Resolver and recovery APIs return no entity ID, authorizing URL, payment/order detail, timer timestamps, answers, content, keys, explanations, question-level scoring, primary/scaled score or lookup values.
32. Authentic `rikz_russian_2026` correct/accepted answers and explanations remain absent from recovered public Result/network payloads.
33. Limited-launch recovered Result exposes no scaled score, max scaled score, scaled-score note or lookup table.
34. ACC-01A flag defaults off; disabled UI/API have no placeholder or partial challenge creation.
35. Any production/production-like activation attempt fails closed independently of the flag.
36. Fake mailer and OTP inspection are dev/test-only; public/production build contains no inspection route.
37. No public email route key, production email environment variable/provider/fallback is introduced; internal dev/test URL/harness is the only entry and ACC-01B remains blocked.
38. Recovery emits no unimplemented/new analytics event and all forbidden analytics/log scans pass.
39. Existing generic MVP access/attempt/result smoke passes; commercial and generic modes do not mix.
40. All canonical desktop/mobile/focus/keyboard/200%-zoom contracts and the hardened destination-session bridge (including a negative `/api/students/identify` bypass test) are evidenced without claiming untested accessibility compliance.

## 21. Test plan

Tests are specified for a later implementation; none are created by this task.

### Unit

- CSPRNG OTP shape and rejection of deterministic production generation.
- OTP MAC, key version, constant-time comparison, token digest and email fingerprint separation.
- Expiry/cooldown boundary with injected server clock.
- One-time state transition, resend supersession and failure counter.
- Session token hashing, absolute 30-minute non-sliding expiry, same-subject/scope replacement revocation and ordinary-session non-revocation.
- Resolver decision-table coverage for every row and all precedence collisions.
- Serialization/schema negative scans for email, OTP/token, Order/payment details, answers/keys/scores/lookup.
- Feature/config matrix and production fail-closed behavior.

### Integration

- Request/verify/resolve/continue/invalidate happy path through fake adapter and hardened ordinary student authorization.
- Existing and nonexistent emails: compatible status/body/headers and bounded timing distribution.
- Same idempotency key, conflicting payload, resend after/before cooldown.
- Concurrent wrong/correct verify and concurrent correct verify with database barrier: one OTP consume/session issue, all losers replay/non-active and no replacement session.
- Verify-response-loss recovery: resolver first with a delivered cookie; without the cookie, old OTP replay is terminal and a new challenge/new OTP is required.
- Concurrent resolver with payment→Access grant, Attempt start and completion.
- Active Attempt resume preserves original timer and snapshot.
- Terminal Result reopen does not invoke completion/scoring.
- PAID-without-Access, CREATED/PENDING or active PaymentAttempt without Access, terminal payment states, transport unknowns and each inconsistent/legacy record class.
- Continuation exchange idempotency, recovery-session revocation, normal destination ownership recheck and zero business writes.
- Disabled flag, malformed/missing secrets and fake-only environment.
- Test mailbox one-time pop, cleanup, TTL and build absence.

### Browser/e2e

- Desktop and widths 320, 360, 390, 430 px.
- Mouse, touch, keyboard-only, OTP autofill-compatible input, reload and new browser.
- Wrong/expired/reused code, resend cooldown, rate limit and temporary error.
- Active Attempt and existing Result navigation through `CONTINUE`, ordinary student authorization and destination revalidation.
- DOM/network inspection for hidden answer/key/score/token data and inactive CTA gaps.
- Generic access/attempt/result regression smoke with flag off.

### Security

- Enumeration content/status/header/timing sampling.
- Brute force, replay, resend abuse, fixation, stolen/expired/revoked session.
- CSRF/same-origin and cookie attribute checks.
- Scope/email/body/query tampering and cross-user/cross-product access.
- Cross-use of recovery token against PRE/ATT/RES, payment/provider/order lookup and analytics endpoints.
- Negative bypass test proving `/api/students/identify` cannot mint the destination authorization from an unverified email claim.
- Logs/traces/analytics/database/test-artifact forbidden-value scans.
- Static route/build scan proving test inspection is absent outside test.

No `pnpm lint`, `pnpm test`, `pnpm typecheck` or Playwright execution is runtime evidence for this documentation-only task; those commands belong to later implementation and QA tasks.

## 22. Manual smoke — exactly 12 document-level scenarios

These are specifications, not runtime evidence.

| # | Initial state | Actions | Expected canonical state IDs | Backend evidence | Forbidden result | Final state |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Existing buyer email; no challenge/session | Open dev/test email route, submit valid email | `SWF-ACC01-IDLE-01 → SENDING-01 → SWF-ACC02-CODE-SENT-01` | One ACTIVE challenge; one fake delivery; neutral 202 | Any User/Order/Access disclosure or raw OTP log | `code_sent` |
| 2 | Nonexistent valid email | Submit identically and compare with #1 | Same three SWFs and public response | Challenge/delivery behavior compatible; no User created | Different copy/status/timing signal | `code_sent` |
| 3 | ACC-01 idle | Submit malformed email | `SWF-ACC01-IDLE-01` with approved field error | Zero challenge/delivery rows | Fake delivery or resolver query | idle/validation error |
| 4 | Valid challenge; fake test mailbox | Retrieve code once through isolated harness | `SWF-ACC02-CODE-SENT-01` | In-memory message consumed; DB contains MAC only | Public inspection route, persisted/logged raw code | `code_sent` |
| 5 | Valid challenge, attempts remain | Submit wrong code | `CODE-SENT → VERIFYING → INVALID` | Counter + one NO_MATCH attempt committed | Session or entity disclosure | `invalid` |
| 6 | Challenge past server expiry | Submit formerly correct code | `VERIFYING → EXPIRED` | Challenge EXPIRED, no session | Verification by client clock or old code reuse | `expired` |
| 7 | Successfully used/superseded code, including lost verify response | Submit it again; first try resolver with any received cookie, then repeat without a cookie | `VERIFYING → EXPIRED`/safe non-active contract | No second session; replay event; no cookie requires a new challenge/new OTP | Reissued, rotated or replacement session from used OTP | terminal challenge |
| 8 | Verified email; unique valid Access; no Attempt; deadline open | Resolve, send `CONTINUE`, open destination | `VERIFIED → SWF-REC01-RESOLVING-01 → ACCESS-UNSTARTED-01 → PRE-01` | Read existing Access; exchange to hardened ordinary student authorization; recovery revoked; no write until PRE start | Authorizing URL/entity ID or hidden Attempt creation in resolver/continuation | PRE-01 |
| 9 | Verified email; existing STARTED Attempt | Resolve, `CONTINUE`, reload | `RESOLVING → ATTEMPT-ACTIVE-01 → ATT-01` | Same Attempt ID, startedAt, endsAt and snapshot; ATT rechecks ordinary student ownership | Recovery cookie servicing Attempt, new Attempt, decrement or timer reset | Existing ATT-01 |
| 10 | Verified email; readable terminal Attempt/result | Resolve, `CONTINUE`, open Result twice | `RESOLVING → RESULT-AVAILABLE-01 → RES-01` | Same terminal Attempt projection; RES rechecks ordinary student ownership; scoring/completion call count zero | Question scores/keys/accepted answers/explanations, scaled fields/lookup | Existing RES-01 primary-only |
| 11 | Case A unused Access deadline elapsed; B clean no Access; C CREATED/PENDING or active PaymentAttempt without Access | Resolve each | A `START-WINDOW-EXPIRED-01`; B `NO-ACCESS-01`; C `SUPPORT-REQUIRED-01` | Deadline for A; state-machine-authorized absence for B; read-only pending truth for C | Start A; new Order/Access or repeat payment for C; transport mapped to no_access | A expired; B product route; C support |
| 12 | Valid code under parallel verify/resolver/continue; then invalidate | Fire two correct verifies, parallel reads and repeated `CONTINUE`; DELETE twice | `VERIFYING → VERIFIED → RESOLVING → one resolved SWF → UNVERIFIED` | One consume and one ACTIVE recovery session; losers replay; one idempotent ordinary-session exchange; two DELETEs 204 | Replacement recovery session, duplicate business entity/action, stale-cookie authority | exchanged/revoked/unverified |

## 23. Risk register

| Risk | Probability | Impact | Trigger | Mitigation | Required evidence | Blocks launch |
| --- | --- | --- | --- | --- | --- | --- |
| Enumeration through timing/suppressed delivery | medium | high | Measurable existing/nonexistent split | Neutral contract, timing normalization, tests | Statistical comparison | yes |
| OTP brute force | medium | critical | High invalid volume/session takeover | Approved limits, MAC pepper, lock | Fault/adversarial tests | yes |
| Shared-network false rate limits | medium | medium | Legitimate users rejected | Layered email/source limits, monitoring, approved thresholds | Load/UX evidence | yes if material |
| Resend race leaves two codes | medium | high | Both codes verify | Transaction/unique active rule | Concurrent resend test | yes |
| Verify response loss strands user | low | high | Commit succeeds, cookie lost | Resolver first if cookie arrived; otherwise new challenge/new OTP, never verify replay/session replacement | Fault injection | yes |
| Recovery session theft/fixation | low | critical | Foreign browser opens state | rotation, HttpOnly/Secure/SameSite, short TTL/scope | Security suite | yes |
| Resolver selects wrong record | medium | critical | Multiple/legacy rows | Fetch all candidates, explicit conflicts | Seeded inconsistency tests | yes |
| paid_without_access causes repeat payment | medium | critical | PAID Order/no Access | support_required, no purchase CTA | Reconciliation/browser test | yes |
| Timer reset/duplicate Attempt | low | critical | Recovery start/reload race | Existing start invariants and revalidation | Parallel start test | yes |
| Result recomputation/mutation | low | critical | Result GET calls completion/scoring | Read-only resolver/GET | Spy/DB immutability test | yes |
| Authentic key/scaled-score leakage | medium | critical | Serializer/network includes hidden fields | Strict public serializer + scans | Browser/schema evidence | yes |
| Fake mailbox exposed publicly | low | critical | Route present outside test | Compile-time/mount guard + negative build test | Route manifest | yes |
| Raw PII/token in logs/analytics | medium | critical | Request/error instrumentation dump | Allowlist/redaction/scanners | Stored-data scan | yes |
| Production flag accidentally enabled | low | critical | Env drift | Independent hard gate/fail closed | Production-like config test | yes |
| 12-month Result reopening not enforced | medium | high | Older result unavailable/deleted | Separate retention implementation/evidence | Dated retention/reopen test | yes for promise |
| Support CTA unavailable on blocking case | high until support gate | medium | support_required with no channel | Catalog safe fallback; keep CTA conditional | Support gate evidence | no for ACC-01A dev, yes production |
| Unverified `student_session` issuance bypass | certain on inspected main | critical | `/api/students/identify` accepts an email claim and mints destination authority | Approve and implement one verified continuation bridge; remove/harden bypass before recovery implementation | Negative identify-bypass and destination ownership tests | yes for implementation |

## 24. Open decisions

### Approved destination-session architecture

Main `6cbdb2d2fdb58977a0a648e7e956edf95521a907` uses the exact ordinary student mechanism `student_session`: a seven-day stateless HMAC-SHA256 signed payload `{ userId, email, role: "STUDENT", expiresAt }`, cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only in production. `requireStudent()` validates the signature and then matches an undeleted STUDENT User by ID/email/role. However, `POST /api/students/identify` currently finds/creates that User from an unverified email claim and calls `setStudentSessionCookie`. Therefore ACC-01A cannot safely exchange recovery proof into destination authority using current main unchanged.

The central architecture/security decision is fixed by <code>acc-01a-session-bridge-decision-v1.md</code>:

1. Use a parallel opaque server-side verified commercial student session for commercial/authentic resources.
2. Keep legacy <code>student_session</code> generic-only, with no fallback from commercial/authentic guards.
3. Bind verified authority to exact User/Product/Test/Access scope and allow issuance only from <code>EMAIL_OTP_RECOVERY</code>, <code>ACCESS_CODE</code> or <code>COMMERCIAL_ORDER_CLAIM</code>; <code>/api/students/identify</code> is prohibited as a verified issuer.
4. Exchange recovery authority for the verified session through the approved continuation transaction, without creating business records.

The architecture is canonical for sequential bounded dev/test implementation tasks. Runtime evidence, negative bypass tests and all external gates remain required; production activation is prohibited.

### External or later gates

- Production recovery-data retention and legal/privacy approval belong to PRIV-01/ACC-01B.
- Production email provider selection is an ACC-01B gate.
- DNS, sender authentication and real delivery QA are ACC-01B/release gates.
- A working support channel and permission to render its CTA require the independent support activation gate.
- The strict primary-only Result serializer gap must be closed before limited launch.
- Runtime unit/integration/browser/security/manual evidence remains required before READY or release claims.

The following are fixed in this specification and are not open decisions: SD-01–SD-14 dev/test security values; one ACTIVE challenge per email fingerprint plus scope; one ACTIVE recovery session per subject plus scope; single unambiguous legacy Access may resolve, ambiguity/revocation resolves to `support_required`; product inactivity does not cancel valid Access; browser-test inspection is an isolated in-memory one-time pop and is absent outside test.

## 25. Final reconciliation

### Reconciled invariants

- Final MVP backend ownership, transaction, snapshot, no-password student model and no pre-completion answer disclosure are preserved.
- Current commercial contract narrows one paid product to one Attempt, 90-day start window, 120-minute timer, 12-month Result retention and primary-only display.
- Recovery is read-only with respect to Order/Payment/Access/Attempt/Result and therefore cannot change existing state machines.
- Canonical UX uses exactly 16 supplied email/recovery states and existing copy keys.
- ACC-01A is dev/test-only and default-off; ACC-01B remains blocked and production activation prohibited.
- Read-only inspection of supplied main `6cbdb2d2fdb58977a0a648e7e956edf95521a907` confirms the existing PRE/ATT/RES ownership checks, snapshot/timer authority and terminal Attempt result projection. The issuance weakness is addressed architecturally by the approved parallel opaque server-side verified commercial session in <code>acc-01a-session-bridge-decision-v1.md</code>; implementation and runtime proof remain pending.

### Source contradictions or mismatches found

| Finding | Reconciliation in this document |
| --- | --- |
| Generic MVP default Access behavior is seven days; the current commercial product grants a 90-day start window | This is product-specific narrowing, not a conflict: commercial ACC-01A uses stored `Access.startDeadlineAt`; generic legacy behavior is unchanged |
| Final MVP describes correct answers and optional scaled score after completion, while current limited launch and UX Result contract require primary-only and forbid authentic keys/scaled fields | Resolver returns no result payload; recovered limited-launch RES-01 must follow the stricter current task/launch presentation. Generic/future display is not changed here |
| Task context names Result as an existing entity; current Prisma schema has no Result model | Treat Result as the logical terminal Attempt projection; do not invent a table in ACC-01A |
| Approved analytics plan defines 32 events; main implements six | This is an implementation gap, not a source conflict. ACC-01A adds/emits none and does not reopen ANA-02B |
| Authentic `rikz_russian_2026` Part A scoring awards 2 points for exact, 1 for one selection error and 0 for two or more | This product-specific partial scoring is canonical and remains untouched. Recovery/Result GET never recomputes it and primary-only public output exposes no question scoring |
| Existing `student_session` is issued by an unverified-email identify endpoint, while PRE/ATT/RES rely on it as ownership authority | The approved decision in <code>acc-01a-session-bridge-decision-v1.md</code> uses a separate opaque verified commercial session; legacy <code>student_session</code> is generic-only, commercial/authentic resources have no fallback, and the recovery-only cookie is never accepted by PRE/ATT/RES |
| UX exposes email recovery only after ACC-01B, while ACC-01A must build/test it before ACC-01B | Implementable later only behind dev/test flag; production route/CTA stays absent |
| Current Result serializer still returns question-level/score fields even though the launch contract is primary-only | This is an implementation gap. The recovered public path must use a strict serializer that omits question scoring, correct/accepted answers, explanations and all scaled fields |
| Public email-entry keys must remain absent before ACC-01B | ACC-01A exposes recovery only through an internal dev/test URL or harness; public code route stays first and catalog second |

### Final gate statement

This specification does not move ACC-01A or ACC-01B to READY. The destination-session architecture is approved and sequential bounded dev/test implementation may start, but implementation and runtime proof remain pending. This document does not confirm production email delivery, authorize production activation or a paid launch, or constitute runtime/manual-smoke evidence.

**APPROVED ACC-01A RECOVERY SPECIFICATION — SESSION ARCHITECTURE APPROVED — BOUNDED DEV/TEST IMPLEMENTATION MAY START — PRODUCTION ACTIVATION PROHIBITED**
