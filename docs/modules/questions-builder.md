# Module: Questions Builder

## Цель

Преподаватель может вручную управлять вопросами внутри теста.

## Scope

- Question list.
- Create/edit/delete.
- Order update.
- `single_choice`.
- `multiple_choice`.
- `short_text`.
- Validation.
- Recalculate `questions_count` and `max_raw_score`.

## Правила

- `topic` обязателен.
- `points` обязателен.
- Для `single_choice` и `multiple_choice` нужны минимум два варианта.
- Для `short_text` варианты ответа не нужны.
- Частичные баллы запрещены.

## Supporting docs

- Admin Test Builder v1.
- Database Schema + API v1.
