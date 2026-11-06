# Task 6A — Session controls persistence, audit history, and sticky state

## Place in the plan

This is the first of three sequential sub-steps for Task 6 in `docs/superpowers/plans/2026-11-04-office-knowledge.md`. Task 5 is committed at `4b9e5be`. This sub-step owns only the durable session state and neutral history protocol. Task 6B will build `search_knowledge` and agent wiring; Task 6C will finish live controls/header/citation UI. Do not implement the knowledge tool or citation UI here.

Read the architecture audit first: `.superpowers/sdd/2026-11-04-office-knowledge/task-6-architecture.md`.

## Binding behavior

- Existing `ChatSettings.webResearchEnabled?` and `officeKnowledgeEnabled?` remain optional; absence means OFF.
- Settings updates are authenticated, owner-scoped, replace-whole for the two allowed booleans, and apply to agent composition on the next run (composition is Task 6B).
- Every semantic toggle change appends a durable, reloadable audit entry to that session's native history. A no-op PUT appends nothing. A request changing both flags records both changes in one event.
- Use a stable UI-only native marker with custom type `session-controls-changed`. Its details contain neutral structured data, not localized prose: an ISO `at` timestamp and ordered changes using field names `webResearchEnabled` / `officeKnowledgeEnabled` with boolean `from` and `to` values.
- The audit marker must be explicitly filtered from `toLlmMessages`; it must never become a user message or interrupt provider tool-call/result adjacency. Project it into the UI view protocol with a stable data part for Task 6C to render later.
- Settings changes and audit events do not bump `updatedAt` or reorder the sidebar.
- `knowledgeUsed` is monotonic: a dedicated `ChatStore.markKnowledgeUsed(chatId)` fresh-reads the record, changes false/absent to true exactly once, writes synchronously, and returns whether this call made the transition. No caller can clear it.
- Add the narrow store operation that persists settings and the audit event in one record publication. It must preserve all unrelated record fields and existing messages.
- Convert the central chat-record write choke point to crash-safe same-directory atomic replacement: private unpredictable temp file, restrictive mode, write, fsync, close, atomic rename, and cleanup on failure. Existing future-version protection remains intact.
- All of these operations remain reachable only through the existing per-user `storesForUser`/checked owner composition. No raw store construction outside the composition root.
- The settings route must reject model/provider overrides as it already does, preserve authentication and owner isolation, and return the persisted two-flag settings.
- After a semantic settings change, emit owner/session-scoped `record-changed` only after successful persistence so open tabs can reload. No event on validation failure, persistence failure, or no-op.
- A foreground turn settling after a settings change must preserve the audit marker and sticky state by fresh-reading before its write. Cover this explicitly.

## TDD tests

Write tests first and observe behavioral RED failures (not only import errors), then implement minimally. Extend focused existing suites or add one dedicated file. Cover:

1. absent flags read OFF;
2. invalid/non-boolean settings rejected;
3. ON/OFF and both-at-once changes persist one neutral audit marker with correct ordered from/to values;
4. identical PUT adds no marker and emits no event;
5. audit marker survives reload and is projected for UI but absent from LLM wire messages;
6. Alice cannot change or inspect Bob's controls/history;
7. `markKnowledgeUsed` is monotonic/idempotent and cannot be reset by settings writes, message writes, usage writes, tree writes, or reload;
8. a persistence/rename failure leaves the prior complete record, cleans temp files, and emits no success event;
9. an in-flight/settling turn preserves an audit marker added while it runs;
10. every chat-record write remains under the owner's root and no old/global constructor is introduced.

Use real isolated stores/routes/events where practical. If a filesystem failure needs injection, inject only the filesystem seam and assert the real store's observable files/record.

## Verification cadence

- Run only focused changed/affected tests, `npm.cmd run typecheck`, and `git diff --check`.
- Do not run `npm test`, lint, build, or artifact scanning; the complete #6 gate is Task 7.
- Do not commit; the controller will independently review, verify, and commit.
- Do not dispatch subagents.

## Report

Write `.superpowers/sdd/2026-11-04-office-knowledge/task-6a-report.md` with files changed, RED and GREEN commands/output, typecheck/diff-check, decisions recorded in `docs/office-v1-progress.md`, and concerns. Return only status, one-line focused-test summary, and concerns.
