# WEBPAY site compliance evidence, 2026-08-13

Production verdict: `NO-GO`.

Source: `C:\Users\novik\Downloads\требования к сайту (87).pdf`, SHA-256 `6AF4699F0681EAFE1B7B2AA7C17DDC4560DE9A0422A4E0296727A616810292C7`.

Этот документ фиксирует фактическое покрытие требований PDF. Он не заменяет merchant agreement, юридическое заключение или проверку WEBPAY.

| Требование PDF | Реализация/evidence | Статус |
|---|---|---|
| Данные продавца и контакты | `/seller`, site-wide footer; ФИО, НПД, УНП, телефон, email | `PARTIAL`: отсутствует публичный почтовый адрес |
| Технические требования к сайту | HTTPS/no-store/security headers предусмотрены; ссылки собираются и тестируются | `BLOCKED_EXTERNAL`: нет домена, ownership, hosting и регистрации |
| Способ оплаты и безопасность | `/payment`; WEBPAY hosted checkout, same-tab redirect, карты; card inputs/embedded form/ЕРИП отсутствуют | `IMPLEMENTED`, merchant verification pending |
| Правила оплаты | `/payment`, `/offer`; цена BYN и authoritative provider confirmation | `IMPLEMENTED`, legal review pending |
| Возврат | `/refunds`; только ручная обработка, без automatic refund | `IMPLEMENTED`, real-cabinet tabletop pending |
| Получение услуги | `/service-delivery`; цифровой доступ после authoritative paid status | `IMPLEMENTED`, production email pending |
| Описание, заказ, контроль, подтверждения | Product page + `/offer` + `/service-delivery` + `/support`; public order reference | `IMPLEMENTED`, end-to-end merchant test pending |
| Платёжные логотипы | Официальный пакет WEBPAY/МТБанка размещён локально, без логотипа ЕРИП | `IMPLEMENTED` |

## Подтверждённые исходные данные

- Продавец: Колюгова Софья Игоревна.
- Статус: физическое лицо, применяющее налог на профессиональный доход.
- УНП: `EE8047957`.
- Телефон: `+375 29 376-89-88`.
- Email и support channel: `kolyugova42@icloud.com`.
- Поддержка: Пн-Пт 10:00-18:00 по Минску, ответ в течение двух рабочих дней.
- Домен: отсутствует.

## Обязательные внешние действия

1. Получить и опубликовать полный почтовый адрес продавца.
2. Выбрать домен; подтвердить ownership, HTTPS, применимый белорусский hosting/registration evidence.
3. Передать сайт WEBPAY/МТБанку на проверку и получить merchant agreement, идентификаторы, protocol и sandbox.
4. Проверить ручной refund в реальном кабинете.
5. Настроить операционный процесс формирования и передачи покупателю чека приложения НПД после каждого расчёта.
6. Провести independent legal/site review и повторный QA-02. Mock или предположение не закрывает ни один из этих пунктов.

## Tax receipt boundary

Электронное подтверждение WEBPAY подтверждает платёж, но не отменяет обязанность плательщика НПД сформировать и передать покупателю чек приложения НПД. Отдельное кассовое оборудование для этого не требуется. Автоматический refund в MVP запрещён.
