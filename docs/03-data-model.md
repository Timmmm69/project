# Data Model

## Основные сущности

- `User`: ученик или админ. Ученик идентифицируется email без пароля.
- `Test`: опубликованный или черновой тест.
- `Question`: вопрос внутри теста.
- `Payment`: платеж за конкретный тест.
- `Access`: право пройти конкретный тест.
- `AccessCode`: одноразовый код доступа, в базе хранится hash.
- `Attempt`: попытка прохождения теста.
- `Answer`: ответ ученика в рамках попытки.
- `ImportJob`: результат validate/preview/commit импорта.
- `ManualAccessLog`: журнал ручной выдачи доступа.
- `EventLog`: журнал ключевых событий.
- `EmailLog`: журнал email-отправок и ошибок.
- `ScoringScheme`: шкала ЦЭ/ЦТ.
- `ScoringScale`: соответствие первичных и тестовых баллов.

## Ключевые правила данных

- `Test.subject` в MVP равен `russian`.
- `Test.mode`: `training` или `ce_ct`.
- `Test.status`: `draft`, `published`, `hidden`, `archived`.
- `Question.topic` обязателен.
- `Question.points` обязателен.
- `Payment.status`: `pending`, `success`, `failed`, `cancelled`, `refunded`.
- `Access.source`: `payment`, `manual`, `access_code`.
- `Attempt.status`: `started`, `completed`, `expired`, `cancelled`.
- `AccessCode.status`: `active`, `used`, `expired`, `revoked`.

## Snapshot

`Attempt.test_snapshot_json` обязателен. Он сохраняет версию теста и вопросов на момент старта. Благодаря этому старые результаты не меняются после редактирования теста.

## Шкала ЦЭ/ЦТ

Так как шкала 0-100 включена в MVP:

- `ScoringScheme` и `ScoringScale` входят в первую схему;
- если `test.mode = ce_ct` и `show_scaled_score = true`, тест должен иметь выбранную шкалу;
- если `max_raw_score` теста не совпадает с `max_raw_score` шкалы, публикация запрещена.
