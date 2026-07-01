# Module: Scoring And Results

## Цель

Backend считает результат и показывает ученику итог, ошибки, правильные ответы, темы, рекомендации и шкалу ЦЭ/ЦТ 0-100.

## Scope

- `single_choice` scoring.
- `multiple_choice` scoring.
- `short_text` scoring.
- Raw score.
- Percent.
- Level.
- Scaled score 0-100.
- Topic results.
- Mistakes.
- Recommendations без AI.
- Student result page.
- Admin attempt details.

## Правила

- Scoring только на backend.
- Частичные баллы запрещены.
- Пустой ответ = 0.
- Правильные ответы показываются только после завершения.
- Нельзя писать "официальный балл ЦТ".
- Правильная формулировка: "Тренировочный расчет по таблице соответствия первичных и тестовых баллов."

## Supporting docs

- Scoring Engine v2.
- Database Schema + API v1.
- Таблица шкалы ЦЭ/ЦТ.
