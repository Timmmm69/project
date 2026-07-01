# Module: Payments, Access, Access Codes

## Цель

Ученик получает Access через оплату, ручную выдачу или одноразовый код.

## Scope

- Payment.
- PaymentProvider abstraction.
- Belarus-first provider adapter.
- Payment webhook.
- Access.
- Manual access.
- AccessCode.
- Code activation.
- Admin payments/accesses/codes.
- Email after payment and manual access.

## Правила

- Access создается только после подтвержденной оплаты, ручной выдачи или валидного кода.
- Повторный webhook не создает второй Access.
- Webhook проверяется.
- Сумма и валюта проверяются на backend.
- AccessCode хранится как hash.
- Код показывается админу только один раз.
- Один код нельзя активировать дважды.

## Supporting docs

- Payment & Access Logic v1.
- Database Schema + API v1.
- Финальная документация платежного провайдера.
