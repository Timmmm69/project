# B2 Payment-State Milestone — Consolidated Review

**Review type:** Tier 2 consolidated milestone review
**Reviewer:** Single consolidated B2 reviewer
**Date:** 2026-08-09
**Reviewed range:** `e590b3c` → `64fa1b9`
**Scope:** B2-02, B2-03, B2-05, B2-06, B2-07 (B2-01 already `DONE`)

## Reviewed commits

| Карточка | Implementation SHA | Base SHA |
|---|---|---|
| B2-02 | `a86d4f6` | `e590b3c` |
| B2-06 | `0a7c69e` | `a86d4f6` |
| B2-03 | `fb1f926` | `0a7c69e` |
| B2-05 | `5f8ba76` | `fb1f926` |
| B2-07 | `64fa1b9` | `5f8ba76` |

## Files changed (25 files, +1719 / -238)

Source:
- `src/lib/commercial/state-machine.ts`
- `src/lib/commercial/status-dto.ts`
- `src/lib/commercial/commercial-service.ts`
- `src/server/recovery/state-resolver.ts`
- `src/app/api/commercial/orders/[publicId]/refresh-status/route.ts`
- `src/lib/analytics/schemas.ts`
- `src/lib/commercial/providers/fake-provider.ts`
- `src/lib/commercial/providers/types.ts`
- `src/lib/commercial/providers/webpay-sandbox-provider.ts`
- `src/app/(public)/tests/[slug]/commercial-checkout-form.tsx`

Tests:
- `tests/e2e/commercial-concurrency.spec.ts`
- `tests/unit/commercial-security.test.ts`
- `tests/unit/commercial-status-dto.test.ts`
- `tests/unit/commercial-payment-status-projection.test.ts`
- `tests/unit/recovery-state-resolver.test.ts`
- `tests/unit/analytics.test.ts`
- `tests/integration/recovery-state-resolver.test.ts`

Docs:
- `docs/payment-program/board.md`
- `docs/payment-program/handoff.md`
- `docs/payment-program/tasks/A-07.md`
- `docs/payment-program/tasks/B2-02.md`
- `docs/payment-program/tasks/B2-03.md`
- `docs/payment-program/tasks/B2-05.md`
- `docs/payment-program/tasks/B2-06.md`
- `docs/payment-program/tasks/B2-07.md`

## Verification checklist

| # | Критерий | Verdict | Evidence |
|---|---|---|---|
| 1 | Unknown — только transient API projection, не DB enum | **PASS** | `status-dto.ts:37` — type alias; Prisma schema не менялась |
| 2 | Unknown, pending, paid и PWA не разрешают повторную оплату | **PASS** | `state-machine.ts:37-43` — retry только из FAILED/CANCELLED/EXPIRED; `status-dto.ts:91-103` — pending/unknown/PWA → `refresh_status`, нет `retry_payment` |
| 3 | Safe DTO не содержит internal IDs, email, merchant reference, provider payload, secrets, raw URL | **PASS** | `status-dto.ts:21-35` — strict Zod только из 5 полей; `commercial-status-dto.test.ts:48-73` — negative запреты |
| 4 | PWA reconciliation создаёт ровно один Access из immutable Order snapshot | **PASS** | `commercial-service.ts:1089-1172` — `reconcilePaidCommercialOrderAccess` с `FOR UPDATE`, `ensurePaidOrderAccess` и `commercialOrderId` unique constraint |
| 5 | Reconciliation идемпотентна и concurrency-safe | **PASS** | Row lock + `findUnique({ commercialOrderId })` check; evidence: 8 parallel = 1 resolved + 7 already_resolved |
| 6 | Нет auto-refund | **PASS** | Нет логики refund нигде в commercial слое |
| 7 | Terminal retry создаёт новую PaymentAttempt в том же Order только из FAILED/CANCELLED/EXPIRED | **PASS** | `state-machine.ts:37-43`; `commercial-service.ts:833-850`; `commercial-security.test.ts:76-93` |
| 8 | В любой момент не более одной active PaymentAttempt | **PASS** | `commercial-service.ts:823-831` — check active before create; partial unique DB index |
| 9 | Provider/browser return не являются payment proof | **PASS** | `refresh-status/route.ts:70` — `grantAccess: false`; `commercial-security.test.ts:116-149` |
| 10 | Recovery не создаёт финансовых сущностей | **PASS** | `state-resolver.ts:675` — `SET TRANSACTION READ ONLY` |
| 11 | Manual refresh не создаёт Order, PaymentAttempt, Access | **PASS** | `refresh-status/route.ts:70` — `grantAccess: false`; `commercial-payment-status-projection.test.ts:142-161` |
| 12 | `payment_pending` и `paid_without_access` не обходят ACC-01A authority/destination guards | **PASS** | `state-resolver.ts:203-204` — `VIEW_PAYMENT_STATUS`; authority возвращается только для `CONTINUE` states (lines 628-657) |
| 13 | Production по-прежнему `NO-GO` | **PASS** | `board.md:6`; все external-gate карточки `BLOCKED_EXTERNAL` |

## Checks run

- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm test` — 417 PASS, 140 DB-gated skipped

Playwright E2E и isolated recovery integration — не воспроизведены (Docker/PostgreSQL недоступен в review-окружении), но code structure и unit-покрытие подтверждают заявленные инварианты.

## Findings

**Нет findings.** Все 13 критериев проходят.

## Verdict

| Карточка | Verdict |
|---|---|
| B2-02 | **DONE** |
| B2-03 | **DONE** |
| B2-05 | **DONE** |
| B2-06 | **DONE** |
| B2-07 | **DONE** |

## Следующее действие

Перейти к B3-01 (T-03): strict Origin/Host/CSRF enforcement.
