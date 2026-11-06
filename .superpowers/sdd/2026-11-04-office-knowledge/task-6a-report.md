# Task 6A report

Status: implemented, focused verification passed, no commit made.

## Files changed

- `app/api/chats/[id]/settings/route.ts`: strict two-control office allowlist, atomic controls/audit operation, post-persistence owner/session notification, persisted effective controls response.
- `src/core/contracts/chat.ts`: required effective control shape and neutral audit payload contract; existing optional stored flags remain optional.
- `src/core/ports.ts`: `saveSessionControls` and monotonic `markKnowledgeUsed` operations.
- `src/core/native-messages.ts`: native audit constructor and explicit LLM-wire exclusion.
- `src/core/view.ts`: stable `data-session-controls-changed` projection for Task 6C.
- `src/core/compaction.ts`: excludes the UI-only audit from summarizer model input too.
- `src/store/chats.ts`: synchronous fresh-record controls/audit and sticky operations; shared private temporary-file/fsync/close/rename write choke point with failure cleanup.
- `tests/session-controls.test.ts`: 18 focused behavioral tests using real isolated owner stores/routes/events and filesystem-only failure injection.
- `docs/office-v1-progress.md`: approved decisions and verification checkpoint.

## TDD RED evidence

Sandbox attempts:

```text
npx.cmd tsx --import ./tests/bootstrap.mjs --test tests/session-controls.test.ts
node --import tsx --import ./tests/bootstrap.mjs --test tests/session-controls.test.ts
```

Both were unable to start because tsx's temporary-directory helper hit `uv_os_get_passwd` / `ENOMEM` in `os.userInfo()`. These environmental startup failures were not counted as behavioral RED. Subsequent focused tests used the established approved unsandboxed Node/tsx invocation.

Initial behavioral RED:

```text
node --import tsx --import ./tests/bootstrap.mjs --test tests/session-controls.test.ts
tests 12; pass 2; fail 10; exit 1
```

Observed assertion failures included absent-control no-op rewriting the record, provider overrides being accepted, missing durable audit markers, and fsync/rename failures not rejecting publication. Missing sticky-operation failures were also present; RED did not rely only on missing symbols. Existing authentication/owner isolation and write-error propagation already passed.

Independent native protocol RED before implementation:

```text
node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern="projects a native|explicitly omits" tests/session-controls.test.ts
tests 2; pass 0; fail 2; exit 1
```

UI projection was empty, and the LLM wire converted the audit fixture into an empty user message.

Additional behavioral RED during review:

```text
node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern="compaction's model input" tests/session-controls.test.ts
tests 1; pass 0; fail 1; exit 1
actual '[SYSTEM NOTE] '; expected ''

node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern="exclusive creation fails|compaction's model input" tests/session-controls.test.ts
tests 2; pass 1; fail 1; exit 1
failed exclusive-open cleanup deleted an unowned occupied temporary path
```

The compaction filter and temporary-file ownership guard were implemented only after those failures.

## GREEN and checks

Initial implementation verification: 14/14 Task 6A tests passed. Initial affected run: 162/162 passed.

Final focused command:

```text
node --import tsx --import ./tests/bootstrap.mjs --test tests/session-controls.test.ts tests/settings-body.test.ts tests/chat-store-events.test.ts tests/office-chat-isolation.test.ts tests/schema-stamps.test.ts tests/practice-record.test.ts tests/compaction.test.ts tests/golden-fixtures.test.ts tests/chat-flow.test.ts
tests 166; suites 38; pass 166; fail 0; cancelled 0; skipped 0; exit 0
```

The final run includes 18 new Task 6A cases. It covers absent flags, invalid/forbidden settings, ordered one/both-control transitions, byte-identical no-op, reload/UI/wire behavior and adjacency, authentication and Alice/Bob isolation, explicit-false/absent sticky transitions and idempotence, preservation by all record writers, deferred foreground settlement, torn write/fsync/rename failures, sticky persist failure, private-temp ownership, owner-root publication, and checked-store rejection after owner deletion. Existing schema/version, native/practice history, compaction, silence-law, golden read-only, and scripted foreground-flow suites also passed. Expected pre-existing diagnostic output covers deliberate future-version refusal and rejected concurrent turns.

```text
npm.cmd run typecheck
> tsc --noEmit
exit 0

git diff --check
exit 0
```

Git reports CRLF-to-LF normalization notices for the touched existing native/view/compaction files; no whitespace errors. Final documentation-only edits were followed by another diff check.

## Decisions recorded in progress documentation

- Only the two office flags are accepted at this route; broader non-office parser compatibility remains unchanged.
- Optional absent stored flags mean OFF; omitted PUT controls mean false.
- No-op preserves the complete existing record, including server/internal model pins; the first semantic change normalizes settings to the two booleans. This boundary was explicitly confirmed by the controller.
- One neutral ordered UI-only native audit marker per semantic request, filtered from both foreground wire and compaction input; stable UI data part reserved for Task 6C.
- No settings/audit activity timestamp/sidebar churn, and only post-success semantic settings requests emit owner/session `record-changed`.
- Sticky use persists synchronously, is monotonic, and survives fresh-read settlement and all other record writers.
- Every chat-record writer shares the atomic replacement choke point; per-user composition and future-version read protection remain intact.

## Concerns and scope

No blocking concerns. Atomic file replacement preserves the approved single-process fresh-read mutation discipline; it does not introduce cross-process locking. No raw/global store construction was introduced. The sole production constructor call remains in `src/server/stores.ts`.

Task 6B tool/agent wiring and Task 6C live controls/header/citation rendering remain intentionally untouched. No full suite, lint, build, artifact scan, subagent dispatch, or commit was performed.

## Review fix loop round 1: deferred compaction publication

The reviewer identified a second awaited history writer in `src/server/compaction.ts`: `compact` captured `messages` before awaiting the summarizer and published that stale array afterward. This could discard controls audit markers added while the summary was pending even though settings and sticky state survived the store's fresh record read.

Changed files for this fix loop:

- `tests/compaction-service.test.ts`: added a deterministic injected deferred summarizer (no sleeps), a regression preserving pre-existing and mid-summary audits/messages in exact order without duplication, and a future-version upgrade-during-summary protection test.
- `src/server/compaction.ts`: fresh-read immediately before publication, append the new compaction marker onto the current messages, and retain the original summarized span's cut. A missing/refused fresh record still follows the existing caught `Chat not found` failure path, without usage or success notification.
- `docs/office-v1-progress.md`: recorded the compaction publication boundary and fix evidence.

Exact behavioral RED command and output:

```text
node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern="deferred summary" tests/compaction-service.test.ts

✖ preserves ordered audit markers and messages added during a deferred summary without duplicates or moving the cut
✔ does not rewrite a record upgraded to a future version during a deferred summary
AssertionError [ERR_ASSERTION]: all pre-existing and mid-summary controls audits survive
1 !== 3
tests 2; suites 1; pass 1; fail 1; cancelled 0; skipped 0; exit 1
```

The pre-existing audit survived, while both controls audits written during the awaited summary were erased. The same regression also checks an intervening message, exact native history contents/order, unique IDs, one compaction marker, the original first-kept message, post-cut LLM history with the late message and no audit messages, sticky state, settings, and one usage entry. The version-protection characterization already passed on the old implementation.

Exact targeted GREEN command and output:

```text
node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern="deferred summary" tests/compaction-service.test.ts

✔ preserves ordered audit markers and messages added during a deferred summary without duplicates or moving the cut
✔ does not rewrite a record upgraded to a future version during a deferred summary
tests 2; suites 1; pass 2; fail 0; cancelled 0; skipped 0; exit 0
```

Exact affected GREEN command and output:

```text
node --import tsx --import ./tests/bootstrap.mjs --test tests/compaction-service.test.ts tests/compaction.test.ts tests/session-controls.test.ts

tests 55; suites 9; pass 55; fail 0; cancelled 0; skipped 0; exit 0
```

Both GREEN runs retain expected diagnostics for the future-version refusal and caught `Chat not found` error. The affected run also includes the existing intentional summarizer `boom` failure/retry test, which passed. Focused tests used the established approved unsandboxed Node/tsx workaround.

```text
npm.cmd run typecheck
> learnharness@0.3.4 typecheck
> tsc --noEmit
exit 0

git diff --check
exit 0
```

The diff check reported only the existing CRLF-to-LF normalization notice for `src/server/compaction.ts`. A final diff check followed the documentation update. No full suite, build, lint, commit, or subagent dispatch occurred. No blocking concerns remain for this fix.
