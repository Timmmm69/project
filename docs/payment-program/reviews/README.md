# Risk-based Review Protocol

Последнее решение владельца: 2026-08-01. Отдельный reviewer не запускается для
каждого малого шага. Review effort должен быть соразмерен риску и объединяться
на уровне осмысленного milestone.

## Tier 1 — обязательный независимый review

Отдельный reviewer обязателен для:

- CRITICAL/HIGH изменений в authentication, payment/access authority,
  concurrency/idempotency, privacy/security или financial state;
- migrations и API contracts, способных изменить ownership, оплату или выдачу
  Access;
- merchant/legal/production gates и production activation;
- завершения крупного backend/frontend/payment milestone;
- QA-01/QA-02 и любого изменения с открытым CRITICAL/HIGH риском.

Для Tier 1 только независимый reviewer ставит `DONE`. Он читает `AGENTS.md`,
Final MVP Spec, board, карточку и handoff, проверяет SHA/diff/acceptance/source
hierarchy, повторяет только критичные проверки, не исправляет implementation и
создаёт `reviews/<TASK-ID>.md`. Незакрытый CRITICAL/HIGH или отсутствующее
обязательное evidence означает `CHANGES_REQUIRED`.

## Tier 2 — consolidated milestone review

Связанные средние изменения проверяются одним reviewer после завершения
целостного блока, а не отдельным чатом на каждый подпункт. Один milestone report
может принимать несколько карточек, если в нём перечислены все task IDs,
reviewed SHA для каждой, общий regression scope и отдельный verdict по каждой
карточке. До consolidated review карточки остаются `IN_REVIEW` и не
разблокируют зависимые production/security gates.

## Tier 3 — self-check без отдельного reviewer

Отдельный чат не нужен для документационной гигиены, traceability maintenance,
copy-only правок, локальных test fixtures и других малых изменений, которые не
меняют runtime/API/schema/security/money/external gates. Implementer выполняет
обязательные проверки и может поставить `DONE`, если одновременно:

1. карточка явно содержит `Review mode: SELF_CHECKED` и обоснование Tier 3;
2. diff ограничен заявленным безопасным scope;
3. evidence, counts, dependencies и handoff синхронизированы;
4. нет открытого CRITICAL/HIGH finding;
5. изменение будет повторно охвачено ближайшим milestone review или QA-02.

Малые подшаги по возможности не создаются как отдельные карточки, а входят в
evidence родительского milestone. Findings во всех tier классифицируются как
`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`.
