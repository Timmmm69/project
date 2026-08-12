# WEBPAY Onboarding Dossier v1

Версия: 1.0
Дата: 2026-07-30
Владелец: Merchant onboarding owner / Product Owner
Статус: `BLOCKED_EXTERNAL`

Этот dossier — реестр необходимых authoritative inputs. Он не является merchant agreement или технической документацией WEBPAY.

## Продуктовый boundary

- Продукт: разовая покупка доступа к онлайн-тесту.
- Launch market/currency: Беларусь / BYN.
- Target provider: WEBPAY internet acquiring.
- Handoff: hosted POST redirect в той же вкладке.
- ЕРИП: не входит в first-launch checkout.
- Card data: сайт не принимает и не хранит PAN/CVV/cardholder inputs.
- Production: `NO-GO`.

## Merchant и eligibility

| Input | Требуемый источник | Status |
|---|---|---|
| Допустимый статус продавца для онлайн-тестов | Письменное подтверждение WEBPAY/acquirer | `MISSING` |
| Merchant agreement и номер договора | Подписанный договор | `MISSING` |
| Merchant/site identifiers | Merchant cabinet / signed onboarding sheet | `MISSING` |
| Settlement account/currency/schedule | Acquirer contract | `MISSING` |
| Поддерживаемые card schemes | Merchant-specific provider docs | `MISSING` |
| 3-D Secure и mobile rules | Merchant-specific provider docs | `MISSING` |
| Brand/logo/copy rules | WEBPAY brand package | `MISSING` |

При невозможности подключения выбранного статуса продавца Product Owner отдельно утверждает ИП/юрлицо; код не должен угадывать это решение.

## Технический contract

До E-02 должны быть подтверждены:

- sandbox и production action/status endpoints;
- обязательные/опциональные request fields;
- amount/currency formatting и rounding;
- merchant/order/reference constraints;
- signature algorithm, canonicalization, encoding и key rotation;
- callback transport, authentication, retry/replay policy и acknowledgement;
- authoritative status API authentication и response signatures;
- provider transaction identifiers;
- session expiry и возможность reopen/recreate;
- terminal states, late success и reversal semantics;
- return/cancel URLs;
- rate limits, timeouts и retry guidance;
- mobile browser и 3-D Secure behavior;
- test cards/accounts и deterministic sandbox scenarios;
- production secrets delivery/storage/rotation.

Assumed `wsb_*` fields в текущем sandbox adapter не считаются подтверждённым contract.

## Требования к сайту

External source: `C:\Users\novik\Downloads\требования к сайту (87).pdf`, SHA-256 `6AF4699F0681EAFE1B7B2AA7C17DDC4560DE9A0422A4E0296727A616810292C7`.

До O-01/O-03/E-05 требуются проверенные:

- данные продавца и контакты;
- описание цифровой услуги и порядок её получения;
- цены в BYN;
- порядок оформления и контроля заказа;
- способы оплаты и правила безопасной оплаты;
- offer/payment/refund/privacy terms;
- порядок ручного возврата;
- сведения о чеке/квитанции;
- официальные WEBPAY/payment logos и корректная provider copy;
- применимые требования регистрации сайта/хостинга в Беларуси.

PDF не определяет callback/signature/status API; технические assumptions из него запрещены.

## Credentials inventory

Секреты никогда не записываются в этот Markdown.

| Credential/config | Sandbox | Production | Evidence owner |
|---|---|---|---|
| Merchant ID | `MISSING` | `MISSING` | E-01/E-05 |
| Signing secret/key | `MISSING` | `MISSING` | E-02/E-05 |
| Status API credential | `MISSING` | `MISSING` | E-02/E-05 |
| Callback allowlist/config | `MISSING` | `MISSING` | E-02/E-05 |
| Action/status URLs | `MISSING` | `MISSING` | E-02/E-05 |
| Return/cancel URLs registered | `MISSING` | `MISSING` | E-02/E-05 |

Evidence хранится в approved secret/config system или redacted review attachment, а не в git.

## Exit criteria

Dossier получает `COMPLETE` только когда каждый input имеет authoritative source, owner, date/version и reviewer verdict. До этого E-03/E-04/E-05 и production остаются заблокированы.
