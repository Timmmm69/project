# ACC-01A Verified Destination-Session Bridge Decision v1

## 1. Document control

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Date | 2026-07-13 |
| Repository | Timmmm69/project |
| Inspected repository SHA | 6cbdb2d2fdb58977a0a648e7e956edf95521a907 |
| Inspection mode | Clean detached read-only worktree |
| Scope | Architecture decision only |
| Application / Prisma / migration / API / UI / tests / configuration changes | None |
| Production activation | Prohibited |
| Decision status | APPROVED ACC-01A VERIFIED DESTINATION-SESSION ARCHITECTURE — CANONICAL FOR BOUNDED DEV/TEST IMPLEMENTATION — NO CODE CHANGES |

This document chooses one architecture:

**parallel opaque server-side verified commercial student session**

The existing signed <code>student_session</code> remains a legacy generic-MVP mechanism. A new opaque <code>verified_student_session</code> is the only student session accepted for commercial or authentic PRE, ATT, answer-save, completion/expiry and RES resources. There is no fallback from the verified guard to the legacy guard.

No incompatible repository constraint was found. The design is additive and fits the current Next.js, PostgreSQL and Prisma monolith. It does not create a password account or student history.

## 2. Source reconciliation and fixed boundary

The decision preserves these controlling rules:

- Final MVP has no password-based student account and requires backend ownership, transactions, snapshot stability and backend-only scoring: <code>docs/00-final-mvp-spec-v2.md:164-175</code> and <code>docs/00-final-mvp-spec-v2.md:1398-1431</code>.
- Current approved student security forbids raw email as the only access key and requires expiring HttpOnly/SameSite/Secure-in-production cookies plus User/Access/Attempt/Result ownership checks: <code>docs/11-approved-decisions-current.md:136-160</code>.
- ACC-01A remains default-off and dev/test-only; ACC-01B and production email delivery remain blocked.
- The current commercial product remains 10 BYN, one Access/Attempt, 90 days to start, a 120-minute Attempt and 12-month Result retention.
- Recovery creates no Order, PaymentAttempt, Access, Attempt or Result.
- Result is the persisted terminal Attempt projection. This decision does not invent a Result table.
- Scoring, lookup tables, authentic content, payment/access state machines and the analytics event registry are unchanged.

The narrower launch/recovery contract requires primary-only limited-launch Result output. The current Result serializer gap is inventoried below but is not changed by this architecture-only task.

## 3. Read-only repository inventory

All paths and line ranges in this section refer to repository SHA <code>6cbdb2d2fdb58977a0a648e7e956edf95521a907</code>.

### 3.1. Current <code>student_session</code> issuers

| Current issuer or primitive | Repository evidence | Current proof | Target decision |
| --- | --- | --- | --- |
| Token constructor | <code>src/server/auth/student-session.ts:42-49</code> | HMAC-signed payload with 7-day expiry | Legacy generic primitive only |
| Cookie setter | <code>src/server/auth/student-session.ts:71-80</code> | Caller supplies User identity | Legacy generic setter only; never called by a verified issuer |
| <code>POST /api/students/identify</code> | <code>src/app/api/students/identify/route.ts:7-74</code>, issuance at <code>61-65</code> | Unverified email input; finds or creates User | Explicitly forbidden as a verified issuer |
| <code>POST /api/commercial/orders/[publicId]/claim-access</code> | <code>src/app/api/commercial/orders/[publicId]/claim-access/route.ts:10-24</code>, issuance at <code>19-21</code> | Matching opaque Order cookie, PAID Order and valid linked Access | Becomes the sole current paid-order issuer of the new verified session |
| <code>POST /api/commercial/orders/[publicId]/start-attempt</code> | <code>src/app/api/commercial/orders/[publicId]/start-attempt/route.ts:12-26</code>, issuance at <code>19-23</code> | Repeats Order-token claim immediately before start | Must stop issuing any student session; it consumes the verified session issued by claim |

No other call to <code>setStudentSessionCookie</code> or <code>createStudentSessionToken</code> exists on the inspected SHA.

### 3.2. Current readers, validators and every <code>requireStudent()</code> call

| Reader / consumer | Repository evidence | Current ownership check | Target boundary |
| --- | --- | --- | --- |
| Stateless signature validator | <code>src/server/auth/student-session.ts:51-69</code> | HMAC, role and expiry | Legacy generic only |
| Cookie reader | <code>src/server/auth/student-session.ts:82-89</code> | Reads <code>student_session</code> | Legacy generic only |
| User re-reader | <code>src/server/auth/student-session.ts:91-110</code> | Exact User id/email/role/non-deleted | Keep as <code>requireStudent()</code> for generic resources |
| Attempt start | <code>src/app/api/attempts/start/route.ts:7-48</code>, guard at <code>8</code> | Email equals session; service checks User/Access | Generic branch uses legacy guard; commercial/authentic branch uses verified guard only |
| Attempt read | <code>src/app/api/attempts/[attemptId]/route.ts:13-35</code>, guard at <code>14</code> | Attempt id + <code>student.id</code> | Resource-classified guard; no fallback |
| Answer save | <code>src/app/api/attempts/[attemptId]/answers/route.ts:13-63</code>, guard at <code>14</code> | Attempt id + <code>student.id</code> | Resource-classified guard; no fallback |
| Attempt complete | <code>src/app/api/attempts/[attemptId]/complete/route.ts:13-41</code>, guard at <code>14</code> | Attempt id + <code>student.id</code> | Resource-classified verified guard for commercial/authentic |
| Attempt expire | <code>src/app/api/attempts/[attemptId]/expire/route.ts:13-45</code>, guard at <code>14</code> | Attempt id + <code>student.id</code> | Same as completion |
| Result read | <code>src/app/api/results/[attemptId]/route.ts:13-56</code>, guard at <code>14</code> | Attempt id + <code>student.id</code> | Resource-classified verified guard for commercial/authentic |
| Generic Payment status | <code>src/app/api/payments/[paymentId]/status/route.ts:13-47</code>, guard at <code>14</code> | Payment id + <code>student.id</code> | Legacy generic Payment only; it must never reach CommercialOrder/CommercialPaymentAttempt |

There are exactly seven route calls to <code>requireStudent()</code> on the inspected SHA.

### 3.3. PRE routes, pages and services

There is no dedicated PRE API on the inspected SHA. Current PRE behavior is assembled from these surfaces:

| Surface | Repository evidence | Current behavior | Target treatment |
| --- | --- | --- | --- |
| Public test page | <code>src/app/(public)/tests/[slug]/page.tsx:21-44</code> and <code>118-126</code> | Detects a commercial product, renders commercial checkout, and also renders the generic access form | Page may stay shared, but the generic form must not authorize a commercial/authentic resource |
| Generic identify/access orchestration | <code>src/app/(public)/tests/[slug]/test-access-form.tsx:115-162</code> | Identify issues legacy cookie, then raw-email access check | Generic-only |
| Generic code/start orchestration | <code>src/app/(public)/tests/[slug]/test-access-form.tsx:244-294</code> | Identify, activate code, then identify again before start | Must split: generic remains; authentic AccessCode activation issues verified session directly |
| Generic access-check route | <code>src/app/api/access/check/route.ts:6-33</code> | Accepts email + testId without a session | Generic-only; must not return commercial/authentic Access or Attempt |
| Generic access-check service | <code>src/lib/access/access-check.ts:63-192</code> | Resolves User, active Attempt and Access by email/test | Generic-only; current exposure of User/Access/Attempt IDs is a commercial-boundary risk |
| Commercial checkout UI | <code>src/app/(public)/tests/[slug]/commercial-checkout-form.tsx:48-64</code> and <code>142-194</code> | Restores Order status; claim then start/resume/result | Order-token claim becomes verified-session issuer; existing-access shortcut cannot use legacy-only session for authentic resources |
| Commercial Order status | <code>src/app/api/commercial/orders/[publicId]/status/route.ts:9-19</code> | Requires Order token | Remains Order-capability authorized, not student-session authorized |
| Commercial claim | <code>src/app/api/commercial/orders/[publicId]/claim-access/route.ts:10-24</code> | Requires Order token, proves Access and issues legacy session | Issues verified session |
| Commercial claim service | <code>src/lib/commercial/commercial-service.ts:1004-1031</code> | Requires PAID Order, live linked Access and STUDENT User; chooses start/resume/result | Proof basis for <code>COMMERCIAL_ORDER_CLAIM</code> issuer |
| Attempt transition from PRE | <code>src/app/api/attempts/start/route.ts:7-48</code> and <code>src/lib/attempts/attempt-service.ts:51-197</code> | Starts or restores Attempt | Commercial/authentic branch requires verified scope before service call |

### 3.4. Attempt create/read/save/complete services

| Operation | Route evidence | Service evidence | Important invariant |
| --- | --- | --- | --- |
| Start or restore | <code>src/app/api/attempts/start/route.ts:7-48</code>; commercial wrapper <code>src/app/api/commercial/orders/[publicId]/start-attempt/route.ts:12-26</code> | <code>src/lib/attempts/attempt-service.ts:51-197</code> | Existing STARTED Attempt is returned; Access decrement and snapshot creation are transactional |
| Read | <code>src/app/api/attempts/[attemptId]/route.ts:13-35</code> | <code>src/lib/attempts/attempt-service.ts:29-49</code> | Query includes <code>userId</code> |
| Save answer | <code>src/app/api/attempts/[attemptId]/answers/route.ts:13-63</code> | <code>src/lib/attempts/attempt-service.ts:220-270</code> | Query includes <code>userId</code>; answer belongs to snapshot question |
| Complete | <code>src/app/api/attempts/[attemptId]/complete/route.ts:13-41</code> | <code>src/lib/attempts/attempt-service.ts:272-418</code> | Terminal Attempt is returned without rescoring; STARTED transition and scoring are transactional |
| Expire | <code>src/app/api/attempts/[attemptId]/expire/route.ts:13-45</code> | Same <code>completeAttempt</code> service | Server time and original <code>startedAt</code> determine expiry |
| Student serializer | <code>src/lib/attempts/serialize.ts:8-40</code> | Computes <code>endsAt</code> from snapshot duration + original <code>startedAt</code> | Session exchange must never touch timer fields |
| Snapshot builder/student question serializer | <code>src/lib/attempts/snapshot.ts:123-206</code> | Snapshot keeps answer keys server-side; active serializer omits them | Unchanged |

### 3.5. Result routes and serializers

| Surface | Repository evidence | Current behavior | Target treatment |
| --- | --- | --- | --- |
| Student RES API | <code>src/app/api/results/[attemptId]/route.ts:13-56</code> | Requires legacy session, queries by <code>student.id</code>, rejects STARTED, serializes stored Attempt | Commercial/authentic branch requires verified guard; remains read-only |
| Shared server Result serializer | <code>src/lib/scoring/result-serialize.ts:41-122</code> | Authentic keys are hidden, but question-level and scaled fields remain in payload | Existing limited-launch serializer gap; no recomputation and no change in this task |
| Public Result page/client | <code>src/app/(public)/results/[attemptId]/page.tsx:9-16</code>, <code>result-view.tsx:36-165</code>, <code>result-view-model.ts:8-103</code> | Fetches RES API and renders returned fields | Direct page URL is not authority |
| Admin Result detail | <code>src/app/api/admin/attempts/[attemptId]/route.ts:13-50</code> | Admin session, admin-audience serializer | Unchanged; never consumes student cookies |
| Admin Result list | <code>src/app/api/admin/attempts/route.ts:13-63</code> | Admin session and list projection | Unchanged |

### 3.6. AccessCode claim flow

Current evidence:

- Code normalization, generation and SHA-256-plus-pepper hash: <code>src/lib/access/access-codes.ts:1-20</code>.
- Public activation: <code>src/app/api/access-codes/activate/route.ts:14-124</code>.
- The User is found/created before the claim transaction at <code>27-32</code>.
- Code lookup, ACTIVE/unused/expiry validation, atomic claim and Access creation are at <code>34-93</code>.
- The route does not issue any session.
- The UI first calls unverified identify and therefore currently obtains authority indirectly: <code>src/app/(public)/tests/[slug]/test-access-form.tsx:244-269</code>.

Decision: <code>ACCESS_CODE</code> is an allowed verified-session source only when the same transaction validates and consumes the one-time code, binds/creates the exact User, creates or reuses the exact Access and creates the verified session record. Possession of the valid one-time code proves entitlement, not pre-existing email ownership. A used code cannot authorize a new subject or a new issuance operation.

### 3.7. Commercial Order and paid-access claim flow

Current evidence:

- The commercial security module has a 32-random-byte token primitive, but current Order creation uses a stable versioned HMAC-SHA-256 token derived from server secret plus Order/checkout/idempotency context; the database stores only its SHA-256 hash: <code>src/lib/commercial/security.ts:16-18</code>, <code>28-62</code>, and <code>src/lib/commercial/commercial-service.ts:397-412</code> and <code>434-443</code>.
- Order cookie is HttpOnly, SameSite=Lax, Secure in production and two days absolute: <code>src/lib/commercial/order-token.ts:15-22</code>.
- Order-token validation re-reads Order and constant-time checks the hash: <code>src/lib/commercial/order-token.ts:5-13</code>.
- Order creation is same-origin, rate-limited and idempotent, and sets the opaque Order cookie: <code>src/app/api/commercial/orders/route.ts:9-33</code>.
- Order creation stores normalized email and token hash in its transaction: <code>src/lib/commercial/commercial-service.ts:415-563</code>.
- Provider notification validates payment transition and creates at most one linked commercial Access transactionally: <code>src/lib/commercial/commercial-service.ts:758-933</code>, especially <code>879-905</code>.
- Claim requires the Order token and then proves PAID Order, valid linked Access and exact STUDENT User: <code>src/app/api/commercial/orders/[publicId]/claim-access/route.ts:10-24</code> and <code>src/lib/commercial/commercial-service.ts:1004-1031</code>.

Decision: this is a proven safe entitlement issuer and is allowlisted as <code>COMMERCIAL_ORDER_CLAIM</code>. The Order token remains a payment/order capability; it is not copied into the verified session and never becomes an analytics identifier.

### 3.8. Other current ways to obtain or influence student authority

| Mechanism | Repository evidence | Classification |
| --- | --- | --- |
| Raw-email generic access discovery | <code>src/app/api/access/check/route.ts:6-33</code>, <code>src/lib/access/access-check.ts:63-192</code> | Not a session issuer, but exposes status and entity IDs; must be generic-only |
| Generic Payment creation | <code>src/app/api/payments/create/route.ts:7-54</code>, <code>src/lib/payments/payment-service.ts:45-168</code> | Raw email can create User/Payment; provider success grants generic Access, but it is not a verified-session issuer |
| Generic provider/webhook Access grant | <code>src/lib/payments/payment-service.ts:176-320</code> | Provider authority creates generic Access; no student session issued |
| Manual admin Access | <code>src/lib/access/access-service.ts:46-82</code> | Admin authority creates Access; no student session issued |
| Commercial provider Access grant | <code>src/lib/commercial/commercial-service.ts:758-933</code> | Provider authority creates commercial Access; student session is issued only by later Order claim |
| Commercial Order cookie | <code>src/lib/commercial/order-token.ts:5-22</code> | Narrow order/payment capability and approved verified issuer proof |
| Admin session | <code>src/server/auth/session.ts:74-123</code> | Admin authority only; never a student issuer |
| Payment/manual-access email link | <code>src/server/emails/send-access-email.ts:19-50</code> | Current link is not a signed student credential; opening it still requires an authorized flow |

No password-based student authority exists and none is introduced.

### 3.9. Generic smoke dependent on identify

The generic browser smoke is <code>tests/e2e/mvp-smoke.spec.ts:91-116</code>. It opens a generic training test, submits “Проверить доступ,” creates and confirms a mock payment, starts/completes the Attempt and reads the Result. Its UI path calls identify through <code>test-access-form.tsx:115-162</code>.

This smoke must continue to pass in generic mode. A new negative companion test must prove that the same identify-created legacy cookie cannot open a commercial/authentic PRE, ATT or RES resource.

### 3.10. EventLog, analytics and sensitive logging inventory

| Area | Repository evidence | Finding / decision |
| --- | --- | --- |
| Unrestricted EventLog writer | <code>src/server/events/log-event.ts:4-21</code>; schema <code>prisma/schema.prisma:671-686</code> | Arbitrary JSON payload has no central sensitive-field filter |
| Raw email in identify event | <code>src/app/api/students/identify/route.ts:51-58</code> | Existing <code>student_identified</code> payload stores raw email |
| Raw email in Attempt-start event | <code>src/lib/attempts/attempt-service.ts:170-179</code> | Existing <code>attempt_started</code> payload stores raw email |
| Order status operational log | <code>src/app/api/commercial/orders/[publicId]/status/route.ts:13-15</code> | Logs publicId; no token, but it is capability-adjacent correlation data |
| Analytics forbidden-payload filter | <code>src/lib/analytics/forbidden-payload.ts:1-31</code> | Blocks email, token, authorization, cookie and other sensitive keys/values |
| Analytics schemas and writer | <code>src/lib/analytics/schemas.ts:97-110</code>, <code>src/lib/analytics/analytics-service.ts:32-79</code> | Six allowlisted events; failures do not affect domain writes |
| Analytics opaque entity hashes | <code>src/lib/commercial/commercial-service.ts:32-45</code> and <code>92-126</code> | Uses separately keyed hashes of public Order/Payment/Access IDs; no email |

The new verified-session subsystem uses a restricted security/audit stream, not AnalyticsEvent and not free-form EventLog payloads. It logs only a random correlation ID, source enum, outcome/revocation enum and coarse timestamp. It never logs email, raw token, token digest, cookie, source secret, AccessCode, Order token, request body or headers.

No verified-session field, including database id, digest, correlation id or key version, may be sent to analytics. Existing destination analytics may continue to emit their separately approved public product/test identifiers and opaque entity hashes.

## 4. Chosen session architecture

### 4.1. Two non-interchangeable authorization planes

1. **Legacy generic plane**
   - Cookie: <code>student_session</code>.
   - Guard: existing <code>requireStudent()</code>.
   - Scope: generic Test/Access/Attempt/Result and current generic Payment status only.
   - Issuer: <code>/api/students/identify</code>.
   - It cannot authorize anything classified commercial/authentic.

2. **Verified commercial plane**
   - Cookie: <code>verified_student_session</code>.
   - Guard: new <code>requireVerifiedCommercialStudent()</code>.
   - Source of session truth: a server-side <code>VerifiedStudentSession</code> row.
   - Scope: exact User + CommercialProduct + Test + Access.
   - Allowed source enum: <code>EMAIL_OTP_RECOVERY</code>, <code>ACCESS_CODE</code>, <code>COMMERCIAL_ORDER_CLAIM</code>.
   - It is revocable and has an absolute seven-day TTL with no sliding extension.

The new guard never calls <code>requireStudent()</code>. The legacy guard never reads <code>verified_student_session</code>.

### 4.2. Commercial/authentic classification

A resource is commercial/authentic if any one of these server-side facts is true:

- Test <code>examMode = RIKZ_RUSSIAN_2026</code>;
- Test is linked to the configured CommercialProduct;
- Access <code>source = COMMERCIAL</code>;
- any of <code>commercialProductId</code>, <code>commercialOrderId</code> or <code>commercialPaymentAttemptId</code> is non-null;
- Attempt links to such Access;
- Attempt snapshot has <code>examMode = rikz_russian_2026</code>;
- Result is the terminal projection of such Attempt.

Contradictory or partially populated classification data is treated as commercial/authentic and fails closed. A resource is generic only when all relevant persisted signals are consistently generic and all commercial linkage is absent.

Classification is performed server-side from persisted relations/snapshot before selecting a guard. It is not accepted from a request flag, URL, email, client state or cookie presence.

### 4.3. Exact guard functions and route dispatch

Future implementation should keep these separate boundaries:

- <code>requireStudent()</code>: unchanged legacy generic reader.
- <code>requireVerifiedCommercialStudent()</code>: reads only <code>verified_student_session</code>, validates its server row, User, absolute expiry, revocation and scope.
- <code>authorizeTestStart(testId)</code>: classifies Test/candidate Access, calls exactly one guard, then verifies User + Access + Test.
- <code>authorizeAttempt(attemptId)</code>: classifies Attempt from Access and snapshot, calls exactly one guard, then verifies User + Access + Attempt.
- <code>authorizeResult(attemptId)</code>: uses the same classification/ownership rule but only for a terminal Attempt and never calls completion/scoring.

The dispatchers are not fallback chains. Once classified commercial/authentic, absence or failure of the verified cookie returns a safe unauthorized/not-found response even when a valid legacy cookie exists.

### 4.4. Mixed-cookie behavior

If both cookies exist:

- a generic route reads only <code>student_session</code>;
- a commercial/authentic route reads only <code>verified_student_session</code>;
- no global “preferred cookie” exists;
- differing User subjects in the two cookies do not cross-authorize;
- an invalid verified cookie does not trigger legacy fallback;
- clearing/logging out one plane does not silently clear or authorize the other.

## 5. Minimal additive data model

This is an architectural schema proposal only. No Prisma file or migration is created.

Privacy classes:

- <code>SECRET-D</code>: secret derivative; equivalent to credential-verification material.
- <code>SEC-R</code>: restricted security metadata.
- <code>PII-L</code>: indirect link to a person through an internal User relation.
- <code>INTERNAL</code>: non-public operational metadata.

Illustrative Prisma shape:

    enum VerifiedStudentSessionSource {
      EMAIL_OTP_RECOVERY
      ACCESS_CODE
      COMMERCIAL_ORDER_CLAIM
    }

    enum VerifiedStudentSessionRevocationReason {
      LOGOUT
      EXPIRED
      ROTATED
      ACCESS_REVOKED
      SECURITY_REVOKED
      KEY_RETIRED
    }

    model VerifiedStudentSession {
      id                    String   @id @default(uuid()) @db.Uuid
      tokenDigest           String   @unique @map("token_digest")
      tokenKeyVersion       String   @map("token_key_version")
      tokenGeneration       Int      @default(1) @map("token_generation")
      userId                String   @map("user_id") @db.Uuid
      commercialProductId   String   @map("commercial_product_id") @db.Uuid
      testId                String   @map("test_id") @db.Uuid
      accessId              String   @map("access_id") @db.Uuid
      source                VerifiedStudentSessionSource
      sourceReferenceId     String   @map("source_reference_id") @db.Uuid
      issuanceOperationId   String   @map("issuance_operation_id") @db.Uuid
      issuedAt              DateTime @default(now()) @map("issued_at")
      expiresAt             DateTime @map("expires_at")
      lastRotatedAt         DateTime? @map("last_rotated_at")
      revokedAt             DateTime? @map("revoked_at")
      revocationReason      VerifiedStudentSessionRevocationReason? @map("revocation_reason")
      securityCorrelationId String   @unique @map("security_correlation_id") @db.Uuid
      createdAt             DateTime @default(now()) @map("created_at")
      updatedAt             DateTime @updatedAt @map("updated_at")

      user       User              @relation(fields: [userId], references: [id])
      product    CommercialProduct @relation(fields: [commercialProductId], references: [id])
      test       Test              @relation(fields: [testId], references: [id])
      access     Access            @relation(fields: [accessId], references: [id])

      @@unique([source, sourceReferenceId, issuanceOperationId])
      @@index([userId, commercialProductId, testId, expiresAt])
      @@index([accessId, expiresAt])
      @@index([tokenKeyVersion, expiresAt])
      @@map("verified_student_sessions")
    }

“ACTIVE” is derived, not stored: <code>revokedAt IS NULL AND serverNow &lt; expiresAt</code>. The session row is the source of truth for credential validity; User/CommercialProduct/Test/Access/Attempt tables remain the source of truth for current ownership and entitlement.

### 5.1. Field contract

| Field | Purpose and source of truth | Privacy | Required / nullable | Uniqueness | Retention | Logging | Analytics |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <code>id</code> | Internal session-row identity, generated by DB/app | SEC-R | Required | Primary key | Active lifetime + 7 days after terminal in ACC-01A dev/test | Never value; correlation uses separate id | Prohibited |
| <code>tokenDigest</code> | HMAC-SHA-256 lookup/verification value for raw cookie token | SECRET-D | Required | Globally unique | Same row; delete with row after terminal retention | Never | Prohibited |
| <code>tokenKeyVersion</code> | Selects allowlisted HMAC key | SEC-R | Required | Not unique | Same row | Only restricted key-version metric if needed; not ordinary logs | Prohibited |
| <code>tokenGeneration</code> | Monotonic counter for response-loss rotation of the same logical issuance | SEC-R | Required, default 1 | Not unique | Same row | Never per-request; safe outcome may include “rotated” enum only | Prohibited |
| <code>userId</code> | Exact User subject; User table is truth | PII-L | Required | Not unique | Same row | Never raw value in ordinary logs | Prohibited |
| <code>commercialProductId</code> | Exact approved commercial product scope; CommercialProduct is truth | INTERNAL | Required | Not unique | Same row | No raw DB id; approved product code may be logged by destination separately | Session field prohibited |
| <code>testId</code> | Exact Test scope; Test is truth | INTERNAL | Required | Not unique | Same row | No raw DB id | Session field prohibited |
| <code>accessId</code> | Exact entitlement bound to session; Access is truth | SEC-R | Required | Not unique | Same row | No raw DB id | Prohibited |
| <code>source</code> | Closed assurance/issuer enum | SEC-R | Required | Part of composite uniqueness | Same row | Allowlisted enum only | Prohibited |
| <code>sourceReferenceId</code> | Exact VerifiedRecoverySession, AccessCode or CommercialOrder source row selected by <code>source</code> | SEC-R | Required | Composite with source + operation | Same row | Never value | Prohibited |
| <code>issuanceOperationId</code> | Idempotency identity for one logical issuance/exchange | SEC-R | Required | Composite with source + reference | Same row | Never value; use securityCorrelationId | Prohibited |
| <code>issuedAt</code> | Original absolute-TTL start, server clock | SEC-R | Required | Not unique | Same row | Coarse time only in restricted audit | Prohibited |
| <code>expiresAt</code> | Absolute seven-day expiry; never extended by use or token rotation | SEC-R | Required | Not unique | Same row | Coarse expired outcome only | Prohibited |
| <code>lastRotatedAt</code> | Last credential rotation for response loss/security, not TTL | SEC-R | Nullable | Not unique | Same row | Rotation outcome enum only | Prohibited |
| <code>revokedAt</code> | Terminal server revocation time | SEC-R | Nullable | Not unique | Same row | Coarse time + reason enum only | Prohibited |
| <code>revocationReason</code> | Closed terminal reason | SEC-R | Nullable; required when revoked | Not unique | Same row | Allowlisted enum only | Prohibited |
| <code>securityCorrelationId</code> | Random restricted correlation for audit without subject/token values | SEC-R | Required | Globally unique | Same row; related security event may remain 30 days in ACC-01A dev/test | Allowed in restricted security logs | Prohibited |
| <code>createdAt</code> | Database audit time | INTERNAL | Required | Not unique | Same row | Coarse time only | Prohibited |
| <code>updatedAt</code> | Database mutation audit time | INTERNAL | Required | Not unique | Same row | Not per request | Prohibited |

Production retention remains a PRIV-01/ACC-01B decision. The dev/test contract is: active until expiry/revocation, terminal session row retained 7 days, then deleted; restricted security events retained 30 days. Cleanup never touches User, Order, Payment, Access, Attempt or Result data.

## 6. Cookie and token contract

### 6.1. Token

- Generate 32 random bytes with the operating-system CSPRNG for every initial issue and every credential rotation.
- Raw representation: <code>vs1.&lt;keyVersion&gt;.&lt;base64url-32-byte-secret&gt;</code>.
- Entropy is at least 256 random bits; prefixes and key version are non-secret metadata.
- Persist only <code>HMAC-SHA-256(versionedKey, "verified-student-session:v1" || rawToken)</code> as a fixed-format digest plus key version.
- Reject malformed version/length before digest lookup. Compare fixed-length digest bytes in constant time after lookup.
- Use a dedicated verified-session HMAC key ring. Do not reuse SESSION_SECRET, recovery OTP keys, AccessCode pepper, Order-token key or analytics key.
- New issuance uses the active key version. Readers retain old verification keys for at least the seven-day maximum TTL plus cleanup margin.
- Reading a session never rehashes it, rotates it or extends expiry.

### 6.2. Cookie

| Attribute | Fixed contract |
| --- | --- |
| Name | <code>verified_student_session</code> |
| Value | Raw opaque token only |
| HttpOnly | true |
| Secure | true in production and every production-like environment; fail closed if false there |
| SameSite | Lax |
| Path | <code>/</code> |
| Domain | Omitted; host-only |
| Max-Age / Expires | Seven days, never beyond row <code>expiresAt</code> |
| JavaScript access | Forbidden |
| URL/query/body transport | Forbidden |
| Cache | Responses that issue/read it use <code>Cache-Control: no-store</code> |

Mutation issuers additionally enforce same-origin Origin/Host checks. Clearing uses the exact same name/path/domain/SameSite/Secure attributes and an expired Max-Age.

### 6.3. Rotation, revocation and concurrency

- Initial issue always ignores any client-selected session id and generates fresh random token material.
- One logical issuance is unique by <code>(source, sourceReferenceId, issuanceOperationId)</code>.
- A same-operation retry never creates another logical row. If the browser already presents its valid verified cookie, the committed destination is returned unchanged.
- If an issuance committed but the Set-Cookie response was lost, the same-operation retry locks the logical row, replaces only <code>tokenDigest</code>/<code>tokenKeyVersion</code>, increments <code>tokenGeneration</code> and sets <code>lastRotatedAt</code>. It does not change <code>issuedAt</code> or <code>expiresAt</code>.
- Parallel retries serialize on the logical row. At most one token generation is current; late/stale response tokens map to no current digest and cannot authorize. The terminal recovery/order/code proof may replay only its already committed exchange until a valid destination read succeeds or the narrow replay window expires.
- Multiple independently proven browser sessions for the same User/Access are allowed. Revoking Access revokes every active verified session for that Access.
- Logout revokes the current verified row and clears its cookie. “Logout all devices” is out of scope.
- Expiry is absolute and no request slides it.
- A stolen token is handled by setting <code>revokedAt</code>/<code>SECURITY_REVOKED</code>, clearing when seen and requiring a fresh approved issuer proof.
- A compromised key version is retired, every non-expired row for that version is revoked with <code>KEY_RETIRED</code>, and a fresh proof is required.
- Cleanup marks elapsed rows expired if needed, then deletes terminal rows after retention. It never repairs or deletes business entities.

## 7. Issuer contract

### 7.1. Allowlist

| Source | Identity / entitlement proof | Exact transaction boundary | Scope | Idempotency | Restricted audit event | Forbidden data |
| --- | --- | --- | --- | --- | --- | --- |
| <code>EMAIL_OTP_RECOVERY</code> | ACTIVE unexpired VerifiedRecoverySession created by one-time OTP; verified normalized email; resolver proves exact User/Product/Test/Access and optional Attempt state | Lock recovery session; rerun resolver; upsert/rotate logical verified session; store committed action/destination; mark recovery session EXCHANGED/terminal. No business-entity writes | Exact User + Product + Test + Access from server recovery state | Recovery-session id + client operationId; same operation replays/rotates credential only | <code>VERIFIED_SESSION_ISSUED</code> or <code>VERIFIED_SESSION_ROTATED</code> with correlation/source/outcome | Email, OTP/MAC, recovery token/digest, verified token/digest, entity payload, destination query |
| <code>ACCESS_CODE</code> | Submitted raw code hashes to one ACTIVE, unused, unexpired code for exact Test; code possession proves entitlement | In one transaction: lock/claim code, find/create exact STUDENT User, create/reuse its Access, create verified session row. Cookie after commit | Exact User + mapped commercial Product + authentic Test + created Access | Code id + operationId; same email/test/operation may replay; different subject/operation after use is rejected | <code>ACCESS_CODE_VERIFIED_SESSION_ISSUED</code> | Raw code/hash, email, request body, token/digest |
| <code>COMMERCIAL_ORDER_CLAIM</code> | Matching opaque Order cookie digest plus PAID Order, provider-confirmed linked non-revoked Access and exact STUDENT User | Validate capability; lock Order/Access; verify linkage/status/deadline; create/upsert logical verified session. Does not create/modify Order, Payment or Access | Exact User + Order Product + Test snapshot + linked Access | Order id + operationId; same operation replays/rotates session only | <code>COMMERCIAL_SESSION_ISSUED</code> | Order token/hash, email, provider payload/reference, verified token/digest |

The source enum is closed. Adding an issuer requires a separate architecture/security approval and negative tests.

### 7.2. Explicitly forbidden issuer

<code>POST /api/students/identify</code> is not and can never be a verified issuer. It has no OTP, AccessCode or paid Order capability proof. It may issue only <code>student_session</code> for generic MVP.

The following also cannot issue verified authority by themselves:

- raw email or email hash;
- <code>/api/access/check</code> response;
- direct Attempt/Result URL or database/public id;
- Order publicId without matching Order token;
- payment redirect;
- provider callback without the existing server-side verification;
- an Access row without an approved issuer proof;
- recovery resolver state without a committed continuation exchange.

## 8. Recovery continuation contract

### 8.1. Request and validation

- Endpoint: future <code>POST /api/recovery/continue</code>.
- Exact JSON input: <code>{ "operationId": "&lt;uuid&gt;" }</code>.
- Authentication: <code>acc01a_recovery</code> HttpOnly cookie only.
- Client cannot supply email, User, product, test, Access, Attempt, Result, state, next action or destination.
- Validate recovery token digest, ACTIVE or exchange-replay state, absolute expiry, challenge lineage and immutable Product/Test scope.
- Read and lock the server recovery session before any exchange write.
- Rerun the canonical resolver against committed User/Order/Access/Attempt truth.

Only these states may exchange:

- <code>access_unstarted</code> → <code>OPEN_PRE</code>;
- <code>attempt_active</code> → <code>OPEN_ATTEMPT</code>;
- <code>result_available</code> → <code>OPEN_RESULT</code>.

All other canonical states return no destination and issue no verified session.

### 8.2. Commit

In one transaction:

1. lock and revalidate the recovery session;
2. rerun resolver and prove a unique exact User/Product/Test/Access;
3. for ATT/RES, prove the exact Attempt belongs to that User and Access;
4. create or rotate the logical VerifiedStudentSession for source <code>EMAIL_OTP_RECOVERY</code>;
5. store the committed next action and server-generated relative destination in the recovery exchange outcome;
6. mark the recovery session EXCHANGED/terminal for domain resolution;
7. commit.

After commit, set <code>verified_student_session</code> and return only:

    {
      "nextAction": "OPEN_PRE | OPEN_ATTEMPT | OPEN_RESULT",
      "nextUrl": "/server-generated-relative-destination"
    }

Destination allowlist:

- PRE: configured test route for the exact Test;
- ATT: <code>/attempts/&lt;exact-attempt-id&gt;</code>;
- RES: <code>/results/&lt;exact-attempt-id&gt;</code>.

No open redirect, client destination, query credential or directly reusable resolver response is allowed.

### 8.3. Forbidden effects

Continuation must not create or modify:

- User;
- CommercialOrder or generic Payment;
- CommercialPaymentAttempt or provider state;
- Access;
- Attempt or Answer;
- terminal Attempt result fields;
- snapshot, <code>startedAt</code>, <code>finishedAt</code> or calculated <code>endsAt</code>;
- scoring or lookup values.

It does not call provider, access grant, Attempt start, answer save, completion, expiry or scoring services.

### 8.4. Unknown outcome and retry

- First try the returned destination. A valid verified cookie proves the exchange committed.
- If the destination returns the safe session-required response and the narrow recovery exchange cookie is still present, retry the same <code>operationId</code>.
- The retry reads the committed exchange outcome and rotates only the verified token digest on the same logical session; absolute expiry is unchanged.
- A different operationId after exchange is rejected.
- Parallel calls may produce stale token generations, but stale tokens never authorize. A serialized same-operation retry converges to one current token and the same destination.
- Recovery authority remains terminal: during this narrow replay window it can only replay its committed exchange, not resolve a new state or access PRE/ATT/RES.
- After a successful destination authorization, clear the recovery cookie. Server-side exchange record remains terminal until retention cleanup.
- An unknown outcome never permits Order, Payment, Access, Attempt or Result creation.

## 9. Destination enforcement

| Destination / operation | Guard and classification | Mandatory scope check | Legacy compatibility | Commercial legacy-only result |
| --- | --- | --- | --- | --- |
| Generic access check / generic PRE | Generic Test and non-commercial Access only; current generic flow | Email/session rules remain generic | Preserved | Commercial/authentic records are filtered and never returned |
| Commercial/authentic PRE | <code>requireVerifiedCommercialStudent()</code> | session User/Product/Test/Access; Access non-revoked and usable; current start deadline | Generic PRE remains separate | 401/404 safe response; no fallback |
| Generic Attempt start | <code>requireStudent()</code> after consistent generic classification | User + generic Access + Test | Preserved | Not applicable |
| Commercial/authentic Attempt start | verified guard through <code>authorizeTestStart</code> | User + exact scoped Access/Test/Product; existing STARTED Attempt first | Shared URL may remain | Legacy-only cookie rejected |
| ATT read | <code>authorizeAttempt</code> selects exactly one plane | User + Access + Attempt + snapshot classification | Generic Attempt works | Legacy-only commercial request rejected |
| ATT answer save | same <code>authorizeAttempt</code> before save service | same User/Access/Attempt; status STARTED; snapshot question | Generic save works | Rejected |
| ATT complete/expire | same <code>authorizeAttempt</code> before completion service | same User/Access/Attempt; server timer | Generic completion works | Rejected |
| RES read | <code>authorizeResult</code> | terminal Attempt + same User/Access + retention/readability | Generic Result works | Rejected |
| Generic Payment status | legacy guard, generic Payment model only | Payment.userId | Preserved | Cannot query commercial tables |
| Commercial Order status/payment session/refresh | Existing Order token or provider proof, not either student cookie | Exact Order capability/provider facts | Unchanged | Legacy cookie is ignored |
| Commercial claim | Order token proof; issuer transaction | PAID Order + linked Access + exact User/Product/Test | Not a generic route | Issues verified cookie only |
| Commercial start wrapper | verified guard plus exact Order/Access linkage; no session issuance | same verified User/Product/Test/Access | Not a generic route | Legacy-only rejected |

Timer preservation:

- Session issuance and continuation never call <code>startOrRestoreAttempt</code>.
- ATT destination reads the existing Attempt.
- If PRE later starts, the existing transactional <code>startOrRestoreAttempt</code> behavior remains authoritative and returns an already STARTED Attempt without another decrement.
- <code>startedAt</code> and snapshot duration remain server timer truth; page reload cannot reset them.

Result preservation:

- Continuation never calls <code>completeAttempt</code> or scoring.
- RES GET queries a terminal Attempt and serializes stored fields only.
- Reopening Result cannot update Attempt/Answer/scoring fields.
- The limited-launch serializer gap must be fixed in its separately authorized scope; this bridge neither expands nor hides it by side effect.

## 10. Exact policy for <code>/api/students/identify</code>

The endpoint remains for generic MVP and is not deleted by this decision.

Fixed policy:

1. It may create/find a generic STUDENT User and issue only legacy <code>student_session</code>.
2. It never creates, rotates or upgrades <code>verified_student_session</code>.
3. Its cookie is ignored by every commercial/authentic guard and every recovery exchange.
4. It cannot authorize commercial Access, authentic PRE/ATT/RES, authentic answer save/completion/expiry, commercial claim or provider operations.
5. <code>/api/access/check</code> and the generic UI must not expose commercial/authentic Access/Attempt through email lookup.
6. Existing generic MVP behavior and generic smoke remain supported.
7. No new security/audit/analytics event copies raw or masked email, email hash, session token or digest.
8. The current raw-email <code>student_identified</code> EventLog payload is a documented existing risk. Removing/redacting that field is required before production recovery activation, but no logging code is changed in this task.

## 11. Compatibility, rollout and rollback

### 11.1. Compatibility matrix

| Case | Required behavior |
| --- | --- |
| Existing generic MVP | Continues through identify + legacy cookie + generic-only resources |
| Existing authentic STARTED Attempt | Classified from Access/snapshot; requires newly acquired verified session; original Attempt/timer remains |
| Existing authentic terminal Result | Requires verified session; reads same terminal Attempt without rescoring |
| Existing AccessCode | Generic codes keep generic flow; authentic commercial-product code claim becomes <code>ACCESS_CODE</code> verified issuer |
| Existing paid commercial Order/Access | Matching Order token can claim verified session; without token, OTP recovery is required |
| Existing browser with legacy cookie only | Generic continues; commercial/authentic receives safe session-required response |
| Both cookies | Per-resource plane selection; no precedence and no fallback |
| Expired/revoked verified cookie | Clear defensively, return safe unauthorized, require approved issuer |
| Access revoked after session issue | Domain recheck fails and all sessions for Access are revoked |
| Result retained beyond session TTL | User re-verifies through an approved issuer; session TTL does not become 12 months |

### 11.2. Future rollout plan

No rollout action is performed here.

1. Add empty enums/table/indexes/relations with an additive migration; no backfill and no business-table rewrite.
2. Add session token/key/cookie primitives and source-specific issuer services behind <code>VERIFIED_COMMERCIAL_SESSION_MODE</code> with exact values <code>off</code>, <code>shadow</code>, <code>enforce</code>; missing value is <code>off</code>.
3. In <code>shadow</code>, issue/test the new cookie and classification without using legacy fallback as evidence of commercial authorization; ACC-01A public surfaces remain disabled.
4. Migrate commercial claim to the new issuer and remove duplicate issuance from commercial start.
5. Add fail-closed resource classification and verified guards to PRE/ATT/RES/save/complete/expire.
6. Prove AccessCode and commercial Order issuer paths, mixed cookies, stale sessions and generic smoke.
7. Set <code>enforce</code> only in approved dev/test evidence environments. ACC-01A recovery cannot enable unless mode is <code>enforce</code>.
8. Production/production-like ACC-01A remains independently prohibited until ACC-01B, privacy, delivery and release gates close.

### 11.3. Rollback

Rollback must never reopen commercial/authentic legacy fallback.

1. Disable ACC-01A recovery and new issuer surfaces first.
2. Keep verified enforcement for already exposed commercial/authentic resources while the new reader is available.
3. Roll back UI/navigation independently; retain the additive table and sessions.
4. If application rollback cannot read verified sessions, place commercial/authentic PRE/ATT/RES in safe maintenance/unavailable mode. Do not run the old identify-authorized commercial path.
5. Generic MVP may remain available because it uses the separate legacy plane.
6. Revoke or let verified sessions expire; retain terminal rows through the defined cleanup window.
7. Drop an additive table only if confirmed empty, in non-production, with separate approval. Destructive rollback is not the default.

## 12. Future tests — specified, not executed

### Unit

- random token shape and at least 256-bit entropy;
- HMAC digest domain separation and key-version selection;
- absolute expiry boundary and no sliding extension;
- revocation and Access-revocation fan-out;
- source allowlist rejects identify/unknown source;
- token rotation increments generation without extending TTL;
- commercial/authentic classification including contradictory data fail-closed;
- mixed-cookie plane selection;
- no fallback from verified to legacy;
- security/analytics forbidden-field serialization.

### Integration

- generic identify → generic PRE/start/ATT/RES succeeds;
- generic identify → commercial PRE rejected;
- generic identify → commercial ATT read/save/complete/expire rejected;
- generic identify → commercial RES rejected;
- OTP continuation → commercial PRE allowed;
- OTP continuation → active ATT allowed with same timer;
- OTP continuation → RES allowed without scoring;
- replayed continuation returns same logical exchange;
- parallel continuation leaves one current token generation and no business write;
- revoked/expired session rejected;
- mixed cookies use resource-specific subjects;
- AccessCode issuer atomically claims code/Access/session;
- AccessCode retry cannot change subject;
- commercial Order issuer requires token + PAID + linked Access;
- commercial start is not an issuer;
- ownership mismatch and direct entity URL rejected.

### Browser

- generic smoke remains green;
- commercial recovery from no legacy cookie;
- reload of active Attempt keeps timer;
- new browser completes OTP recovery;
- active timer continues from original <code>startedAt</code>/<code>endsAt</code>;
- Result reopens without completion/scoring;
- mixed cookies;
- cookie inspection confirms HttpOnly/SameSite/Path/Secure policy and no token in HTML/client state;
- no hidden email, token/digest, authentic keys or prohibited Result fields.

### Security

- claim a victim email through identify, then attempt commercial PRE/ATT/RES;
- direct Attempt/Result entity URL;
- legacy cookie against every commercial endpoint;
- raw/revoked/stale token replay;
- session fixation with pre-seeded cookies;
- cross-user/cross-product/cross-Access scope;
- AccessCode race and replay;
- Order publicId without token;
- raw email, raw token, token digest, cookie and source secrets absent from logs/traces/analytics;
- key-version compromise revocation;
- CSRF on every issuer/logout mutation.

No tests, lint, typecheck, build or Playwright run is runtime evidence for this documentation-only decision.

## 13. Manual smoke — exactly 8 document-level scenarios

These are future specifications, not executed evidence.

| # | Initial state | Action | Backend evidence | Forbidden result | Final state |
| --- | --- | --- | --- | --- | --- |
| 1 | Published generic Test; no cookies; generic Access path available | Identify email, check/buy generic access, start, complete and open Result | Legacy cookie only; generic Access/Attempt ownership queries; existing generic EventLog flow | Verified session issued or commercial record returned | Generic flow completes unchanged |
| 2 | Commercial/authentic Access or Attempt exists; browser has only identify-created legacy cookie | Open commercial PRE and direct ATT/RES URLs | Resource classified commercial/authentic; verified guard alone returns safe unauthorized/not-found | Legacy fallback, entity disclosure or timer/result mutation | Commercial resource remains inaccessible |
| 3 | Valid ACC-01A OTP recovery session for unique unstarted commercial Access | Resolve, submit one operationId to continuation, open PRE | Recovery row locked/exchanged; one verified logical session; exact User/Product/Test/Access scope; no business write | New Order/Access/Attempt/Result, raw token/email log | Verified PRE opens; recovery is terminal |
| 4 | Existing STARTED authentic Attempt with original snapshot/start/end; valid recovery proof | Resolve, continue to ATT, reload | Same Attempt id, <code>startedAt</code>, calculated <code>endsAt</code>, snapshot and attemptsAvailable; verified ownership | New Attempt, Access decrement or timer reset | Same ATT resumes with remaining time |
| 5 | Existing readable terminal authentic Attempt/Result; valid recovery proof | Resolve, continue to RES, open twice | Same stored terminal fields; Result GET count; completion/scoring call count zero | Rescore, completion transition, Result mutation or prohibited limited-launch payload | Same RES reopens |
| 6 | Browser has valid legacy cookie for User A and verified cookie for User B | Open generic resource for A, then commercial resource scoped to B; repeat with one invalid cookie | Generic route reads only legacy; commercial route reads only verified; ownership filters match their own subject | Cross-cookie subject merge, global precedence or fallback | Each plane authorizes only its own scoped resource |
| 7 | Verified cookie is expired or row is revoked; legacy cookie is valid | Open commercial ATT/RES | Digest/row lookup shows expired/revoked; cookie clear response; no legacy guard call | Commercial access through legacy cookie or silent TTL extension | Safe unauthorized; fresh approved proof required |
| 8 | Valid recovery exchange; two parallel continuation requests; winning response is lost or stale response arrives last | Send same operationId concurrently, then retry serially and open destination | One logical session row, monotonic tokenGeneration, one current digest, same committed destination, terminal recovery exchange, zero business-entity writes | Two active generations, changed destination, new Order/Access/Attempt/Result | Serial retry converges to one valid verified session and original destination |

Manual smoke count: **8**.

## 14. Acceptance criteria — 36

1. Repository inventory lists every current <code>student_session</code> issuer and every reader/consumer with path and line range.
2. Inventory covers PRE, Attempt create/read/save/complete/expire, Result, AccessCode, commercial Order claim, other authority, generic smoke and sensitive logging.
3. <code>/api/students/identify</code> is never a verified issuer.
4. Existing generic MVP continues to use legacy <code>student_session</code>.
5. Generic access check cannot return a commercial/authentic Access or Attempt.
6. Commercial/authentic PRE rejects a legacy-only session.
7. Commercial/authentic ATT read rejects a legacy-only session.
8. Commercial/authentic answer save rejects a legacy-only session.
9. Commercial/authentic complete and expire reject a legacy-only session.
10. Commercial/authentic RES rejects a legacy-only session.
11. The verified session is opaque and its server-side row is credential source of truth.
12. Every raw token has at least 256 random bits and exists only in an HttpOnly cookie/process memory.
13. The database stores only a versioned HMAC digest, never raw token.
14. Raw token, digest, cookie, security correlation and session id are absent from analytics.
15. Raw token is absent from logs, traces, URLs, bodies, HTML and client state.
16. Session is explicitly revocable and Access revocation invalidates every session for that Access.
17. Session TTL is seven days absolute and neither reads nor rotation extend it.
18. Verified guard never calls or falls back to <code>requireStudent()</code>.
19. Mixed-cookie behavior is selected by persisted resource classification, not cookie precedence.
20. Commercial/authentic classification fails closed on contradictory linkage.
21. Recovery continuation input contains only operationId and server cookie proof.
22. Recovery continuation revalidates exact User/Product/Test/Access and Attempt when applicable.
23. Recovery continuation is idempotent by source/reference/operation.
24. Successful recovery exchange makes recovery authority terminal and limits replay to the committed exchange outcome.
25. Continuation creates no User, Order, PaymentAttempt, Access, Attempt, Answer or Result.
26. Continuation never calls payment/provider, Attempt start, save, completion, expiry or scoring.
27. Active Attempt recovery preserves Attempt id, snapshot, <code>startedAt</code> and <code>endsAt</code>.
28. Result recovery reads the existing terminal Attempt and does not recompute or mutate scoring.
29. <code>ACCESS_CODE</code> issuer is transactionally defined and does not depend on identify.
30. Used AccessCode cannot issue a session to a different subject or operation.
31. <code>COMMERCIAL_ORDER_CLAIM</code> requires matching Order token, PAID Order and linked live Access.
32. Commercial start wrapper no longer issues a student session.
33. Generic smoke and a negative identify-to-commercial bypass smoke are both specified.
34. Existing raw-email EventLog risk is inventoried and no new session/security logging repeats it.
35. Additive migration, mixed-cookie/stale-session rollout and fail-closed rollback are defined.
36. ACC-01A and production activation remain unclaimed until central approval, implementation evidence and external gates.

Acceptance criteria count: **36**.

## 15. Risk register

| Risk | Impact | Mitigation / required future evidence |
| --- | --- | --- |
| Generic regression | High | Keep legacy plane; run exact generic smoke before/after enforcement |
| Shared route accidentally permits fallback | Critical | One persisted classifier, one selected guard, negative legacy-cookie tests for every shared route |
| Incomplete issuer inventory | Critical | Static call-site scan plus reviewed allowlist; unknown source fails closed |
| AccessCode regression/race | Critical | Move User/code/Access/session boundary into one transaction; replay/concurrency tests |
| Mixed-cookie ambiguity | Critical | Resource-selected plane, not global cookie priority; two-subject browser test |
| Migration/rollback error | High | Additive empty table, no backfill, retain table on rollback, maintenance instead of fallback |
| Revocation cleanup failure | High | Indexed expiry/access/key scans, cleanup metrics and stale-token tests |
| Raw email/token logging | Critical | Restricted audit schema, no free text/body/header dumps, stored-log and analytics scans |
| Broad change to <code>requireStudent()</code> | High | Leave it generic; add separate verified guard and small dispatchers |
| Result serializer gap | Critical for limited launch | Separate strict primary-only serializer task and network evidence; bridge never recomputes |
| Production activation leakage | Critical | ACC-01A hard gate plus enforcement-mode prerequisite; production-like config negative test |
| Concurrent response ordering leaves stale cookie | High | Logical-row generation, stale digest rejection, narrow exchange replay and serial convergence test |
| Access revoked while session remains | Critical | Recheck Access every request and revoke sessions by accessId |
| Key compromise | Critical | Dedicated versioned key ring, bulk version revocation and fresh issuer proof |
| Commercial page still exposes generic access form | Critical | Generic access query filters authentic/commercial resources; future UI split evidence |

## 16. Unresolved implementation and external blockers

The chosen architecture is approved and compatible with the inspected repository. Approval permits only sequential bounded dev/test implementation tasks; it does not authorize production activation. The remaining implementation and external blockers are:

1. additive Prisma design/migration through an authorized bounded task;
2. verified-session primitives, including token issuance, versioned HMAC digest verification, absolute expiry and revocation;
3. transactional implementation of the approved recovery, AccessCode and commercial Order claim issuers, including idempotent retry;
4. verified guards and persisted resource classification without fallback;
5. current raw-email EventLog remediation and sensitive-log scans;
6. separate primary-only Result serializer gap closure for the limited launch;
7. runtime unit/integration/browser/security/manual evidence;
8. ACC-01B production email provider, privacy, DNS, delivery QA and explicit production activation approval;
9. production retention approval under PRIV-01/ACC-01B;
10. support activation and remaining release gates.

These blockers do not reopen or justify an alternative architecture. They prevent READY, production and launch claims; each implementation blocker must be closed by a sequential bounded dev/test task with its own evidence.

## 17. Non-blocking errata for the recovery specification

The source <code>acc-01a-recovery-spec-v1.md</code> is corrected alongside this approval without changing its architecture, product or security contract.

1. Section 15 says dev/test recovery retention is fixed by SD-14. This is incorrect: SD-14 is the CSRF decision. Retention is fixed by the separate retention contract in section 9.
2. Acceptance criterion 12 must refer to <code>SD-04–SD-07</code>, not <code>SD-04–SD-06</code>, because the failed-verify source limit is SD-07.

## 18. Verification performed for this decision

- Confirmed detached baseline SHA: <code>6cbdb2d2fdb58977a0a648e7e956edf95521a907</code>.
- Performed read-only repository scans for session issuers/readers, every <code>requireStudent()</code> call, PRE/ATT/RES, AccessCode, commercial Order claim, generic smoke and EventLog/analytics.
- Cross-checked Final MVP security/transaction rules, current approved student security, ACC-01A recovery specification and Stage 7 launch controls.
- Did not run lint, unit tests, typecheck, build or Playwright because the task explicitly requires documentation-only architecture and future tests must be specified but not executed.
- Did not change application code, Prisma, migrations, APIs, UI, tests or configuration.
- Modified only the approved status/dependency wording and the two documented errata in <code>acc-01a-recovery-spec-v1.md</code>; no application or configuration change was made.
- Did not commit, push, open a PR, merge, rebase, amend or force-push.

## 19. Final status

**APPROVED ACC-01A VERIFIED DESTINATION-SESSION ARCHITECTURE — CANONICAL FOR BOUNDED DEV/TEST IMPLEMENTATION — NO CODE CHANGES**

This approval permits only sequential bounded dev/test implementation tasks. It does not declare ACC-01A READY, production-ready or launch-ready and does not authorize production activation.
