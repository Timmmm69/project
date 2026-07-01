# Module: Public Student Flow

## Цель

Ученик может открыть каталог, выбрать тест, ввести email, получить доступ и начать прохождение при наличии Access.

## Scope

- Public catalog.
- Test page.
- Email identify.
- Access check.
- Pre-start screen.
- Access service states.

## Правила

- Каталог показывает только `published` тесты.
- `draft`, `hidden`, `archived` публично не показываются.
- Email нормализуется через trim и lowercase.
- Frontend не решает, есть ли доступ; проверка только на backend.

## Supporting docs

- Database Schema + API v1.
- Payment & Access Logic v1.
