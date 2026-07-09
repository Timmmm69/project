# Risks And Open Decisions

## Уже зафиксировано

- Стек MVP: Next.js monolith, TypeScript, PostgreSQL, Prisma.
- Страна/валюта: Беларусь-first, default currency `BYN`.
- Шкала ЦЭ/ЦТ 0-100 входит в MVP.
- Главная страница необязательна. По умолчанию первый экран - каталог тестов.
- Supporting docs используются только как детализация. Final MVP Spec v2 остается главным источником истины.

## Открытые решения

- Точный платежный провайдер: bePaid, WebPay, ЕРИП/E-POS или другой.
- Sandbox и production credentials платежного провайдера.
- Таблица соответствия баллов ЦЭ/ЦТ 0-100.
- Практический способ загрузить таблицу шкалы ЦЭ/ЦТ в MVP: простой админский импорт CSV/XLSX, seed-файл или ручное заполнение в базе перед запуском.
- Механизм защиты ученических endpoints без пароля: signed token, magic link или короткая cookie-сессия после email-identify.
- Финальные тексты email.
- Название проекта.
- Цвета, логотип, базовый визуальный стиль.
- Кто наполняет первые 1-3 теста.
- Кто проверяет корректность тестов перед публикацией.
- Юридические тексты и политика обработки данных для реального запуска оплат.

## Риски

- Платежный провайдер может потребовать юридические документы, проверку сайта или специальные поля в checkout.
- Шкала ЦЭ/ЦТ в MVP увеличивает объем Sprint 7.
- Email-доставляемость зависит от выбранного SMTP-сервиса и домена.
- Импорт XLSX/CSV может потребовать уточнения шаблона на реальных тестовых данных.
- Без тестового контента невозможно полноценно проверить весь пользовательский путь.
- Если `resend-link`, revoke и CSV exports понадобятся в первом релизе, scope MVP увеличится.
- Без выбранного механизма student ownership есть риск, что результат или attempt будет защищен слабее, чем нужно.
- Если платежный провайдер требует обязательные юридические страницы до подключения, запуск оплат может сдвинуться.
- CE/CT scaled score требует реальную таблицу соответствия; пример из docs нельзя использовать как финальную шкалу.
- Import `replace` должен быть реализован через snapshot-safe подход, иначе старые результаты могут сломаться.
- `AccessCode` нельзя логировать или сохранять открытым текстом после создания. Иначе одноразовые коды станут небезопасными.

## Рекомендации

- До Sprint 5 выбрать платежного провайдера и получить документацию.
- До Sprint 7 подготовить таблицу шкалы ЦЭ/ЦТ.
- До Sprint 8 подготовить 1-3 реальных теста и чеклист проверки.
- До Sprint 4 утвердить способ защиты публичных student/attempt/result endpoints без личного кабинета ученика.
- До Sprint 3 проверить XLSX/CSV шаблон на одном реальном тесте.

## RIKZ Russian 2026 Authentic Mode

The approved pre-migration mapping for `examMode = rikz_russian_2026` is recorded in
`docs/24-rikz-russian-2026-schema-mapping.md`.

Key decisions:

- Keep generic MVP behavior and legacy question types.
- Add authentic Russian CE/CT mode as a separate layer.
- Reuse `points`, `scoringSchemeId`, and `source`.
- Do not add duplicate `maxPoints`, `scoringScaleId`, `sourceRef`, or `canonicalTaskType` fields in P0.
- Use lookup-only scaled score through `ScoringScheme` and `ScoringScale`.

Open before migration:

- Approve the exact Prisma migration shape from `docs/24-rikz-russian-2026-schema-mapping.md`.
