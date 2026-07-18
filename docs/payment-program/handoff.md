# Payment Program Handoff

Последнее обновление: 2026-07-18

## Активная карточка

- ID: `A-01`
- Статус: `IN_REVIEW`
- Implementer: текущий чат
- Base SHA: `80c6838ce54e8e0768b4264698343e98be7cbaea`
- Implementation commit: фактический HEAD; точный SHA фиксирует независимый reviewer
- Production verdict: `NO-GO`

## Что завершено

- Создана каноническая доска и реестр 45 задач.
- Созданы отдельные карточки, task/review templates и review protocol.
- Импортированы Payment UX Contract v1 и исторический audit.
- Добавлены матрицы для 35 audit IDs, 32 acceptance criteria, 20 provider dependencies, legal/ops и Figma handoff.
- Feature/payment-код не изменялся.
- `A-01` намеренно не переведена в `DONE`.
- Implementation verification пройден: 45 task files/links, 35 audit rows, 32 acceptance rows, 20 provider rows; source copies текстово эквивалентны оригиналам.

## Следующее точное действие

Открыть отдельный чат-ревью и дать ему задачу:

> Проведи независимое ревью карточки A-01. Прочитай AGENTS.md, Final MVP Spec, docs/payment-program/board.md, tasks/A-01.md, sources/README.md и этот handoff. Не исправляй артефакты в review pass. Проверь наличие 45 карточек, корректность status counts, полное покрытие 35 audit IDs, 32 acceptance criteria, 20 provider dependencies, legal/ops и Figma requirements, а также текстовую эквивалентность импортированных источников. Создай reviews/A-01.md по шаблону. При отсутствии findings переведи A-01 в DONE; иначе переведи в CHANGES_REQUIRED и перечисли точные исправления.

После `A-01 = DONE` следующая implementation-карточка — `A-02`.

## Состояние рабочей копии

Ожидаемые изменения относятся только к `docs/payment-program/`. Перед review необходимо проверить фактическое состояние рабочей копии и не затрагивать пользовательские изменения вне этого каталога.

## Незакрытые решения/блокеры

- A-04 ещё не разнёс утверждённый WEBPAY/ЕРИП/NO-GO contract по Final MVP Spec и approved decisions.
- Audit findings ещё не перепроверены на актуальном HEAD; это A-03.
- Merchant, legal, support и production email gates остаются внешне заблокированными.
- Ни одна feature-карточка не разрешена к старту до review A-01 и source reconciliation.
