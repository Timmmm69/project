# Payment Program Goal Handoff 1

Создан: 2026-07-30
Причина: контекст текущего агента приблизился к 90%
Ветка: `main`
Payment-program implementation HEAD at handoff creation: `36abf30`
Production verdict: `NO-GO`

## Постоянная цель

Автономно довести переход с legacy ExpressPay/E-POS/ЕРИП checkout к WEBPAY hosted internet acquiring по канонической платёжной доске:

- backend, frontend, security, recovery, analytics, UX/Figma, merchant, legal, operations и QA;
- WEBPAY hosted POST redirect в той же вкладке;
- ЕРИП отсутствует в first-launch checkout и остаётся deferred;
- production запрещён до закрытия всех external/security/QA gates;
- implementer переводит карточку максимум в `IN_REVIEW`;
- только отдельный reviewer выставляет `DONE`;
- reviewer не исправляет implementation.

Цель не завершена. Не сужать её до документационного этапа или текущей карточки.

## План goal mode

1. Foundation/governance: A-01..A-07.
2. Verified commercial authority/recovery: B1-01..B1-05.
3. Payment state/recovery: B2-01..B2-07.
4. Security/analytics: B3-01..B3-05.
5. UX/Figma: D-01..D-03.
6. Canonical frontend: C-01..C-07.
7. Merchant integration: E-01..E-05.
8. Legal/operations: O-01..O-04.
9. Full regression and independent production gate: QA-01/QA-02.

Внешние merchant/legal gates нельзя закрывать mock, local fake или assumed sandbox evidence.

## Обязательный порядок чтения

1. `AGENTS.md`.
2. `docs/00-final-mvp-spec-v2.md`.
3. `docs/11-approved-decisions-current.md`.
4. `docs/payment-program/sources/README.md`.
5. `docs/payment-program/source-reconciliation.md`.
6. `docs/payment-program/board.md`.
7. Активная task card.
8. `docs/payment-program/handoff.md`.
9. Этот файл.
10. Только bounded sources активной карточки.

История чата не является источником истины.

## Завершённые и независимо принятые карточки

| Card | Result | Key commits/review |
|---|---|---|
| `A-01` | `DONE` | correction `82ead81`; review acceptance `1a07bb8` |
| `A-02` | `DONE` | implementation `13cccb4`; correction `2a54a09`; acceptance `b40eb78` |
| `A-04` | `DONE` | implementation `2435e8b`; acceptance `b172f70` |
| `A-03` | `DONE` | implementation `fbcce7b`; correction `2850e91`; acceptance `7dee3b0` |

Главные результаты:

- источники/ACC-01A versioned и переносимы;
- WEBPAY/ЕРИП/NO-GO contract закреплён в canonical docs;
- 35/35 audit findings перепроверены на текущем дереве;
- текущие totals: `12 IMPLEMENTED / 10 PARTIAL / 9 MISSING / 2 CONTRADICTED / 2 MERCHANT_BLOCKED`;
- 12 dependency-ready карточек были открыты после A-03.

## Критическое baseline-различие

Historical audited `origin/main` SHA `adf2355` не является предком текущего `main`.

- Merge base: `01eb2d3a8a52e5d7efe261e88cacce378212037e`.
- Audited sibling branch содержит verified-session/recovery/canonical analytics runtime изменения.
- Текущий main не содержит `src/server/auth/verified-student-session/` и `src/server/recovery/`.
- Не выполнять silent merge/cherry-pick.
- Любая интеграция sibling history должна быть отдельной карточкой/claim с diff audit, конфликтами, тестами и independent review.

Evidence: `docs/payment-program/audit-revalidation-2026-07-30.md`.

## Текущая карточка A-05

Статус на board: `IN_REVIEW` перед полученным verdict.

Implementation commit: `36abf30`
Base SHA: `7dee3b0`

Созданы:

- `docs/payment-program/stage-7-launch-control-v1.md`;
- `docs/payment-program/webpay-onboarding-dossier-v1.md`;
- `docs/payment-program/webpay-sandbox-evidence-plan-v1.md`.

Обновлены README и historical/legacy docs 21/22/26/27.

### Полученный independent verdict

`CHANGES_REQUIRED`

Единственный finding:

- `LOW A05-DOC-HYGIENE-01`;
- `git diff --check 7dee3b0..36abf30` не проходит из-за trailing whitespace на строках 3–5 каждого из трёх новых документов;
- удалить только завершающие пробелы;
- повторить diff check;
- сделать отдельный correction commit;
- передать тому же независимому reviewer.

Все содержательные проверки A-05 прошли: gate register, dossier, sandbox plan, PDF/merchant-protocol boundary, legacy reconciliation, feature-off/rollback и production `NO-GO`.

## Точное продолжение

1. Записать review report `docs/payment-program/reviews/A-05.md` с historical verdict `CHANGES_REQUIRED`.
2. Перевести A-05/board/handoff в `CHANGES_REQUIRED` и сделать отдельный review commit.
3. Отдельным correction pass удалить только trailing whitespace:
   - `stage-7-launch-control-v1.md` строки 3–5;
   - `webpay-onboarding-dossier-v1.md` строки 3–5;
   - `webpay-sandbox-evidence-plan-v1.md` строки 3–5.
4. Повторить:
   - `git diff --check`;
   - `git diff --check 7dee3b0`.
5. Синхронизировать A-05/board/handoff обратно в `IN_REVIEW`.
6. Создать отдельный correction commit.
7. Запустить independent correction review.
8. При `DONE` открыть следующий приоритет.

## Следующий приоритет после A-05

Рекомендуемый порядок:

1. `A-06` — analytics measurement plan.
2. `A-07` — итоговая traceability.
3. Перед B1 implementation решить branch-integration boundary для отсутствующих verified-session/recovery изменений; не предполагать, что current main содержит audited code.
4. Затем critical security/authority cards:
   - `B1-01`;
   - `B3-01`;
   - `B3-04`;
   - далее B1/B2 dependency order.

Другие READY на момент передачи:

`A-06`, `A-07`, `B1-01`, `B2-01`, `B2-02`, `B2-05`, `B2-06`, `B3-01`, `B3-02`, `B3-03`, `B3-04`.

Всегда заново сверять board после review/status commit.

## Рабочая копия

До payment-goal работы существовали unrelated изменения; не включать их в payment commits:

- modified `next-env.d.ts`;
- modified `pnpm-workspace.yaml`;
- untracked `.serena/`;
- untracked `docs/00-current-project-state.md`;
- untracked `tmp/`.

`handoff-1.md` создан по прямому указанию пользователя и должен быть сохранён отдельно от unrelated файлов.

## Проверки и commit discipline

- Каждая карточка — отдельный implementation/correction commit.
- Review verdict — отдельный review commit.
- Перед commit: `git diff --check`.
- Code cards: `pnpm lint`, `pnpm typecheck`, `pnpm test`, relevant Playwright/manual smoke.
- Не stage unrelated working-tree files.
- Не менять production verdict без QA-02.
- Не хранить credentials/secrets/raw provider payload в git/evidence.

## Цепное правило handoff

Следующий агент обязан следовать этой же инструкции.

Когда его контекст приблизится к 90%, он:

1. создаёт `handoff-2.md` рядом с этим файлом;
2. переносит полную постоянную цель и plan goal mode;
3. фиксирует current HEAD, branch, active card/status, commits, reviews, checks, working tree и exact next action;
4. записывает все blockers/decisions без silent assumptions;
5. повторяет это цепное правило для следующего агента.

Каждый последующий агент увеличивает номер: `handoff-3.md`, `handoff-4.md` и так далее. Старые handoff-файлы не переписываются и сохраняются как audit trail.
