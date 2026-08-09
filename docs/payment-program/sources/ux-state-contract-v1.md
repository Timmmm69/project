# UX State Contract v1 — Payment States

**Версия:** 1.0
**Дата:** 2026-08-09
**Статус:** `APPROVED`
**Владелец:** Payment Program
**Область:** точные UX-состояния платёжного return/post-return, CTA, retry, cooldown, support thresholds, copy

Наследует: `payment-ux-contract-v1.md` (разделы 4–11). Этот документ уточняет и фиксирует точные UX-контракты для реализации, не создавая новых product decisions и не переименовывая backend-состояния.

---

## 1. Backend-to-UX state mapping

Все UX-состояния основаны на backend `category` из `serializeCommercialOrderStatus()` в `src/lib/commercial/status-dto.ts`. Backend-состояния не переименованы; UX использует те же семантические категории.

| # | Backend category | UX-заголовок | Primary CTA | Retry | Refresh | Support |
|---|---|---|---|---|---|---|
| 1 | `payment_pending` | `Проверяем статус оплаты` | `Обновить статус` (после auto-window) | Нет | Да | 5 мин / 3 failed refresh |
| 2 | `payment_paid` | `Оплата подтверждена` | `Перейти к началу теста` | Нет | Нет | При проблеме с переходом |
| 3 | `payment_failed` | `Оплата не прошла` | `Попробовать оплатить снова` | Да, новый PaymentAttempt в том же Order | Нет | После повторной ошибки |
| 4 | `payment_cancelled` | `Оплата отменена` | `Попробовать оплатить снова` | Да, новый PaymentAttempt в том же Order | Нет | Если пользователь не отменял |
| 5 | `payment_expired` | `Время оплаты истекло` | `Попробовать оплатить снова` | Да, новый PaymentAttempt в том же Order | Один final refresh перед retry | При повторении |
| 6 | `payment_status_unknown` | `Статус оплаты пока неизвестен` | `Обновить статус` | Нет | Да | 2 failed manual refresh / 5 мин |
| 7 | `paid_without_access` | `Оплата подтверждена, доступ оформляется` | `Обновить статус` | Нет | Да | 60 сек / explicit grant failure |
| 8 | Recovery `payment_pending` | `Оплата ещё проверяется` | `Обновить статус` | Нет | Да | По правилам pending |
| 9 | Recovery `paid_without_access` | `Оплата подтверждена, доступ оформляется` | `Обновить статус` | Нет | Да | По правилам PWA |

**Правило retry:** backend `state-machine.ts` разрешает новый `PaymentAttempt` только из `FAILED`, `CANCELLED`, `EXPIRED`. UX повторяет это без исключений. `pending`, `unknown` и `paid_without_access` не предлагают кнопку «повторить оплату».

**Правило refresh:** `status-dto.ts:113-114`: `refresh_status` разрешён только для `payment_pending`, `payment_status_unknown`, `paid_without_access`. Manual refresh имеет backend cooldown 10 секунд (`status-dto.ts:57`).

---

## 2. Primary CTA contract (один на состояние)

| Состояние | Primary CTA | Действие | Запрещено |
|---|---|---|---|
| `payment_pending` | `Обновить статус` | Manual status refresh | `Попробовать оплатить снова` |
| `payment_paid` | `Перейти к началу теста` | Navigation в PRE-01 | Второй Order, запуск Attempt без подтверждения |
| `payment_failed` | `Попробовать оплатить снова` | Новый PaymentAttempt в том же Order | Новый Order |
| `payment_cancelled` | `Попробовать оплатить снова` | Новый PaymentAttempt в том же Order | Новый Order |
| `payment_expired` | `Попробовать оплатить снова` | Final refresh + новый PaymentAttempt в том же Order | Новый Order |
| `payment_status_unknown` | `Обновить статус` | Manual status refresh | `Попробовать оплатить снова`, terminal conclusion |
| `paid_without_access` | `Обновить статус` | Reconciliation / manual refresh | Повторная оплата |
| Recovery pending/PWA | `Обновить статус` | Manual status refresh | Повторная оплата |

**Hard rule:** browser return (query parameter `paymentReturn=1` или `paymentCancelled=1`) никогда не создаёт `payment_confirmed`. Backend создаёт только `payment_return_viewed` analytics event (UX-only, `src/app/api/commercial/orders/[publicId]/status/route.ts:23`). Browser CTA/URL не подтверждает оплату.

---

## 3. Retry contract

Источник истины: `src/lib/commercial/state-machine.ts`.

```text
canRetryTerminalOrder(status) = FAILED | CANCELLED | EXPIRED
canOpenNewPaymentAttempt(status) = CREATED | FAILED | CANCELLED | EXPIRED
```

| Order status | Retry разрешён? | Что происходит |
|---|---|---|
| `CREATED` (без attempt) | Нет — retry не нужен | `create_payment_session` |
| `PENDING` | **Нет** | Только `refresh_status` |
| `PAID` | **Нет** | `continue_access` |
| `FAILED` | **Да** | Новый PaymentAttempt, тот же Order |
| `CANCELLED` | **Да** | Новый PaymentAttempt, тот же Order |
| `EXPIRED` | **Да** | Новый PaymentAttempt, тот же Order |

**Важно:** retry создаёт новый PaymentAttempt в существующем Order. Order не пересоздаётся. Backend гарантирует не более одной активной попытки через partial unique index.

---

## 4. Cooldown и refresh thresholds

Источник истины: `src/lib/commercial/status-dto.ts:54-57`.

| Параметр | Значение | Источник |
|---|---|---|
| Manual refresh cooldown | 10 секунд | `status-dto.ts:57` |
| Auto-polling window | 60 секунд | `payment-ux-contract-v1.md:503` |
| PWA support threshold | 60 секунд после `paidAt` | `status-dto.ts:55` |
| Pending/unknown support threshold | 5 минут после последнего payment update | `status-dto.ts:54` |
| Rate limit (backend) | `STATUS_REFRESH`: 10/мин | `rate-limit.ts:15-16` |

UX cooldown на manual refresh (10 сек) не зависит от backend rate limit. Backend возвращает `Retry-After` при превышении лимита.

**Polling schedule (frontend, 60 сек window):**

```text
render → 0s → 3s → 7s → 12s → 20s → 30s → 45s → 60s (stop)
```

После 60 секунд:
- Текст: `Автоматическая проверка завершена. Статус можно обновить вручную.`
- Активируется manual `Обновить статус`
- Backend polling приостанавливается
- `pending`/`unknown` продолжают запрещать повторную оплату

---

## 5. Support escalation thresholds

| Состояние | Support показывается | Условие |
|---|---|---|
| `paid_without_access` | 60 сек после `paidAt` | Автоматически |
| `paid_without_access` | Немедленно | Explicit unrecoverable grant failure |
| `payment_status_unknown` | 2 failed manual refresh ИЛИ 5 мин | Что наступит раньше |
| `payment_pending` | 5 мин после return ИЛИ 3 failed manual refresh | Что наступит раньше |
| `payment_failed` | Secondary action — всегда доступен | После первичного CTA |
| `payment_cancelled` | Secondary action — всегда доступен | После первичного CTA |
| `payment_expired` | Secondary action — всегда доступен | После первичного CTA |

Support CTA: `Обратиться в поддержку`.

**Безопасный order reference:** `orderReference` в DTO — публичный opaque `publicId` (12–128 символов). Не является provider transaction ID, internal DB ID или payment attempt ID.

---

## 6. Security invariants (обязательные для UI)

| # | Инвариант | Реализация | Последствия нарушения |
|---|---|---|---|
| 1 | Browser return не подтверждает оплату | Backend `payment_return_viewed` (analytics), не переходит к `payment_paid` | Пользователь видит pending, не paid |
| 2 | Pending/unknown/PWA не предлагают retry | `status-dto.ts:98-99`: только `refresh_status` | Пользователь не может переплатить |
| 3 | Retry только из failed/cancelled/expired | `state-machine.ts:37-38`: `canRetryTerminalOrder` | Не создаётся дублирующая попытка в активном Order |
| 4 | Новый Order не создаётся при retry | Тот же `publicId` Order, новый `PaymentAttempt` | Предотвращает дубликаты Order |
| 5 | Access только после server-side paid | `grantAccess: false` для manual refresh | Browser CTA не выдаёт Access |
| 6 | Карточные данные не вводятся на нашем сайте | Только hosted WEBPAY page | PCI compliance |
| 7 | `no-store` / `no-referrer` на всех payment routes | `PAYMENT_RESPONSE_HEADERS`, `RECOVERY_RESPONSE_HEADERS` | Кэш браузера / referrer не утекает |
| 8 | Safe public order reference | `orderReference = publicId`, не internal ID | Support видит только публичный идентификатор |
| 9 | Provider payload не в URL | `paymentReturn=1` / `paymentCancelled=1` — единственные query params | Raw данные провайдера не в браузере |

---

## 7. Copy pack (точные строки)

Наследует: `payment-ux-contract-v1.md` раздел 11. Дополнения и уточнения:

### 7.1. Pending

```text
Заголовок: Проверяем статус оплаты
Объяснение: Статус оплаты пока не подтверждён. Возврат на эту страницу сам по себе не подтверждает оплату.
             Не платите повторно, пока статус не изменится.
Auto:       Обновляем статус оплаты…
After 60s:  Автоматическая проверка завершена. Статус можно обновить вручную.
CTA:        [Обновить статус]
Support:    [Обратиться в поддержку] (после threshold)
```

### 7.2. Paid

```text
Заголовок: Оплата подтверждена
Объяснение: Доступ к одной попытке готов. Переход к следующему экрану не запускает таймер.
CTA:        [Перейти к началу теста]
Support:    [Обратиться в поддержку] (при проблеме с переходом)
```

### 7.3. Failed

```text
Заголовок: Оплата не прошла
Объяснение: Провайдер подтвердил, что эта попытка оплаты завершилась неуспешно. Доступ не создан.
CTA:        [Попробовать оплатить снова]
Secondary:  [Вернуться к странице теста]
Support:    [Обратиться в поддержку]
```

### 7.4. Cancelled

```text
Заголовок: Оплата отменена
Объяснение: Оплата не была подтверждена. Доступ не создан.
CTA:        [Попробовать оплатить снова]
Secondary:  [Вернуться к странице теста]
Support:    [Обратиться в поддержку] (если пользователь не отменял)
```

### 7.5. Expired

```text
Заголовок: Время оплаты истекло
Объяснение: Платёжная сессия больше недоступна. Перед новой попыткой мы проверим текущий статус заказа.
CTA:        [Попробовать оплатить снова]
Secondary:  [Вернуться к странице теста]
Support:    [Обратиться в поддержку]
```

### 7.6. Unknown

```text
Заголовок: Статус оплаты пока неизвестен
Объяснение: Не удалось получить подтверждённый статус. Не оплачивайте повторно, пока проверка не завершена.
CTA:        [Обновить статус]
Support:    [Обратиться в поддержку] (после threshold)
```

### 7.7. Paid without access

```text
Заголовок: Оплата подтверждена, доступ оформляется
Объяснение: Повторно оплачивать не нужно. Мы проверяем выдачу доступа к одной попытке.
Reconciling: Проверяем доступ…
CTA:        [Обновить статус]
Support:    [Обратиться в поддержку] (после threshold или explicit failure)
```

### 7.8. Recovery — payment pending

```text
Заголовок: Оплата ещё проверяется
Объяснение: Мы проверили текущее состояние заказа. Повторно оплачивать не нужно.
CTA:        [Обновить статус]
Support:    [Обратиться в поддержку] (по правилам pending)
```

### 7.9. Recovery — paid without access

```text
Заголовок: Оплата подтверждена, доступ оформляется
Объяснение: Мы проверили текущее состояние заказа и доступа. Повторно оплачивать не нужно.
CTA:        [Обновить статус]
Support:    [Обратиться в поддержку] (по правилам PWA)
```

### 7.10. Support escalation

```text
Заголовок: Нужна ручная проверка
Объяснение: Не оплачивайте повторно. Передайте поддержке номер заказа, чтобы мы проверили оплату и доступ.
Reference:  Номер заказа: {orderReference}
CTA:        [Обратиться в поддержку]
```

Support никогда не просит номер карты, CVV/CVC, банковский пароль или одноразовый код.

---

## 8. Redirect handoff

| Элемент | Значение |
|---|---|
| Тип redirect | Same-tab (`window.location` в той же вкладке) |
| Popup/new-tab | Запрещён в canonical flow |
| До redirect | `Создаём заказ…` → `Открываем защищённую страницу WEBPAY…` |
| Fallback (10 сек) | `Открыть страницу WEBPAY` — не создаёт новый Order/PaymentAttempt |
| После ошибки session | `Попробовать снова` — resolver перед retry |
| Повторный клик | Заблокирован до результата Order/session request |

---

## 9. Mobile и accessibility

### 9.1. Viewports

| Viewport | Требование |
|---|---|
| 320 x 568 | Горизонтальный scroll запрещён. Primary CTA виден. |
| 360 x 640 | Стандартный mobile flow. |
| 390 x 844 | iPhone 14. |
| 412 x 915 | Крупный Android. |
| 667 x 375 (landscape) | Не ломается. |
| Desktop + 200% zoom | Narrow effective width, не ломается. |

### 9.2. Keyboard и focus

- Полный checkout доступен без мыши.
- Focus order: DOM order = visual order.
- После terminal state: focus один раз на heading.
- Disabled CTA не единственный способ узнать причину.
- Polling не перемещает focus.
- Spinner не получает focus.

### 9.3. Screen reader

- Loading: `role=status` / polite live region.
- Terminal change объявляется один раз.
- Polling итерации не объявляются.
- Состояния не различаются только цветом.
- Icon всегда с текстом.

### 9.4. Reduced motion

При `prefers-reduced-motion: reduce`:
- Нет вращающихся loader-анимаций.
- Переходы мгновенные или minimal fade.
- Смысл сохраняется текстом.

---

## 10. Acceptance checklist

| # | Критерий | Соответствие |
|---|---|---|
| 1 | 9 состояний имеют точный backend→UX маппинг | Таблица в разделе 1 |
| 2 | Один primary CTA на состояние | Раздел 2 |
| 3 | Retry только из failed/cancelled/expired | Раздел 3 |
| 4 | Pending/unknown/PWA не предлагают retry | Раздел 2—3 |
| 5 | Same-tab WEBPAY redirect | Раздел 8 |
| 6 | Browser return не подтверждает оплату | Раздел 6, инвариант #1 |
| 7 | Cooldown 10 сек manual refresh, 60 сек auto | Раздел 4 |
| 8 | Support thresholds: PWA 60s, pending/unknown 5min | Раздел 5 |
| 9 | Safe public order reference (opaque publicId) | Раздел 5 |
| 10 | No popup/new-tab/card inputs | Раздел 8, инвариант #6 |
| 11 | Mobile viewports: 320–412, landscape, 200% zoom | Раздел 9.1 |
| 12 | Keyboard, focus и screen reader | Раздел 9.2—9.3 |
| 13 | Exact copy без lorem ipsum | Раздел 7 |
| 14 | Backend states не переименованы | Раздел 1 |
| 15 | ERIP, popup и card inputs отсутствуют | Раздел 8, инвариант #6 |

---

## 11. Версии и зависимости

| Источник | Версия | Статус |
|---|---|---|
| `payment-ux-contract-v1.md` | v1 (2026-07-18) | Наследуется, статус обновлён до `APPROVED` |
| `src/lib/commercial/status-dto.ts` | Текущий HEAD | Backend source of truth |
| `src/lib/commercial/state-machine.ts` | Текущий HEAD | Retry/transition rules |
| `src/lib/commercial/rate-limit.ts` | Текущий HEAD | Backend rate limits |

Этот документ не заменяет `payment-ux-contract-v1.md` и не создаёт новых product decisions. Он является implementation-aligned уточнением для Figma (D-02, D-03) и frontend (C-01..C-07).
