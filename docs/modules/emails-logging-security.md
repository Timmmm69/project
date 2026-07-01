# Module: Emails, Logging, Security

## Цель

Система отправляет обязательные email, ведет event logs и соблюдает базовые правила безопасности MVP.

## Scope

- Email after successful payment.
- Email after manual access.
- EmailLog.
- EventLog.
- Admin auth.
- Password hash.
- AccessCode hash.
- Webhook verification.
- Backend-only access checks.

## Правила

- Ошибка отправки email не ломает создание Access.
- Ошибка email пишется в `email_logs`.
- Admin password хранится как hash.
- AccessCode хранится как hash.
- Ученик не может видеть чужой результат.
- Admin может видеть все результаты.

## Supporting docs

- Payment & Access Logic v1.
- Database Schema + API v1.
- Финальные тексты email.
