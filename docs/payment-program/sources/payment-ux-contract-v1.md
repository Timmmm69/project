# Payment UX Contract v1

**Версия:** 1.0  
**Дата:** 18 июля 2026 года  
**Статус:** `READY FOR PRODUCT OWNER REVIEW`  
**Владелец:** Product Owner / Payments Product Lead  
**Область:** checkout, передача пользователя на WEBPAY, возврат, локальные payment states, recovery и payment-specific trust/accessibility/analytics  
**Launch boundary:** `PAY-01A = READY`; `PAY-01B = BLOCKED`; реальные платежи и production activation = `NO-GO`

---

## 1. Status and authority

### 1.1. Назначение

Этот документ является окончательным продуктовым и UX-контрактом первого платного checkout-сценария для одной покупки оригинального тренировочного онлайн-теста по русскому языку.

Документ фиксирует:

- единственный основной способ оплаты первого запуска;
- информационную архитектуру checkout;
- границу между продуктом и платёжным провайдером;
- точные CTA и пользовательские тексты;
- redirect handoff;
- return, pending, terminal и recovery states;
- mobile, accessibility, trust и analytics boundaries;
- требования для следующей отдельной задачи в Figma.

Документ не является доказательством реализации, legal sign-off, merchant approval или готовности реальных платежей.

### 1.2. Иерархия источников

При противоречии применяется следующий приоритет:

1. Утверждённое продуктовое решение этого документа: банковская карта через интернет-эквайринг WEBPAY, hosted payment page, canonical redirect.
2. `Product Commercial Contract v1` и `stage-7-launch-control-v1.md`.
3. Payment/access state machines и backend truth contracts.
4. Этот документ для payment UX, copy, screen behavior и Figma handoff.
5. `ux-target-flow-spec-v1.md`, `ux-copy-pack-v1.md`, `ux-core-wireframes-v1.md`, `ux-state-wireframes-v1.md` в части, не заменённой этим документом.
6. Публичная документация WEBPAY только как внешний справочный источник. Merchant-specific documentation, договор и фактическая конфигурация имеют приоритет над публичной маркетинговой страницей.

### 1.3. Каноническое решение

Основной способ оплаты первого платного запуска:

> **Банковская карта через интернет-эквайринг WEBPAY с перенаправлением на защищённую платёжную страницу WEBPAY.**

ЕРИП, привязка карты, рекуррентные платежи, Apple Pay, Samsung Pay, карты рассрочки и любые иные способы не являются частью основного checkout первого запуска и не показываются на нашем checkout без отдельного решения и merchant-specific confirmation.

### 1.4. Неизменяемые инварианты

- Карточные данные никогда не вводятся в UI-компонентах нашего сайта.
- Наш frontend и backend не принимают PAN, срок действия, CVV/CVC или данные 3-D Secure.
- Browser return не является подтверждением оплаты.
- Оплата считается подтверждённой только после authoritative server-side verification и фиксации локального `paid`.
- Access выдаётся только после подтверждённой оплаты.
- Повторный callback, status check, reload или двойной клик не создаёт второй Access.
- `pending`, `payment_status_unknown` и `paid_without_access` не предлагают повторную оплату.
- Real payments остаются `NO-GO` до закрытия обязательных launch gates.

### 1.5. Canonical Project Sources

Контракт подготовлен на основе следующего набора Project Sources:

1. `stage-7-launch-control-v1.md`;
2. `webpay-onboarding-dossier-v1.md`;
3. `webpay-sandbox-evidence-plan-v1.md`;
4. `legal-product-decision-register-v1.md`;
5. `legal-public-copy-rules-v1.md`;
6. `legal-cross-document-reconciliation-v1.md`;
7. `analytics-measurement-plan-v1.md`;
8. `ux-copy-pack-v1.md`;
9. `ux-target-flow-spec-v1.md`;
10. `ux-core-wireframes-v1.md`;
11. `ux-state-wireframes-v1.md`.

Дополнительно использованы `Product Commercial Contract v1`, `project-context-snapshot-2026-07-15.md` и официальные публичные материалы WEBPAY из раздела 3.4.

---

## 2. Product and commercial baseline

### 2.1. Предмет покупки

Пользователь покупает одну попытку одного оригинального тренировочного онлайн-теста по русскому языку.

| Параметр | Каноническое значение |
| --- | --- |
| Цена | `10 BYN` |
| Тип платежа | Разовый |
| Подписка | Нет |
| Автоматическое продление | Нет |
| Автоматические повторные списания | Нет |
| Количество попыток | Одна |
| Срок начала | 90 календарных дней после подтверждённой оплаты |
| Время после старта | 120 минут без паузы |
| Результат | Только первичный |
| Хранение результата | 12 месяцев |
| Основной идентификатор | Подтверждённый email |
| Повторный доступ | Через подтверждение того же email |
| Официальная связь с РИКЗ | Отсутствует |

### 2.2. Checkout как единый пользовательский процесс

С точки зрения пользователя checkout начинается сразу после CTA на странице продукта. Внутри checkout сохраняются существующие функциональные экраны подтверждения email:

```text
PROD-01
→ checkout entry
→ ACC-01 ввод email
→ ACC-02 подтверждение email
→ CHK-01 проверка покупки и условий
→ создание Order
→ создание PaymentAttempt / payment session
→ redirect WEBPAY
→ PAY-01 return и локальный статус
```

Order не создаётся до подтверждения email и обязательных условий.

### 2.3. Email contract

- Email вводится до создания Order.
- Для платного пути email должен быть подтверждён одноразовым кодом.
- Email используется для Order, Access, recovery, служебных сообщений и открытия Result.
- Email не является паролем.
- Наличие Order, Access или Result не раскрывается до подтверждения владения email.
- Paid child flow не активируется до отдельного legal/privacy sign-off.
- Checkout использует adult-owned email model из канонических legal/product sources.

### 2.4. Коммерческое обещание

Публичная формулировка:

> `10 BYN за одну попытку. Без подписки, автоматического продления и повторных списаний.`

Нельзя использовать:

- «официальный тест»;
- «официальный симулятор»;
- «копия ЦЭ/ЦТ»;
- «точно как на экзамене»;
- гарантии балла или результата;
- обещание шкального результата;
- blanket no-refund wording.

---

## 3. Security boundary

### 3.1. Разделение ответственности

| Поверхность | Владелец | Допустимые данные и действия |
| --- | --- | --- |
| Страница продукта | Наш продукт | Описание, цена, условия, CTA |
| Email и legal confirmation | Наш продукт | Email, OTP flow, зафиксированная версия условий |
| Order и PaymentAttempt | Наш backend | Product snapshot, backend price, currency, локальные identifiers и statuses |
| Платёжная страница | WEBPAY | Номер карты, срок действия, CVV/CVC, cardholder/3-D Secure data в объёме провайдера |
| Return/status page | Наш продукт | Безопасный номер заказа, локальный backend status, разрешённые действия |
| Provider callback/status | Server-to-server | Restricted provider payload, signature/status validation, локальный state transition |
| Analytics | Frontend/backend allowlist | Только разрешённые события и неперсональные identifiers |

### 3.2. Запрещённые компоненты и данные

Наш frontend и backend не должны:

- создавать поля `Номер карты`, `Срок действия`, `CVV`, `CVC`, `3-D Secure code`;
- принимать или проксировать PAN и CVV/CVC;
- сохранять полные или маскированные карточные реквизиты;
- записывать карточные данные в логи, session replay, analytics или support forms;
- просить пользователя прислать реквизиты карты или одноразовый банковский код;
- имитировать банковскую форму;
- показывать фиктивные логотипы банков, схем или security badges;
- использовать provider response body или raw error как пользовательский текст.

Если WEBPAY неожиданно передаёт карточное поле в callback, приложение не сохраняет и не отображает его. Merchant configuration должна по возможности исключать ненужные карточные поля.

### 3.3. Hosted page и embedded page

Канонический вариант v1:

> `same-tab redirect на hosted payment page WEBPAY`.

Provider-controlled embedded page допустима только в новой версии контракта после одновременного подтверждения:

- merchant-specific documentation;
- security и PCI boundary;
- поддерживаемой схемы интеграции;
- mobile behavior;
- browser/accessibility QA;
- legal/provider wording.

До этого embedded checkout не проектируется и не показывается в Figma как основной вариант.

### 3.4. Официальные факты WEBPAY, использованные в контракте

Публичная документация WEBPAY описывает redirect на защищённую payment page, ввод карточных данных на стороне WEBPAY, возврат на merchant URL и отдельное server notification. Отдельная интеграция без redirect описана для PCI DSS compliant merchants. Публичная документация также описывает настройку брендинга payment page через менеджера WEBPAY. Эти публичные материалы подтверждают направление UX, но не заменяют merchant-specific documentation и договор.

Official source inventory, checked 18 July 2026:

- WEBPAY order creation and redirect: https://docs.webpay.by/en/paymentIntegration/cardIntegration/orderCreation/
- WEBPAY order payment: https://docs.webpay.by/en/paymentIntegration/cardIntegration/orderPayment/
- WEBPAY payment verification: https://docs.webpay.by/en/paymentIntegration/cardIntegration/paymentVerification/
- WEBPAY payment notification: https://docs.webpay.by/en/paymentIntegration/cardIntegration/paymentNotification/
- WEBPAY PCI DSS merchant integration: https://docs.webpay.by/en/merchantPCIDSS/
- WEBPAY payment page branding: https://docs.webpay.by/en/generalInfo/userAccount/brandingSettings/
- WEBPAY public card acquiring page: https://webpay.by/cards/

---

## 4. Canonical payment flow

### 4.1. End-to-end sequence

```text
страница продукта
→ checkout entry
→ ввод и подтверждение email
→ проверка состава покупки
→ подтверждение обязательных условий
→ создание Order с backend price 10 BYN
→ создание PaymentAttempt и payment session
→ CTA оплаты картой
→ redirect на hosted WEBPAY page
→ ввод карты и 3-D Secure только у WEBPAY
→ return в продукт
→ backend status resolution
→ pending / paid / failed / cancelled / expired / unknown
→ Access только после server-side paid confirmation
→ переход к PRE-01
→ отдельное подтверждение старта теста
```

### 4.2. Полный сценарий по шагам

| Шаг | Цель пользователя | Что отображается | Основной CTA | Вторичное действие | Успешный переход | Возможные ошибки |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Страница продукта | Понять предложение | Название, оригинальный статус, 40 заданий, 120 минут, 10 BYN, одна попытка, primary-only result, no-affiliation | `Купить одну попытку` | `Уже есть доступ?` | Checkout entry | Продукт недоступен, данные не загрузились |
| 2. Checkout entry | Начать оформление | Короткий summary покупки, назначение email | `Продолжить` после валидного email | `Вернуться к странице теста` | ACC-01 submit | Невалидный email, сеть, checkout context unavailable |
| 3. Подтверждение email | Подтвердить владение адресом | Маскированный email, OTP input, resend state | `Подтвердить email` | `Изменить email` | Verified session и resolver | Неверный/просроченный код, rate limit, delivery failure |
| 4. Проверка заказа | Убедиться, что покупка понятна | Product, 10 BYN, одна попытка, 90 дней, 120 минут, primary-only, 12 месяцев, verified email | Нет до подтверждений | `Изменить email` | Legal confirmation ready | Existing Order, existing Access, product unavailable |
| 5. Подтверждение условий | Осознанно принять условия | Два required unchecked checkboxes, ссылки на offer/refund/privacy, seller block | `Перейти к оплате картой` | `Отменить оформление` | creating_order | Не отмечен checkbox, legal pages unavailable |
| 6. Создание Order | Зафиксировать покупку | `Создаём заказ…`, loader | Нет повторного CTA | `Отменить` только если backend ещё не начал commit | Один Order | DB/validation error, existing Order, existing Access |
| 7. Создание payment session | Подготовить переход | `Открываем защищённую страницу WEBPAY…` | Автоматический переход | Fallback после timeout: `Открыть страницу WEBPAY` | PaymentAttempt/session saved | Provider/config/session error |
| 8. WEBPAY | Оплатить картой | Provider-controlled payment page | Provider CTA | Provider cancel/back controls | WEBPAY processing | Decline, 3DS failure, cancel, session expiry, connection loss |
| 9. Return | Узнать результат оплаты | Номер заказа, 10 BYN, neutral status shell | Автоматическая проверка | `Вернуться к странице теста` только в terminal states | Local state resolved | Missing context, status endpoint unavailable |
| 10. Pending/unknown | Не платить повторно и дождаться истины | Последний backend status, запрет повторной оплаты, progress | Автопроверка, затем `Обновить статус` | Support после threshold | paid / failed / cancelled / expired | Callback delayed, status API unavailable, network loss |
| 11. Paid | Получить доступ | `Оплата подтверждена`, exactly one Access state | `Перейти к началу теста` | `Обратиться в поддержку` при access issue | PRE-01 | `paid_without_access` |
| 12. Начало теста | Осознанно запустить попытку | Одна попытка, 120 минут, таймер без паузы | `Начать попытку` на PRE-01 | `Вернуться` | ATT-01 | Access expired, duplicate start, start error |

### 4.3. Backend truth sequence

```text
checkout_flow_id issued
→ Order committed with backend price/currency
→ PaymentAttempt committed
→ provider session created
→ local pending
→ callback and/or status API verification
→ local paid
→ exactly one Access committed
```

Return URL, query parameters, provider page text, screenshot, support message или client-side flag не меняют payment/access state.

---

## 5. Checkout information architecture

### 5.1. Обязательный порядок блоков

Checkout использует следующий порядок без перестановки ключевых смыслов:

1. **Заголовок**  
   `Оформление покупки`

2. **Короткое название продукта и disclaimer**  
   `Одна попытка тренировочного онлайн-теста по русскому языку`  
   `Независимый тренировочный сервис. Не является официальным ресурсом РИКЗ и не содержит официальных заданий ЦЭ/ЦТ.`

3. **Цена и тип платежа**  
   `Итого: 10 BYN`  
   `Разовый платёж`  
   `Без подписки, автоматического продления и повторных списаний`

4. **Что входит в покупку**
   - одна попытка;
   - начать можно в течение 90 дней после подтверждённой оплаты;
   - после старта 120 минут без паузы;
   - после завершения показывается только первичный результат;
   - результат доступен 12 месяцев.

5. **Email**
   - verified email;
   - назначение email;
   - действие `Изменить email`;
   - при неподтверждённом email checkout не переходит к Order.

6. **Способ оплаты**
   - `Банковская карта`;
   - provider: `WEBPAY`;
   - explanation о redirect;
   - explanation о card data boundary.

7. **Обязательные подтверждения**
   - adult-owned email / age confirmation;
   - acceptance of offer, payment/refund terms and privacy information;
   - checkboxes не предустановлены.

8. **Финальная строка заказа**
   - product name;
   - quantity: one attempt;
   - total: 10 BYN;
   - no hidden fee.

9. **Основной CTA и handoff explanation**
   - `Перейти к оплате картой`;
   - `Вы будете перенаправлены на защищённую страницу WEBPAY.`

10. **Support, seller и legal links**
    - support route;
    - seller block;
    - payment terms;
    - refund rules;
    - privacy policy;
    - public offer.

### 5.2. Информационная иерархия

**Уровень 1, решение о покупке:** название, 10 BYN, одна попытка, разовый платёж.  
**Уровень 2, ограничения:** 90 дней, 120 минут, primary-only, 12 месяцев.  
**Уровень 3, identity и payment:** verified email, банковская карта, WEBPAY redirect.  
**Уровень 4, legal/trust:** seller, offer, refunds, privacy, support, disclaimer.

Price, one-attempt rule и primary CTA должны быть видны без чтения длинных legal blocks.

### 5.3. Required confirmation copy

До legal sign-off используются точные UX drafts с activation status `LEGAL SIGN-OFF REQUIRED`:

1. `Подтверждаю, что мне исполнилось 18 лет и указанный email находится под моим контролем.`
2. `Подтверждаю ознакомление с публичной офертой, условиями оплаты и возврата, а также политикой обработки персональных данных.`

Если legal sign-off изменяет формулировку, меняется только legal copy. Порядок, required status, отсутствие preselection и acceptance evidence сохраняются.

---

## 6. Screen and state contracts

### 6.1. Payment method presentation

#### Канонический блок

Все WEBPAY-branded строки в этом разделе имеют статус `DESIGN READY / PROVIDER ACTIVATION REQUIRED`. Они используются в Figma и staging, но не публикуются до merchant approval, договора и утверждённого provider copy.

```text
Способ оплаты

Банковская карта
Вы будете перенаправлены на защищённую страницу WEBPAY.
Номер карты, срок действия, CVV/CVC и данные 3-D Secure вводятся только на стороне WEBPAY.
Наш сайт не получает реквизиты карты.
```

#### Логотипы и payment schemes

| Элемент | Решение v1 |
| --- | --- |
| Название `WEBPAY` текстом | Показывать после merchant approval и до production activation |
| Логотип WEBPAY | Не обязателен. Показывать только официальный asset, предоставленный или письменно разрешённый WEBPAY |
| Visa | Placeholder до merchant-specific confirmation |
| Mastercard | Placeholder до merchant-specific confirmation |
| Белкарт | Placeholder до merchant-specific confirmation |
| Мир, Apple Pay, Samsung Pay, карты рассрочки | Не показывать в нашем checkout без отдельного подтверждения и решения |
| ЕРИП | Не показывать как основной или равноправный метод первого запуска |
| Другие методы | Не показывать |

Placeholder для Figma и staging:

`[WEBPAY_CONFIRMED_CARD_SCHEMES]`

Literal placeholder не публикуется. При отсутствии подтверждённого списка схем блок логотипов полностью скрывается, а текст `Банковская карта` остаётся.

Публичные страницы WEBPAY перечисляют несколько схем и методов, но фактическая доступность зависит от merchant agreement, банка-эквайера и конфигурации. Marketing page не считается merchant confirmation.

### 6.2. CTA contract

| Назначение | Точный текст | Условие |
| --- | --- | --- |
| CTA страницы продукта | `Купить одну попытку` | Продукт доступен |
| Основной CTA checkout | `Перейти к оплате картой` | Email verified, required confirmations accepted, checkout enabled |
| Fallback redirect | `Открыть страницу WEBPAY` | Session создана, но automatic navigation не произошла |
| Повторная попытка оплаты | `Попробовать оплатить снова` | Только authoritative `failed`, `cancelled` или `expired` |
| Проверка статуса | `Обновить статус` | Automatic check завершена или status request failed |
| Возврат к продукту | `Вернуться к странице теста` | Не создаёт новый Order |
| После paid + Access | `Перейти к началу теста` | Ведёт в PRE-01, не запускает Attempt |
| Финальный старт на PRE-01 | `Начать попытку` | Отдельное подтверждение 120 минут |
| Support | `Обратиться в поддержку` | Approved support route active |
| Existing Order | `Открыть статус оплаты` | Новый Order запрещён |
| Existing Access | `Перейти к доступу` | Повторная покупка запрещена |

Запрещённые CTA:

- `Оплатить сейчас` на нашем checkout, если это создаёт впечатление ввода карты на нашем сайте;
- `Оплачено` до backend confirmation;
- `Попробовать ещё раз` в `pending`, `unknown` или `paid_without_access`;
- абстрактные `ОК`, `Продолжить` для финансового действия.

### 6.3. Redirect handoff

#### Последовательность

1. Пользователь нажимает `Перейти к оплате картой`.
2. CTA немедленно становится недоступным для повторного submit.
3. Показывается `Создаём заказ…`.
4. Backend по `checkout_flow_id` создаёт не более одного Order.
5. Показывается `Открываем защищённую страницу WEBPAY…`.
6. Backend создаёт или восстанавливает один PaymentAttempt/session.
7. Выполняется same-tab redirect.
8. Если automatic navigation не произошла за 10 секунд после подтверждённого создания session, показывается fallback `Открыть страницу WEBPAY`.

10 секунд являются UX threshold для показа fallback, а не timeout WEBPAY.

#### Loader

- Loader обязателен.
- Loader сопровождается текстовым status.
- Spinner не получает keyboard focus.
- Для reduced motion spinner может быть статичным.
- Нельзя показывать progress percentage, если реальный прогресс неизвестен.

#### Повторный клик

- До результата Order/session request повторный submit запрещён.
- После 10 секунд разрешён только fallback navigation к уже созданной session.
- Fallback не создаёт новый Order или PaymentAttempt.
- Safe retry после creation error сначала вызывает backend resolver.

#### Защита от двойного Order

- Checkout получает server-generated `checkout_flow_id`.
- Один `checkout_flow_id` создаёт не более одного Order.
- Double click, reload, browser retry и повторная отправка формы используют тот же context.
- Если Order уже существует, пользователь переходит в `Открыть статус оплаты`.
- Новая payment attempt создаётся внутри существующего Order только для terminal retry.
- Новый Order допустим только после server-declared закрытия/инвалидации исходного Order и явного перезапуска checkout пользователем.

#### Ошибка создания session

Показывается:

- заголовок `Не удалось открыть страницу оплаты`;
- текст `Заказ сохранён. Перед повторной попыткой мы проверим его состояние, чтобы не создать дубликат.`;
- CTA `Попробовать снова`;
- secondary `Вернуться к странице теста`;
- support после повторной ошибки.

#### Popup blocked

Canonical flow использует same-tab redirect и не зависит от popup. Если реализация пытается открыть новую вкладку и браузер её блокирует:

- состояние считается failed handoff;
- показывается fallback `Открыть страницу WEBPAY`;
- Order и PaymentAttempt не создаются повторно;
- такая реализация не проходит acceptance как canonical redirect без отдельного решения.

#### Reload

При reload checkout/redirect page:

- frontend не повторяет create command автоматически;
- backend resolver возвращает existing Order, PaymentAttempt и local status;
- пользователь попадает в текущий state;
- price и currency повторно загружаются из backend snapshot;
- raw provider session data в URL не хранится.

### 6.4. Return states

UX state names ниже являются отображением существующих backend/payment states и не меняют payment state machine.

| UX state | Заголовок | Объяснение | Основной CTA | Вторичный CTA | Повтор оплаты | Status refresh | Support | Что нельзя утверждать |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `payment_pending` | `Проверяем статус оплаты` | `Статус оплаты пока не подтверждён. Возврат на эту страницу сам по себе не подтверждает оплату.` | Automatic check, затем `Обновить статус` | `Вернуться к странице теста` после manual state | Нет | Да | После threshold | Что деньги списаны или не списаны |
| `payment_paid` | `Оплата подтверждена` | `Доступ к одной попытке готов.` | `Перейти к началу теста` | `Обратиться в поддержку` | Нет | Нет | При проблеме с переходом | Что Attempt уже начат |
| `payment_failed` | `Оплата не прошла` | `Провайдер подтвердил, что эта попытка оплаты завершилась неуспешно. Доступ не создан.` | `Попробовать оплатить снова` | `Вернуться к странице теста` | Да, new PaymentAttempt same Order | Нет | После повторной ошибки или по запросу | Причину банка, если она не подтверждена и не allowlisted |
| `payment_cancelled` | `Оплата отменена` | `Оплата не была подтверждена. Доступ не создан.` | `Попробовать оплатить снова` | `Вернуться к странице теста` | Да, new PaymentAttempt same Order | Нет | Если пользователь не отменял | Что деньги не могли быть списаны без authoritative status |
| `payment_expired` | `Время оплаты истекло` | `Платёжная сессия больше недоступна. Доступ не создан.` | `Попробовать оплатить снова` | `Вернуться к странице теста` | Да, new PaymentAttempt same Order | Один final refresh перед retry | При повторении | Фактический WEBPAY timeout как универсальное правило |
| `payment_status_unknown` | `Статус оплаты пока неизвестен` | `Не удалось получить подтверждённый статус. Не оплачивайте повторно, пока проверка не завершена.` | `Обновить статус` | `Обратиться в поддержку` после threshold | Нет | Да | После двух failed manual refresh или 5 минут | Paid, failed, cancelled или expired |
| `paid_without_access` | `Оплата подтверждена, доступ оформляется` | `Повторно оплачивать не нужно. Мы проверяем выдачу доступа.` | Automatic reconciliation, затем `Обновить статус` | `Обратиться в поддержку` после 60 секунд | Нет | Да | После 60 секунд или explicit grant failure | Что доступ уже выдан или что требуется новая оплата |
| `repeat_entry_after_payment` | Resolver-dependent | `Мы проверили текущее состояние заказа и доступа.` | PRE-01 / ATT-01 / RES-01 / current payment state | `Обратиться в поддержку` для inconsistent state | Только terminal retry state | По текущему state | По текущему state | Новый Order без resolver |

### 6.5. Pending contract

#### Источник истины

- Return page всегда запрашивает локальный backend status.
- Success не выводится из URL, return button, provider text или client state.
- Frontend polling обращается только к нашему backend.
- Backend сам решает, использовать локальный state, callback result, cached status или merchant-approved status API.

#### Максимальная автоматическая UX-проверка

Одна foreground-сессия автоматической проверки длится максимум **60 секунд**.

Рекомендуемое расписание frontend status requests:

```text
сразу после render
→ 3 сек
→ 7 сек
→ 12 сек
→ 20 сек
→ 30 сек
→ 45 сек
→ 60 сек
```

Это UX window, а не утверждение о WEBPAY session timeout, callback SLA или provider retry policy.

Правила:

- backend может coalesce/cache requests и обязан учитывать merchant rate limits;
- при hidden tab регулярный polling приостанавливается;
- при возврате tab в foreground выполняется один immediate refresh;
- wall-clock window не продлевается бесконечно;
- каждое polling update не перемещает focus и не объявляется screen reader;
- terminal state завершает polling немедленно.

#### После 60 секунд

- Automatic polling прекращается.
- Показывается `Автоматическая проверка завершена. Статус можно обновить вручную.`
- Активируется `Обновить статус`.
- Manual refresh имеет frontend cooldown 10 секунд.
- Manual refresh не создаёт Order, PaymentAttempt или Access.
- `pending` и `unknown` продолжают запрещать повторную оплату.

#### Support thresholds

- `paid_without_access`: support показывается после 60 секунд automatic reconciliation или сразу после explicit unrecoverable grant failure.
- `payment_status_unknown`: support показывается после двух failed manual refresh либо через 5 минут после первого return, что наступит раньше.
- `payment_pending`: support показывается через 5 минут после первого return либо после трёх failed manual refresh.
- Terminal failure/cancel/expiry: support доступен как secondary action, если пользователь не узнаёт действие или retry снова не открывается.

Эти thresholds являются UX escalation policy и не описывают provider SLA.

#### Безопасный fallback

Если статус нельзя подтвердить:

- сохраняется последний подтверждённый local status;
- повторная оплата не предлагается;
- пользователь может закрыть страницу и вернуться через verified email;
- support получает безопасный order reference;
- Access не выдаётся вручную из UI;
- новый Order не создаётся.

### 6.6. Error contract

| Сценарий | Пользовательский UX | Разрешённое действие | Запрещено |
| --- | --- | --- | --- |
| Невозможно создать Order | `Не удалось создать заказ. Оплата не начиналась.` | Safe retry с тем же checkout_flow_id; назад | Создать несколько Order |
| Невозможно создать payment session | `Заказ сохранён, но страницу оплаты открыть не удалось.` | Retry session/resolver; support после повторной ошибки | Новый Order |
| Redirect не произошёл | Handoff state + `Открыть страницу WEBPAY` | Открыть existing session | Повторная session creation из браузера |
| Пользователь закрыл payment page | При повторном входе resolver, обычно pending/unknown | Проверить статус | Автоматически считать cancelled |
| Provider вернул failure | `Оплата не прошла` | New PaymentAttempt same Order | Start test |
| Callback задерживается | `Проверяем статус оплаты` | Auto/manual refresh | Pay again |
| Status API временно недоступен | `Статус оплаты пока неизвестен` | Manual refresh/support | Делать terminal conclusion |
| Email связан с pending Order | `Заказ уже создан` | `Открыть статус оплаты` | Новый Order |
| Повторная оплата | Только failed/cancelled/expired | New PaymentAttempt same Order | Retry pending/paid/PWA |
| Payment confirmed, Access отсутствует | `Оплата подтверждена, доступ оформляется` | Reconciliation/refresh/support | Повторная оплата |
| Потеря соединения на checkout | Сохраняется введённый email locally only до submit; финансовый state берётся с backend | Retry connection | Считать Order созданным без backend response |
| Потеря соединения после submit | Resolver после восстановления | Open current status | Повторный create без resolver |
| Reload | Restore current state | Continue current flow | Resubmit financial command automatically |
| Mobile app/browser switch | On foreground immediate local refresh | Continue | Считать отменой |
| Browser Back с WEBPAY | Existing Order/status page | Open current status | Возвращать пустой checkout с новым Order |
| Browser Back из pending | Product page may open, but pending banner/state resolver remains available | Open status | Скрыть pending Order и предложить новую покупку |

### 6.7. Safe error content

Пользователю не показываются:

- provider payload;
- callback body;
- signature или validation details;
- merchant ID/store ID;
- transaction ID полностью;
- RRN;
- credentials;
- stack trace;
- database IDs;
- internal state machine names;
- raw provider error;
- request/response body.

Допустимый support identifier:

`Номер заказа: {orderReference}`

Он должен быть публичным opaque reference, не provider transaction ID.

---

## 7. Mobile behavior

### 7.1. Checkout layout

- Одна колонка на 320-767 px.
- Горизонтальный scroll запрещён.
- Product summary, 10 BYN и one-attempt rule находятся до email/legal details.
- Email input использует `type=email`, `autocomplete=email`, корректную mobile keyboard и видимый label.
- Primary CTA один и занимает полную доступную ширину.
- После прохождения required confirmations нижняя action bar может быть sticky и содержит только `10 BYN` и `Перейти к оплате картой`.
- Sticky action bar учитывает safe-area и не перекрывает legal text, support или ошибки.
- При открытой клавиатуре sticky bar reflows или скрывается, чтобы не перекрывать email/OTP field.

### 7.2. External payment page

- Переход выполняется в той же вкладке.
- До перехода пользователь видит, что открывается внешняя защищённая страница WEBPAY.
- После возврата из браузера или банковского приложения frontend не предполагает outcome и сразу запрашивает backend status.
- Возврат в приложение после 3-D Secure не считается payment confirmation без backend truth.

### 7.3. Context preservation

- Order context хранится в backend и восстанавливается через first-party verified session и безопасный public order reference.
- Reload и browser process eviction не требуют повторного ввода карточных данных на нашей стороне.
- После повторного подтверждения email resolver находит pending Order, Access, active Attempt или Result.
- Нельзя хранить raw provider payload/session token в localStorage или analytics.

### 7.4. Маленькая высота viewport

- Header сокращается до back action и page title.
- Status content прокручивается вертикально.
- CTA не фиксируется поверх system keyboard.
- Loader, heading, explanation и primary CTA остаются доступны при 320 x 568 px.
- Support link не скрывается за sticky footer.
- Modal по возможности заменяется отдельной page/state surface.

### 7.5. Mobile acceptance checks

Обязательные viewports:

- 320 x 568;
- 360 x 640;
- 390 x 844;
- 412 x 915;
- landscape 667 x 375;
- browser zoom 200% на desktop с узкой effective width.

---

## 8. Accessibility

### 8.1. Keyboard and focus

- Полный checkout доступен без мыши.
- Focus order совпадает с DOM и визуальным порядком.
- Visible focus обязателен для inputs, links, checkboxes и buttons.
- Disabled submit не остаётся единственным способом узнать причину недоступности.
- После submit focus остаётся на trigger, если он enabled, либо один раз переводится на state heading.
- Spinner не получает focus.
- Polling не перемещает focus.
- После terminal state focus один раз переводится на новый heading.

### 8.2. Forms and errors

- Каждый input имеет видимый label.
- Error связан с field через `aria-describedby` и invalid state.
- При submit с несколькими ошибками показывается error summary в начале формы.
- Error summary содержит ссылки на проблемные поля.
- Required status не передаётся только звёздочкой.
- Checkbox label полностью кликабелен, target не менее 44 x 44 px.
- Checkbox не preselected.

### 8.3. Status and loaders

- Loading phase использует `role=status` или polite live region.
- Объявляется начало meaningful phase: `Создаём заказ`, `Открываем страницу оплаты`, `Проверяем статус`.
- Каждая polling iteration не объявляется.
- Terminal success/error объявляется один раз.
- `paid_without_access` и `payment_status_unknown` имеют отдельные headings и явный текст, а не только цвет/icon.
- Countdown/cooldown доступен как текст, но не объявляется каждую секунду.

### 8.4. Visual requirements

- Текстовый contrast не ниже WCAG AA.
- Focus contrast не ниже 3:1 к соседним цветам.
- Error/success/pending не различаются только цветом.
- Icon всегда сопровождается текстом.
- Primary CTA не зависит от hover.
- Touch target не менее 44 x 44 px.
- Текст масштабируется до 200% без горизонтального scroll страницы.

### 8.5. Reduced motion

При `prefers-reduced-motion: reduce`:

- нет обязательных вращающихся loader animations;
- redirect transition не содержит декоративной анимации;
- status changes мгновенные или с минимальным fade;
- смысл процесса сохраняется текстом.

---

## 9. Trust and public wording

### 9.1. Обязательные trust signals

Checkout должен явно показывать:

- `Итого: 10 BYN`;
- `Одна покупка - одна попытка`;
- `Разовый платёж`;
- `Без подписки и автоматического продления`;
- `Без автоматических повторных списаний`;
- `Вы будете перенаправлены на защищённую страницу WEBPAY`;
- `Наш сайт не получает реквизиты карты`;
- approved seller information;
- approved support route;
- ссылки на offer, payment terms, refunds и privacy;
- независимый статус сервиса.

### 9.2. Seller placeholder

До factual verification в Figma/staging используется один блок:

```text
Продавец: [SELLER_FULL_NAME]
Статус продавца: [SELLER_LEGAL_STATUS]
Идентификатор/УНП: [SELLER_ID_IF_REQUIRED]
Контакт для обращений: [SUPPORT_EMAIL]
Режим обработки обращений: [SUPPORT_HOURS]
```

Literal placeholders не публикуются.

### 9.3. Support route

Публичный CTA всегда называется:

`Обратиться в поддержку`

Он ведёт на approved support route. Канонический legal/ops baseline требует рабочего email route. Telegram может быть дополнительным каналом после операционной проверки, но не заменяет обязательные seller/support disclosures без отдельного legal decision.

### 9.4. Card data wording

Разрешённая формулировка:

> `Номер карты, срок действия, CVV/CVC и данные 3-D Secure вводятся только на стороне WEBPAY. Наш сайт не получает реквизиты карты.`

Нельзя писать без evidence:

- «абсолютно безопасная оплата»;
- «100% защищено»;
- «банк гарантирует»;
- «сертифицировано нашим сервисом»;
- конкретные security certificates или audit claims нашего продукта;
- перечень card schemes до merchant confirmation.

### 9.5. Независимый статус

Короткий checkout disclaimer:

> `Независимый тренировочный сервис. Не является официальным ресурсом РИКЗ и не содержит официальных заданий ЦЭ/ЦТ.`

Checkout не должен имитировать государственный интерфейс, экзаменационную символику или бренд WEBPAY сверх разрешённых provider assets.

---

## 10. Analytics boundary

### 10.1. Решение по naming

Этот документ **не добавляет и не переименовывает canonical analytics events**. Используется `analytics-measurement-plan-v1.md`.

### 10.2. Frontend UX events

| Event | Trigger в payment UX | Не доказывает |
| --- | --- | --- |
| `product_cta_clicked` | Пользователь активировал `Купить одну попытку` | Checkout, Order, оплату |
| `checkout_started` | Checkout успешно показан с backend-issued `checkout_flow_id` | Order, оплату |
| `payment_return_viewed` | Return/status page отрисована с sanitized backend local status | Paid, Access |
| `client_error_shown` | Показана allowlisted UX error category | Internal defect detail или provider outcome |

Отдельный новый frontend event для `Перейти к оплате картой` в v1 не вводится. Фактическое финансовое намерение и создание session измеряются backend events `order_created` и `payment_session_created`.

### 10.3. Backend truth boundaries

- `order_created`: только после commit Order с backend price/product snapshot.
- `payment_session_created`: только после commit PaymentAttempt/provider session state.
- `payment_pending`: local committed pending.
- `payment_confirmed`: только approved authoritative verification: `callback`, `status_api` или `fake_provider` в разрешённой среде.
- `payment_failed`, `payment_cancelled`, `payment_expired`: только после committed authoritative/local terminal mapping.
- `payment_validation_failed`: provider message/status rejected, business state unchanged.
- `access_granted`: только после commit exactly one Access.
- `paid_without_access_detected/resolved`: derived backend/reconciliation truth.

Hard rule:

> `payment_return_viewed`, CTA click, URL parameter, frontend loader и provider page screenshot никогда не создают `payment_confirmed`.

### 10.4. Allowed identifiers

- `checkout_flow_id`: random server-generated opaque UUID, checkout scoped;
- ephemeral `anonymous_session_id`;
- keyed analytics IDs/hashes для Order/PaymentAttempt/Access по measurement plan;
- provider enum и environment;
- allowlisted status/error categories.

### 10.5. Forbidden analytics data

Нельзя передавать:

- email в любом виде;
- hash email;
- имя, телефон и buyer/student assertions;
- PAN, masked PAN, CVV/CVC, expiry, cardholder data, 3DS data;
- provider payload;
- signature, secret key, merchant/store ID или credentials;
- full transaction ID, invoice ID, RRN или provider reference;
- точную сумму и валюту как произвольный event payload, поскольку текущий measurement plan их не включает;
- raw URL/query/fragment;
- session/recovery/payment tokens;
- raw internal/provider errors;
- stack trace;
- ответы, тексты заданий, ключи;
- exact primary score, scaled score или lookup data;
- free text.

### 10.6. Analytics failure

Analytics не блокирует:

- checkout render;
- Order creation;
- payment session creation;
- redirect;
- payment verification;
- Access grant;
- return status;
- recovery.

---

## 11. Copy pack

Все строки готовы для Figma. Строки с названием WEBPAY, protected-page claims, seller data и legal acceptance имеют условную production activation: provider/legal evidence должно быть закрыто до публикации. Это не является открытым UX-решением и не меняет точный текст или расположение.

### 11.1. Checkout

| Key / use | Текст |
| --- | --- |
| Title | `Оформление покупки` |
| Product | `Одна попытка тренировочного онлайн-теста по русскому языку` |
| Price | `Итого: 10 BYN` |
| Payment type | `Разовый платёж` |
| No subscription | `Без подписки, автоматического продления и повторных списаний` |
| One attempt | `Одна покупка - одна попытка` |
| Start window | `Начать попытку можно в течение 90 дней после подтверждения оплаты` |
| Timer | `После начала даётся 120 минут без паузы` |
| Result | `После завершения показывается только первичный результат` |
| Retention | `Результат доступен 12 месяцев` |
| Email | `Подтверждённый email: {emailMasked}` |
| Email purpose | `Email используется для доступа, восстановления и открытия результата.` |
| Payment method | `Банковская карта` |
| Redirect note | `Вы будете перенаправлены на защищённую страницу WEBPAY.` |
| Card boundary | `Номер карты, срок действия, CVV/CVC и данные 3-D Secure вводятся только на стороне WEBPAY. Наш сайт не получает реквизиты карты.` |
| Adult confirmation | `Подтверждаю, что мне исполнилось 18 лет и указанный email находится под моим контролем.` |
| Terms confirmation | `Подтверждаю ознакомление с публичной офертой, условиями оплаты и возврата, а также политикой обработки персональных данных.` |
| Primary CTA | `Перейти к оплате картой` |
| Cancel | `Отменить оформление` |
| Support | `Обратиться в поддержку` |

### 11.2. Redirect

| State | Текст |
| --- | --- |
| Creating Order | `Создаём заказ…` |
| Creating session | `Открываем защищённую страницу WEBPAY…` |
| Redirecting | `Переходим к оплате…` |
| Explanation | `Реквизиты карты нужно будет ввести на стороне WEBPAY.` |
| Fallback heading | `Страница оплаты не открылась автоматически` |
| Fallback explanation | `Заказ уже создан. Откройте подготовленную страницу оплаты вручную.` |
| Fallback CTA | `Открыть страницу WEBPAY` |
| Session error heading | `Не удалось открыть страницу оплаты` |
| Session error explanation | `Заказ сохранён. Перед повторной попыткой мы проверим его состояние, чтобы не создать дубликат.` |
| Safe retry | `Попробовать снова` |

### 11.3. Pending

```text
Проверяем статус оплаты

Статус оплаты пока не подтверждён. Возврат на эту страницу сам по себе не подтверждает оплату.
Не платите повторно, пока статус не изменится.

Обновляем статус оплаты…
```

After automatic window:

```text
Автоматическая проверка завершена. Статус можно обновить вручную.

[Обновить статус]
[Обратиться в поддержку]
```

### 11.4. Paid

```text
Оплата подтверждена

Доступ к одной попытке готов. Переход к следующему экрану не запускает таймер.

[Перейти к началу теста]
```

### 11.5. Failed

```text
Оплата не прошла

Провайдер подтвердил, что эта попытка оплаты завершилась неуспешно. Доступ не создан.

[Попробовать оплатить снова]
[Вернуться к странице теста]
```

### 11.6. Cancelled

```text
Оплата отменена

Оплата не была подтверждена. Доступ не создан.

[Попробовать оплатить снова]
[Вернуться к странице теста]
```

### 11.7. Expired

```text
Время оплаты истекло

Платёжная сессия больше недоступна. Перед новой попыткой мы проверим текущий статус заказа.

[Попробовать оплатить снова]
[Вернуться к странице теста]
```

### 11.8. Unknown status

```text
Статус оплаты пока неизвестен

Не удалось получить подтверждённый статус. Не оплачивайте повторно, пока проверка не завершена.

[Обновить статус]
[Обратиться в поддержку]
```

### 11.9. Paid without access

```text
Оплата подтверждена, доступ оформляется

Повторно оплачивать не нужно. Мы проверяем выдачу доступа к одной попытке.

Проверяем доступ…

[Обновить статус]
[Обратиться в поддержку]
```

### 11.10. Existing Order

```text
Заказ уже создан

Новый заказ не нужен. Откройте текущий статус оплаты.

[Открыть статус оплаты]
```

### 11.11. Existing Access

```text
Доступ уже есть

Повторная покупка не требуется. Продолжите с текущего состояния.

[Перейти к доступу]
```

### 11.12. Support escalation

```text
Нужна ручная проверка

Не оплачивайте повторно. Передайте поддержке номер заказа, чтобы мы проверили оплату и доступ.

Номер заказа: {orderReference}

[Обратиться в поддержку]
```

Support никогда не просит номер карты, CVV/CVC, банковский пароль или одноразовый код.

### 11.13. Recovery

```text
Восстановление доступа

Подтвердите email, который использовался при покупке. После проверки мы откроем текущий заказ, активную попытку или результат.

[Подтвердить email]
```

Resolved variants:

- `Доступ готов. Перейдите к началу теста.`
- `Попытка уже начата. Время продолжает идти.`
- `Результат доступен.`
- `Оплата ещё проверяется. Повторно оплачивать не нужно.`
- `Состояние доступа не удалось определить автоматически. Обратитесь в поддержку.`

---

## 12. External dependencies

### 12.1. Provider dependencies

До реальных платежей необходимо получить и проверить:

1. Merchant agreement и merchant eligibility для exact seller/service model.
2. Sandbox и production credentials.
3. Актуальную merchant-specific integration documentation.
4. Подтверждённый canonical integration method и endpoints.
5. Signature и callback requirements.
6. Фактическую WEBPAY sandbox session.
7. Реальный sandbox callback и signature validation.
8. Merchant-enabled status API и evidence по нему.
9. Authoritative status/transaction mapping для банка и payment scheme.
10. Callback retry/notification configuration.
11. Rate limits для status checks.
12. Session lifecycle и late success rules.
13. Test card/scenario matrix.
14. Return/cancel URL behavior.
15. Exact 3-D Secure flow и mobile return behavior.
16. Supported card schemes и methods для конкретного merchant.
17. Official WEBPAY logo/brand asset rules.
18. Возможность и ограничения branded hosted page.
19. Подтверждение, что provider-controlled embedded page допустима, если она когда-либо рассматривается.
20. Production configuration, bank acquiring and settlement evidence.

### 12.2. Legal and operational dependencies

- approved seller information;
- legal qualification and NPD eligibility;
- final public offer;
- final adult/email confirmation wording;
- refund policy and operational refund flow;
- privacy pages and processor inventory;
- tax receipt process;
- approved support email and hours;
- support runbook for pending, duplicate payment and paid_without_access;
- production email delivery and recovery QA;
- release QA and browser evidence.

### 12.3. Placeholder policy

Допустимые placeholders в Figma/staging:

- `[SELLER_FULL_NAME]`
- `[SELLER_LEGAL_STATUS]`
- `[SELLER_ID_IF_REQUIRED]`
- `[SUPPORT_EMAIL]`
- `[SUPPORT_HOURS]`
- `[WEBPAY_CONFIRMED_CARD_SCHEMES]`
- `[WEBPAY_APPROVED_LOGO_ASSET]`
- `[LEGAL_OFFER_URL]`
- `[LEGAL_REFUND_URL]`
- `[LEGAL_PRIVACY_URL]`

Ни один literal placeholder не допускается в production.

### 12.4. Launch verdict

```text
PAY-01A = READY
PAY-01B = BLOCKED
Real WEBPAY payment launch = NO-GO
Production activation = NO-GO
```

Этот документ не меняет gate status.

---

## 13. Acceptance criteria

Документ и последующий Figma package принимаются только если выполнены все условия:

### Flow and security

- [ ] Основной путь однозначен: product → checkout/email → terms → Order → PaymentAttempt → redirect → WEBPAY → return → backend status → Access.
- [ ] Карточные данные отсутствуют во всех наших UI-компонентах.
- [ ] Figma не содержит имитации банковской формы.
- [ ] Canonical navigation использует redirect, не popup.
- [ ] Return не отображает success без backend confirmation.
- [ ] Access не выдаётся по redirect.
- [ ] Duplicate click/reload/callback/status не создаёт второй Order/Access.

### Checkout

- [ ] До CTA видны 10 BYN, одна попытка, 90 дней, 120 минут, primary-only и no subscription.
- [ ] Email подтверждён до Order.
- [ ] Required checkboxes не preselected.
- [ ] Provider handoff объяснён до CTA.
- [ ] Seller, support, offer, refund и privacy blocks предусмотрены.

### States and recovery

- [ ] Определены pending, paid, failed, cancelled, expired, unknown и paid_without_access.
- [ ] Pending/unknown/PWA запрещают повторную оплату.
- [ ] Terminal retry создаёт новый PaymentAttempt в существующем Order.
- [ ] Automatic polling ограничен 60 секундами UX time.
- [ ] Manual refresh не создаёт финансовые сущности.
- [ ] Reload, Back, mobile switch и повторный вход восстанавливают текущий state.
- [ ] Safe support escalation использует только public order reference.

### Mobile and accessibility

- [ ] Нет horizontal scroll на 320 px.
- [ ] Один primary CTA виден и не перекрывается keyboard/safe-area.
- [ ] Focus order и focus return определены.
- [ ] Loader и polling доступны screen reader без announcement spam.
- [ ] Errors связаны с fields и имеют summary.
- [ ] Состояния не зависят только от цвета.
- [ ] Reduced motion поддержан.
- [ ] Zoom 200% не ломает flow.

### Copy and evidence

- [ ] Все тексты раздела 11 размещены в Figma как реальные строки, не lorem ipsum.
- [ ] Provider/logo/scheme placeholders маркированы и не публикуются.
- [ ] Нет запрещённых официальных или гарантийных формулировок.
- [ ] Marketing page WEBPAY не используется как замена merchant documentation.
- [ ] Real payment launch остаётся `NO-GO`.

---

## 14. Out of scope

Не входит в scope:

- frontend implementation;
- backend implementation;
- задача Codex;
- Figma-макеты в рамках этого документа;
- полный visual system;
- redesign каталога, страницы продукта или exam interface;
- provider API specification;
- endpoints и request/response schemas;
- signature algorithm;
- callback parser;
- production configuration;
- credentials и secrets;
- merchant onboarding execution;
- реальная WEBPAY sandbox transaction;
- legal sign-off;
- payment/access state machine changes;
- refund implementation;
- tax receipt implementation;
- full product analytics redesign;
- новые canonical analytics events;
- ERIP checkout;
- recurrent/card-on-file payments;
- provider-controlled embedded page;
- изменение scoring, authentic content, Result или exam timer.

---

## 15. Handoff requirements for Figma

### 15.1. Обязательные frames

Следующая отдельная задача в Figma должна создать или точечно обновить только payment UX frames:

#### Desktop

1. Checkout email entry.
2. Email verification.
3. Checkout review with product/price/payment/legal blocks.
4. `creating_order`.
5. `creating_payment_session`.
6. `redirecting`.
7. Failed redirect fallback.
8. Payment pending automatic check.
9. Payment pending manual refresh.
10. Payment paid.
11. Payment failed.
12. Payment cancelled.
13. Payment expired.
14. Payment status unknown.
15. Paid without access, reconciling.
16. Paid without access, support required.
17. Existing Order.
18. Existing Access.
19. Recovery after payment.

#### Mobile

Те же 19 frames на 360 px и ключевые проверки на 320 px.

### 15.2. Components and variants

- `PaymentMethodCard`;
- `CheckoutSummary`;
- `VerifiedEmailRow`;
- `RequiredLegalCheckbox`;
- `ExternalPaymentNotice`;
- `PaymentStatusPanel` variants: pending, success, error, cancelled, expired, unknown, paid_without_access;
- `OrderReference`;
- `PollingStatus`;
- `SupportEscalation`;
- `StickyCheckoutAction` mobile;
- loader/reduced-motion annotation;
- focus/error/a11y annotations.

### 15.3. Figma constraints

- Использовать существующий `ux-visual-system-v1.md`.
- Не создавать новый visual direction.
- Не рисовать card inputs.
- Не использовать неподтверждённые Visa/Mastercard/Белкарт/WEBPAY assets.
- Не показывать ERIP.
- Использовать точные тексты раздела 11.
- Показывать conditional placeholders как annotated design tokens, не как production copy.
- Для каждого frame указать source of truth, allowed CTA, prohibited action и focus target.
- Desktop и mobile должны иметь одинаковую state semantics.

### 15.4. Figma acceptance evidence

- link to Figma file/page;
- inventory frames and variants;
- screenshots 1440 px и 360 px;
- 320 px overflow check;
- focus order annotations;
- contrast check;
- literal placeholder scan;
- prohibited card-field scan;
- comparison against this contract.

---

# Decisions superseded by this document

Этот документ заменяет следующие прежние или неоднозначные payment UX decisions:

1. Provider-neutral payment method без зафиксированного основного провайдера.
2. Равноправное или подразумеваемое отображение ЕРИП в checkout первого запуска.
3. Общий CTA `Перейти к оплате` без явного card/redirect meaning.
4. Неопределённость между redirect, popup и embedded payment page.
5. Возможность трактовать browser return как payment success.
6. Неограниченную или незафиксированную по UX длительность automatic status checking.
7. Возможность повторной оплаты из `pending`, unknown или `paid_without_access`.
8. Неопределённость, создаётся ли новый Order при retry.
9. Использование неподтверждённых card scheme logos.
10. Неявную границу card data между продуктом и WEBPAY.
11. Provider copy placeholders для основного card checkout в части, где текст теперь зафиксирован.
12. Недостаточно определённый mobile return/reload/Back behavior.

Документ не заменяет backend payment/access state machines, Launch Control, legal decisions или analytics measurement plan.

# UX documents requiring update

После утверждения Product Owner точечно обновить:

1. `ux-target-flow-spec-v1.md`
   - CHK-01 и PAY-01;
   - canonical payment method;
   - redirect handoff;
   - `payment_status_unknown` UX mapping;
   - 60-second polling UX contract;
   - mobile Back/app return.

2. `ux-copy-pack-v1.md`
   - exact WEBPAY card/redirect copy;
   - CTA contract;
   - unknown status;
   - support thresholds;
   - legal activation annotations;
   - remove/replace obsolete provider CTA ambiguity.

3. `ux-core-wireframes-v1.md`
   - checkout payment-method block;
   - redirect handoff/fallback frames;
   - all return states;
   - mobile sticky action and small-height behavior.

4. `ux-state-wireframes-v1.md`
   - preserve canonical row count unless a separate approved change is made;
   - map existing `status_error` to user-facing `payment_status_unknown` where appropriate;
   - add detailed deltas without changing backend states;
   - update polling, focus, retry and support rules.

5. `ux-visual-system-v1.md`
   - only if required to add reusable payment status/redirect components;
   - no new visual direction.

6. `webpay-onboarding-dossier-v1.md`
   - record the product decision that card redirect is the canonical v1 checkout;
   - retain all merchant-specific questions as open.

# Recommended scope of the next separate Figma task

> **Create a payment-only Figma package for CHK-01, redirect handoff and PAY-01 states in desktop and mobile, using the existing visual system and exact copy from `payment-ux-contract-v1.md`. Include 19 desktop and 19 mobile frames, reusable state components, focus/accessibility annotations, 320 px overflow evidence and no card-data inputs. Do not redesign the product page, exam interface, payment state machine or provider API.**

---

# Final status

`PAYMENT UX CONTRACT V1 — READY FOR PRODUCT OWNER REVIEW`
