# Approved Decisions Current

Дата фиксации: 2026-07-01.

Этот документ фиксирует текущие утвержденные решения для разработки MVP. Главный источник истины по scope остается `docs/00-final-mvp-spec-v2.md`.

Для платёжной программы применяются source hierarchy и conflict register из `docs/payment-program/sources/README.md` и `docs/payment-program/source-reconciliation.md`. Пока карточки reconciliation не приняты независимым review, противоречия между этим документом, Final MVP Spec, Payment UX Contract и ACC-01A не разрешаются молча и блокируют зависимую feature-реализацию.

## Technical Base

- Локальная база: PostgreSQL через Docker.
- ORM: Prisma через `DATABASE_URL`.
- Локальный `.env` создается из `.env.local.example`.
- Первый dev-админ создается через `pnpm seed:admin`.
- Production-хостинг пока не выбран.
- Архитектуру не привязывать жестко к одному hosting provider.

Dev values:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/russian_tests_mvp?schema=public"
SESSION_SECRET="dev_only_replace_with_64_random_chars_before_production_1234567890"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="ChangeMeAdmin123!"
```

Production values must be replaced. `SESSION_SECRET` in production must be random and at least 32-64 characters.

## Admin

- Dev admin:
  - email: `admin@example.com`;
  - password: `ChangeMeAdmin123!`.
- Password must be stored only as hash.
- Seed must upsert existing admin and not create duplicates.

## Demo Content

- Пока реальных тестов нет.
- Для разработки нужен demo-content:
  - 1 demo test;
  - 8-12 demo questions;
  - all MVP question types: `single_choice`, `multiple_choice`, `short_text`;
  - topics: Орфография, Пунктуация, Грамматика, Лексика;
  - mostly 1 point, `multiple_choice` may be 2 points;
  - explanations optional.
- Demo content is not final educational content.
- Real tests must later be provided or verified by a Russian-language expert.

## CE/CT Scale

- Реальной шкалы 0-100 пока нет.
- Для разработки использовать dev-only scale:
  - `DEV ONLY — not real exam scale`;
  - text: `Техническая тестовая шкала для разработки. Не использовать как реальный экзаменационный результат.`
- Dev scale is for mechanics only and must not be shown as real CE/CT result.

## Payments

- Target checkout v1: WEBPAY internet acquiring through hosted checkout.
- Redirect to WEBPAY uses a server-built POST form in the same browser tab.
- ЕРИП is deferred and must not appear in the first-launch checkout UI.
- `PAY-01A = READY` as the approved product/UX target.
- `PAY-01B = BLOCKED`; real payments and production activation remain `NO-GO`.
- Keep the `PaymentProvider` abstraction.
- Local fake and WEBPAY sandbox modes are allowed only in dev/test; they do not prove the merchant-approved protocol.
- Do not activate or claim production WEBPAY support until merchant agreement, eligibility, exact docs, credentials, real sandbox evidence, legal/operations gates and final security/QA review exist.
- Backend/provider verification is the source of truth for amount, currency and payment status.
- Browser return alone must never mark a payment paid or create Access.
- Card inputs, PAN/CVV and embedded bank forms are prohibited.
- ЕРИП/ExpressPay E-POS scaffolds are not canonical checkout and must remain disabled/isolated until removed or separately approved.
- Provider callbacks and status refresh must be idempotent.
- One successful payment must not create two accesses.
- Raw provider payload, signatures, secrets and raw payment URLs must not be persisted; only allowlisted metadata is permitted.
- Payment errors must be logged.

## Email

- Real email provider is not selected.
- Use email abstraction and mock/log email in development.
- Every send attempt must be recorded in `email_logs`.
- Email failure must not break access creation.
- Dev sender placeholder: `no-reply@example.com`.

Required MVP email texts:

### Payment Success

Subject: `Доступ к тесту открыт`

```text
Здравствуйте.

Ваш доступ к тесту открыт.

Тест: {{test_title}}
Email: {{student_email}}
Количество попыток: {{attempts_total}}
Доступ действует до: {{expires_at}}

Перейти к тесту: {{test_link}}

Если вы не совершали оплату, просто проигнорируйте это письмо.
```

### Manual Access

Subject: `Вам открыт доступ к тесту`

```text
Здравствуйте.

Преподаватель открыл вам доступ к тесту.

Тест: {{test_title}}
Email: {{student_email}}
Количество попыток: {{attempts_total}}
Доступ действует до: {{expires_at}}

Перейти к тесту: {{test_link}}
```

Email after code activation and attempt completion remain P0.5.

## Legal Pages

Legal materials are not ready and do not block development.

Add placeholder routes later:

- `/privacy`;
- `/terms`;
- `/refund-policy`;
- `/contacts`.

Placeholder text: `Content pending.`

## Brand And UI

- Temporary product name: `Русский язык. Онлайн-тесты`.
- Current UI: neutral, clean, calm, responsive desktop/mobile.
- No final bright branding, complex graphics, logo, or final visual style yet.
- Later replace name, colors, logo, texts, and visual style.

## Student Security

Approved MVP approach:

- email + signed token/cookie;
- no password;
- no student personal account;
- backend always checks access, attempt and result ownership.

Rules:

- Do not use raw email as the only key to access tests, attempts or results.
- Signed token must expire.
- Cookie must be `httpOnly`, `sameSite`, and `secure` in production.
- Backend always checks ownership:
  - Access belongs to user;
  - Attempt belongs to user;
  - Result belongs to user.
- Student cannot start test without active Access.
- Student cannot see another student's result.
- Correct answers cannot be returned before attempt completion.
- Scoring is backend-only.
- AccessCode must be stored as hash.
- Payment webhook must be idempotent.
- Refreshing started attempt must not decrement attempts again.

## Rate Limiting

Add basic architecture for:

- admin login;
- access code activation;
- student identify/access check;
- payment create;
- brute force protection for access codes;
- logging repeated suspicious activation failures.

## Current Work

- Continue Phase 3: Questions Builder.
- UI remains neutral.
- Local verification uses PostgreSQL through Docker.
- Payments follow the approved WEBPAY target contract in documentation; only local fake/WEBPAY sandbox are allowed in dev/test, and production remains `NO-GO`.
- Email uses mock/log email until provider is selected.
- CE/CT scale uses dev-only scale.
- Tests use demo content until real content is provided and expert-checked.
