# Module: Import XLSX/CSV

## Цель

Преподаватель может импортировать вопросы через XLSX или CSV.

## Scope

- XLSX template.
- CSV template.
- Upload.
- Parse.
- Validate.
- Errors/warnings.
- Preview.
- Append.
- Replace.
- Commit.

## Правила

- Частичный импорт запрещен.
- Если есть критические ошибки, файл не импортируется.
- Если есть только warnings, импорт разрешен.
- После импорта вопросы можно редактировать вручную.
- После импорта пересчитываются `questions_count` и `max_raw_score`.
- Старые результаты не меняются из-за snapshot.

## Supporting docs

- Excel/CSV Import Spec v1.
- Database Schema + API v1.
