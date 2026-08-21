# Текущее состояние проекта

Дата среза: 2026-08-21
Ветка release-кандидата: `codex/release-integration`
Baseline `main`: `f3f818b7d186b188a696880f97bedb06e7ff2571`
UX-линия: `c074582c010a0f3ac253cf7e171e3e7d9b0185a0`
Проверенный implementation/config SHA до документирующего коммита: `1132de3bb244ae0fe5d29adae43b845a00b73b02`.

## Статус

Собран единый release-кандидат MVP для staging. В нём сохранён актуальный payment/security-контур `main`, интегрированы catalog, pre-start, recovery, authentic-result, analytics, CI/readiness изменения UX-линии и подтверждённый визуальный слой с public assets.

Release-кандидат не является разрешением production-запуска:

- production verdict остаётся **NO-GO**;
- `COMMERCIAL_CHECKOUT_ENABLED` по умолчанию равен `false`;
- `PAYMENTS_MODE` по умолчанию равен `disabled`;
- production WEBPAY credentials отсутствуют в репозитории;
- browser return/redirect не считается подтверждением оплаты;
- внешние payment/legal/operational gates не объявлены закрытыми.

## Что входит

- Канонический публичный каталог, обновлённый визуальный язык, иконка и учебная иллюстрация.
- Канонический WEBPAY checkout без возврата legacy ExpressPay/ЕРИП UI.
- Подтверждённый сервером commercial-order claim и verified student session.
- Отдельный pre-start: claim не создаёт Attempt; Attempt создаётся только явным POST `/api/attempts/start`.
- Idempotent refresh/start: активная попытка восстанавливается без списания второй попытки.
- Recovery по email с отдельной ограниченной сессией и безопасным continuation exchange.
- Authentic result с первичными агрегатами; правильные ответы и scoring details не выдаются ученику.
- Backend analytics с каноническими контрактами и privacy-проверками.
- CI с frozen lockfile, Prisma generate/validate/migrate на disposable PostgreSQL, lint, typecheck, unit tests, integration slices и build.

## Данные и миграции

Существующие миграции не изменялись. Общие 14 миграций обеих линий совпали побайтно. Сохранены дополнительные миграции `main`:

- `20260801223000_add_immutable_commercial_order_snapshot`;
- `20260809082143_add_commercial_rate_limits`;
- `20260809123000_sanitize_payment_payloads`.

Несовместимости схемы, требующей новой forward-only migration, не обнаружено.

## Проверки

До документирующего коммита прошли Prisma generate/validate, lint, typecheck, unit suite и production build. Полный протокол и clean-checkout verification приведены в `docs/29-release-candidate-integration-report.md` и в CI соответствующего final release SHA.

## Оставшиеся ограничения

- Production payment activation запрещена до отдельного решения владельца и закрытия внешних gates.
- DB integration/e2e должны выполняться только на disposable database; unit-run без opt-in корректно пропускает эти наборы.
- Нужны независимый PR review и успешный CI на final release SHA.
- Payment board и launch-control сохраняют открытые production gates и не должны трактоваться как GO.
