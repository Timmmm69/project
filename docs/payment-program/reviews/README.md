# Independent Review Protocol

1. Reviewer работает в отдельном чате и сначала читает `AGENTS.md`, Final MVP Spec, board, карточку и handoff.
2. Reviewer проверяет актуальный SHA/working tree, diff, acceptance criteria и source hierarchy.
3. Reviewer повторяет критические проверки или явно фиксирует, почему evidence недоступно.
4. Reviewer не исправляет реализацию в review pass.
5. Findings классифицируются как `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`.
6. Любой незакрытый CRITICAL/HIGH или отсутствующее обязательное evidence означает `CHANGES_REQUIRED`.
7. Только reviewer может поставить `DONE` и обязан одновременно обновить board, карточку, review report и handoff.
8. Review report создаётся как `reviews/<TASK-ID>.md` по шаблону.

