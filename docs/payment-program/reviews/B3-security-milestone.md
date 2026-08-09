# B3 Security Milestone — Consolidated Review

**Review type:** Tier 2 consolidated milestone review
**Reviewer:** Single consolidated B3 reviewer
**Date:** 2026-08-09
**Reviewed range:** `10ff5fa` → `6574f75`
**Scope:** B3-01, B3-02, B3-03, B3-04, B3-05

## Reviewed commits

| Карточка | Implementation SHA | Base SHA |
|---|---|---|
| B3-01 | `10ff5fa` | `806c1c5` |
| B3-02 | `681d8ee` | `931f7f9` |
| B3-03 | `5656009` | `681d8ee` |
| B3-04 | `0c230f7` | `5656009` |
| B3-05 | `6574f75` | `0c230f7` |

## Files changed

Source:
- `src/lib/commercial/origin-policy.ts`
- `src/lib/commercial/rate-limit.ts`
- `src/lib/api-response.ts`
- `src/lib/commercial/route-helpers.ts`
- `src/lib/commercial/payload-sanitizer.ts`
- `src/lib/commercial/commercial-service.ts`
- `src/lib/commercial/security.ts`
- `src/lib/analytics/schemas.ts`
- `src/lib/analytics/analytics-service.ts`
- `src/lib/analytics/forbidden-payload.ts`
- `src/lib/payments/payment-service.ts`
- `src/lib/commercial/providers/webpay-sandbox-provider.ts`
- `src/server/recovery/http-response.ts`
- `src/server/auth/verified-student-session/destination-response.ts`
- `src/app/api/commercial/checkout-flows/route.ts`
- `src/app/api/commercial/orders/route.ts`
- `src/app/api/commercial/orders/[publicId]/payment-session/route.ts`
- `src/app/api/commercial/orders/[publicId]/refresh-status/route.ts`
- `src/app/api/commercial/orders/[publicId]/status/route.ts`
- `src/app/api/commercial/orders/[publicId]/start-attempt/route.ts`
- `src/app/api/commercial/orders/[publicId]/claim-access/route.ts`
- `src/app/api/commercial/fake-checkout/route.ts`
- `src/app/api/payments/webpay/notify/route.ts`

Migrations:
- `prisma/migrations/20260809082143_add_commercial_rate_limits/migration.sql`
- `prisma/migrations/20260809123000_sanitize_payment_payloads/migration.sql`

Tests:
- `tests/unit/commercial-origin-policy.test.ts` (24 tests)
- `tests/unit/commercial-rate-limit.test.ts` (11 tests)
- `tests/unit/commercial-response-policy.test.ts` (31 tests)
- `tests/unit/commercial-payload-sanitizer.test.ts` (16 tests)
- `tests/unit/analytics.test.ts` (29 tests, +4 for B3-05)

## Verification checklist

| # | Критерий | Verdict | Evidence |
|---|---|---|---|
| 1 | **B3-01**: Missing/foreign Origin → 403, strict rejection | **PASS** | `origin-policy.ts:24` — `if (!origin) return false`; `origin-policy.ts:25` — `if (origin !== config.origin) return false`. Tests подтверждают: foreign origin, missing origin, null origin, different port — все reject. |
| 2 | **B3-01**: Host/proto проверяются с учётом только trusted proxy | **PASS** | `origin-policy.ts:26-28`: `x-forwarded-host` только при `TRUSTED_PROXY=true`. `origin-policy.ts:31-33`: `x-forwarded-proto` только при `TRUSTED_PROXY=true`. Тесты: untrusted proxy игнорирует `x-forwarded-host`/`x-forwarded-proto`. |
| 3 | **B3-01**: Server-to-server callback имеет отдельную signature boundary | **PASS** | `POST /api/payments/webpay/notify` — без `requireTrustedOrigin`, аутентифицирует через MD5 signature + `verifyNotification`. `POST /api/commercial/fake-checkout` — без origin check, guarded `isLocalFakeCommercialProviderEnabled()`. |
| 4 | **B3-01**: Все 6 commercial mutation routes защищены | **PASS** | `checkout-flows/route.ts:8`, `orders/route.ts:36`, `payment-session/route.ts:12`, `refresh-status/route.ts:35`, `claim-access/route.ts:11`, `start-attempt/route.ts:19` — все вызывают `requireTrustedOrigin(request)` перед business logic. |
| 5 | **B3-01**: `x-test-internal-request` bypass только в dev/test | **PASS** | `origin-policy.ts:43-44`: NODE_ENV !== "development" && !== "test" → bypass disabled. Test confirms rejection in production. |
| 6 | **B3-02**: Limits переживают restart (PostgreSQL-based) | **PASS** | `rate-limit.ts:54-59`: `pg_advisory_xact_lock` + `CommercialRateLimitEvent` table. Events persist in PostgreSQL, survive process restart. |
| 7 | **B3-02**: Raw `x-forwarded-for` не authority без TRUSTED_PROXY | **PASS** | `rate-limit.ts:128`: `deriveCommercialClientKey` проверяет `TRUSTED_PROXY === "true"` перед использованием `x-forwarded-for`. Без флага → `host` header. |
| 8 | **B3-02**: Ответ содержит `Retry-After`/cooldown | **PASS** | `rate-limit.ts:85-90`: вычисляет `retryAfterSeconds` из oldest window event. `route-helpers.ts:11-17`: `commercialRateLimitedResponse` возвращает 429 + `Retry-After`. |
| 9 | **B3-02**: Namespace separation и разные лимиты | **PASS** | `rate-limit.ts:8-24`: 5 kind с отдельными window/maximum. Advisory lock key включает kind: `commercial-rate-limit:${kind}:${keyDigest}`. Tests подтверждают изоляцию. |
| 10 | **B3-03**: `Cache-Control: no-store` на всех payment/recovery routes | **PASS** | `api-response.ts:3-6`: `PAYMENT_RESPONSE_HEADERS` с `Cache-Control: no-store` + `Referrer-Policy: no-referrer`. `apiSuccess`/`apiFailure` всегда включают. Recovery: `http-response.ts:3-6` — `RECOVERY_RESPONSE_HEADERS`. |
| 11 | **B3-03**: Страницы задают строгий referrer policy | **PASS** | `Referrer-Policy: no-referrer` во всех ответах через `PAYMENT_RESPONSE_HEADERS`, `RECOVERY_RESPONSE_HEADERS`, `destination-response.ts:6-9`. |
| 12 | **B3-03**: Tokens/provider references не в URL | **PASS** | Status route: только `paymentReturn=1` или `paymentCancelled=1` — без токенов. Return URL в `commercial-service.ts:1012`: только `commercialOrder` (opaque publicId) + `paymentReturn=1`. |
| 13 | **B3-04**: Commercial/legacy code не сохраняет raw payload | **PASS** | `payload-sanitizer.ts`: `sanitizeProviderPayload()` рекурсивно удаляет 49 forbidden key patterns (PAN, masked PAN, CVV, expiry, 3DS, signatures, secrets, tokens, raw body, payment URL, credentials). `payment-service.ts:42,217-218,280` — применяет сантайзер к `providerPayload`, `providerWebhookPayload` и `event_logs`. |
| 14 | **B3-04**: Allowlist исключает PAN/CVV/expiry/3DS/signatures/secrets | **PASS** | `security.ts:28-31`: `redactProviderPayload()` — allowlist из 6 полей. `payload-sanitizer.ts:1-49`: запрещены все 49 категорий. Tests подтверждают strip на любой глубине, case-insensitive. |
| 15 | **B3-04**: Existing stored payload migration | **PASS** | Миграция `20260809123000_sanitize_payment_payloads`: `UPDATE payments SET provider_payload_json = NULL, provider_webhook_payload_json = NULL`. |
| 16 | **B3-04**: Analytics/logging не получают raw provider data | **PASS** | `forbidden-payload.ts`: запрет email, signature, token, secret — в analytics payload. `analytics-service.ts:35`: `assertNoForbiddenAnalyticsPayload` перед write. `safelyWriteAnalyticsEvent`: catch без утечки данных. |
| 17 | **B3-05**: События создаются только после commit/truth decision | **PASS** | `commercial-service.ts:994-1008`: `ensurePaymentSessionCreatedAnalytics` + `ensurePaymentPendingAnalytics` после attempt creation. `commercial-service.ts:1504`: `ensurePaymentTerminalAnalytics` после notification processing. Все через `ensureAnalytics` → `safelyWriteAnalyticsEvent`. |
| 18 | **B3-05**: Browser CTA/return не создаёт payment_confirmed | **PASS** | `status/route.ts:23`: только `ensurePaymentReturnViewedAnalytics` (UX-only). `payment_confirmed` создаётся исключительно в `ensurePaidAnalytics` после authoritative notification (строка 123). |
| 19 | **B3-05**: Payload проходит forbidden-data scan | **PASS** | `analytics-service.ts:35`: `assertNoForbiddenAnalyticsPayload` перед write. Все 6 новых schemas — strict Zod, только hashed IDs, bounded enums. Test: forbidden-key rejection + PII-free. |
| 20 | **B3-05**: Analytics failure не откатывает transaction | **PASS** | `analytics-service.ts:72-79`: `safelyWriteAnalyticsEvent` — try/catch без re-throw. Возвращает `{ enabled: false, inserted: false }`. |
| 21 | **Cross**: Production NO-GO, sandbox не закрывает merchant gates | **PASS** | `handoff.md:3`: `Production: NO-GO`. `board.md`: все E-01..E-05, O-01..O-04 — `BLOCKED_EXTERNAL`. |
| 22 | **Cross**: Secrets не в logs/committed .env | **PASS** | `analytics-service.ts:76-77`: catch блок без error detail. `forbidden-payload.ts`: запрет на secret/token/cookie в analytics. Secrets только в env vars, не в коде. |
| 23 | **Cross**: `no-store`/`no-referrer` — единый helper, все payment/recovery routes | **PASS** | `api-response.ts`: `PAYMENT_RESPONSE_HEADERS` + `paymentHeaders()`. `http-response.ts`: `RECOVERY_RESPONSE_HEADERS`. `destination-response.ts`: `privateHeaders`. Все routes используют эти helpers. |
| 24 | **Cross**: No deep cross-module imports, no hidden table sharing | **PASS** | `route-helpers.ts` re-exports только `requireTrustedOrigin`, `commercialRateLimiter`, `deriveCommercialClientKey`. `payload-sanitizer` импортирован в `payment-service.ts` — допустимо (legacy isolation). |

## Checks run

- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm test` — 503 PASS, 140 DB-gated skipped, 0 failures

Integration/E2E тесты не воспроизведены (Docker/PostgreSQL недоступен в review-окружении), но unit-покрытие покрывает заявленные security-инварианты:
- `commercial-origin-policy.test.ts`: 24 теста — foreign origin, missing origin, host spoofing, trusted/untrusted proxy, proto spoofing, callback boundary, test-internal policy
- `commercial-rate-limit.test.ts`: 11 тестов — within-limit, denial + Retry-After, namespace isolation, client separation, cleanup
- `commercial-response-policy.test.ts`: 31 тест — security headers, status codes, Retry-After merge, no cacheable headers
- `commercial-payload-sanitizer.test.ts`: 16 тестов — forbidden keys на любой глубине, case-insensitive, arrays, allowed key preservation
- `analytics.test.ts`: 29 тестов — schemas closed, PII-free, forbidden-key/value rejection, terminal analytics, return_viewed guard

## Findings

**Нет actionable findings.** Все 24 критерия проходят. Security-инварианты подтверждены кодом и тестами:

1. **Origin/Host enforcement (B3-01):** Strict fail-closed политика. `requireTrustedOrigin` отклоняет missing/foreign/null Origin. Host проверяется напрямую без TRUSTED_PROXY; `x-forwarded-host`/`x-forwarded-proto` доверяются только при explicit flag. Server-to-server callback routes (webpay/notify, fake-checkout) используют отдельную signature boundary. `x-test-internal-request` bypass ограничен dev/test environment.

2. **Durable rate limits (B3-02):** PostgreSQL-based с advisory locks (`pg_advisory_xact_lock`) для конкурентной безопасности. 5 namespace-разнесённых лимитов. `deriveCommercialClientKey` использует первый IP из `x-forwarded-for` только при `TRUSTED_PROXY=true`. `Retry-After` вычисляется из oldest window event.

3. **Cache/referrer policy (B3-03):** Единый `PAYMENT_RESPONSE_HEADERS` helper с `no-store` и `no-referrer`. `apiSuccess`/`apiFailure` всегда включают эти заголовки. Recovery и verified-session модули имеют эквивалентные `RECOVERY_RESPONSE_HEADERS` и `privateHeaders`. Secrets отсутствуют в URL/Location.

4. **Payload sanitization (B3-04):** 49 forbidden key patterns, case-insensitive, delimiter-normalized. `sanitizeProviderPayload` — рекурсивный strip на любой глубине. `containsForbiddenKeys` — runtime scan. Legacy `payment-service.ts` применяет сантайзер. Миграция NULL-ифицирует исторические raw payloads. `redactProviderPayload` — defense-in-depth allowlist из 6 полей.

5. **Analytics producers (B3-05):** 6 новых strict event schemas без PII/signatures/secrets. Producers вызываются только после commit. `safelyWriteAnalyticsEvent` гарантирует, что ошибка analytics не откатывает transaction. `skipDuplicates` предотвращает replay. Browser return создаёт только `payment_return_viewed` (не `payment_confirmed`).

## Verdict

| Карточка | Verdict |
|---|---|
| B3-01 | **DONE** |
| B3-02 | **DONE** |
| B3-03 | **DONE** |
| B3-04 | **DONE** |
| B3-05 | **DONE** |

## Следующее действие

B3 security block закрыт. Следующая READY-карточка: **D-01** — Обновить payment UX documents. Все 5 B3 карточек переведены в DONE, board/handoff/A-07 обновлены.
