# Development Sprints

## Sprint 0 - структура и документация

- Создать структуру проекта.
- Создать `/docs`.
- Создать `AGENTS.md`.
- Зафиксировать стек, scope, риски и карту модулей.

## Sprint 1 - база проекта и админка тестов

- Next.js project.
- PostgreSQL + Prisma.
- Admin auth.
- Test model.
- Test CRUD.
- Статусы `draft`, `published`, `hidden`, `archived`.

## Sprint 2 - ручной конструктор вопросов

- Question model.
- Список вопросов.
- Создание, редактирование, удаление.
- Порядок вопросов.
- `single_choice`, `multiple_choice`, `short_text`.
- Валидация.
- Пересчет `questions_count` и `max_raw_score`.

## Sprint 3 - импорт Excel/CSV

- XLSX template.
- CSV template.
- Upload файла.
- Parse XLSX.
- Parse CSV.
- Validation.
- Errors/warnings.
- Preview.
- Append/replace.
- Commit без частичного импорта.

## Sprint 4 - публичная часть

- Public catalog.
- Test page.
- Email flow.
- Student identify.
- Access check.
- Служебные состояния доступа.

## Sprint 5 - оплата, доступы и коды

- Payment model.
- PaymentProvider abstraction.
- Belarus-first provider adapter.
- Webhook.
- Access.
- Manual access.
- AccessCode.
- Code activation.
- Admin payments/accesses/codes.
- Emails after payment and manual access.

## Sprint 6 - прохождение теста

- Attempt start.
- Access check.
- FIFO access.
- Списание попытки при старте.
- Snapshot.
- Questions view.
- Answer saving.
- Restore started attempt.
- Timer.
- Complete.
- Expire.

## Sprint 7 - scoring, шкала ЦЭ/ЦТ и результат

- Check `single_choice`.
- Check `multiple_choice`.
- Check `short_text`.
- Raw score.
- Percent.
- Level.
- ScoringScheme и ScoringScale.
- Scaled score 0-100.
- Topic results.
- Mistakes.
- Recommendations без AI.
- Result page.
- Admin attempt details.

## Sprint 8 - QA и запуск

- Проверить все flows.
- Проверить import edge cases.
- Проверить payment/webhook idempotency.
- Проверить manual access.
- Проверить codes.
- Проверить timer.
- Проверить scoring.
- Проверить security.
- Проверить mobile.
- Проверить emails.
