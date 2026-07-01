# Module: Attempts And Snapshot

## Цель

Ученик проходит тест, а система безопасно списывает попытку и сохраняет snapshot.

## Scope

- Attempt start.
- Access check.
- FIFO access.
- Transaction при старте.
- Snapshot.
- Question view.
- Answer saving.
- Restore started attempt.
- Timer.
- Complete.
- Expire.

## Правила

- Попытка списывается при старте.
- При старте создается Attempt и snapshot.
- Обновление страницы не списывает вторую попытку.
- Таймер считается от `started_at`.
- Ответы можно менять до завершения.
- После завершения ответы менять нельзя.

## Supporting docs

- Payment & Access Logic v1.
- Database Schema + API v1.
