# PDF RAG and Application Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, or superpowers:subagent-driven-development if the human explicitly selects delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve PDF table/image answers and evaluate the application's functional correctness, responsiveness, reliability, and performance bottlenecks with reproducible evidence.

**Architecture:** Begin with separate extraction, retrieval, answer, browser, and server measurements. The proposed first implementation reuses the existing TypeScript knowledge pipeline; a separate parser, hybrid retrieval, and larger performance changes remain gated decisions. Keep evaluation infrastructure and product changes independently reviewable.

**Tech Stack:** Existing TypeScript/Node.js, Next.js, PDF.js, Tesseract, configured vision endpoint, filesystem snapshots, Node test runner/tsx, and browser performance tooling. New dependencies are proposals requiring approval.

**Spec:** `docs/superpowers/specs/2026-11-23-rag-and-app-evaluation-design.md`.

## Global Constraints

- Status: the user authorized evaluation with "evaluate" on 2026-11-23. Product implementation and unresolved design choices still require approval; this document does not approve them by itself.
- Read both the design and this plan. Preserve unresolved decisions; do not infer approval from a recommendation.
- Follow `AGENTS.md`: investigate and plan, get the plan approved, then implement. Read applicable installed Next.js guides before changing Next.js code.
- Preserve user/shared ownership, authorization, audit records, accepted formats, and recoverable persisted data.
- Record current branch/commit, corpus hashes, host/browser/runtime versions, model IDs, relevant non-secret configuration, and sample counts for each evaluation.
- Run destructive, account, upload/delete, restart, and concurrency exercises against a dedicated test instance and synthetic users/data. Do not mutate live user content.
- Separate mock-provider regression tests from real-provider quality and deployed-host acceptance. Unavailable provider/host checks remain explicitly unverified.
- Record baseline first; no historical test count is a current pass claim. No fixes without a reproduced failure or measured bottleneck and approved bounded implementation.
- Keep raw evaluation artifacts under `tmp/evaluation/`; maintain a human-readable summary under `docs/evaluations/`. Do not include credentials, private conversations, or user files in committed reports.

## Review Focus

1. Mixed/scanned pages and vector diagrams remain discoverable even when other pages have native text: tasks 2 and 3.
2. Merged headers, continuation tables, units, and footnotes cannot silently change numeric meaning: tasks 2 and 4.
3. Vision chunks survive snapshot validation, reload, retrieval, and deletion under the correct document/owner: task 3.
4. Reconnects, retries, aborts, compaction, and restarts preserve actions without duplication or stuck loading states: tasks 6 and 7.
5. Concurrent uploads/background work do not starve chat, mix users, or hide stale caches and memory growth: tasks 7 and 8.

## Evaluation execution record - 2026-11-23

See [evaluation report](../../evaluations/2026-11-23-summary.md) for current evidence and limits.

- Baseline executed: 2,151 automated tests pass; typecheck passes; lint fails with four import-boundary errors; production build fails twice in webpack hashing. Model chat/tool smoke passes with an unverified advertised context limit.
- RAG exploratory evaluation executed: 18 retrieval questions, five anchor facts in a combined live answer, one Japanese live answer, four live abstention cases, and controlled mixed-OCR/vision-persistence/citation/table-chunk diagnostics. The proposed 30-case held-out corpus remains incomplete.
- Functional evaluation executed: 40 corrected isolated HTTP assertions and seven live recovery/practice assertions pass. Initial evaluator contract mistakes were documented and excluded.
- Performance evaluation executed: prepared retrieval, chat persistence/listing, graph layout, cross-user graph blocking, ingestion/provider observations. Real graph layout delayed another user's requests; the full-page description exhausted its output budget on reasoning.
- Not verified: browser rendering/smoothness (tool access unavailable and unrelated-window inspection rejected), production-mode performance/soak (build failed), deployed-host behavior, restart-under-load, live long-session compaction, complete extraction/background-agent coverage, and multi-process behavior.
- No application fixes, parser selection, schema/model-policy changes, rollout, or reindexing were performed. Fix proposals and reproduction evidence are prioritized in the report.

## Content, long-conversation, and feedback follow-up (2026-11-24)

The user clarified that smoothness includes content truth, alignment, right/wrong answers, retained context in long conversations, response latency, and visible thinking/tool-call state. The user selected **record bugs and propose fixes**, with Claude reviewing in parallel. No implementation approval is inferred.

- [x] Run a 20-turn conversation and audit worked explanations, equivalent answers, correction handling, preferences, and updated-detail recall.
- [x] Submit wrong/correct probe answers, inspect independent keys/distractors, follow automatic handoff, approve the recovered plan, and attempt the first teaching card.
- [x] Run wrong/correct practice controls and compare streamed replies with saved records.
- [x] Trigger real compaction using a seeded 160-message stress fixture; distinguish this from naturally generated long conversation.
- [x] Measure acknowledgement, first thinking/text, tool transitions, completion, and wire-to-client projection with concurrency/dev caveats.
- [x] After dedicated-window login, observe native-browser thinking, expansion, final answer, knowledge control, and cited retrieval. This supersedes the earlier browser-access block for these sampled scenarios only.
- [x] Preserve evidence and a timestamped bug/proposed-fix register for parallel review: [evaluation](../../evaluations/2026-11-24-content-and-long-conversation.md), [register](../../evaluations/2026-11-24-bug-register.md).
- [ ] Retest the live failures against an identified reviewed fix tree; ongoing root RAG/graph edits were not covered by the archived runtime.
- [ ] Complete natural long-conversation compaction, serial latency controls, production-mode coverage, long-history browser rendering, and the remaining held-out RAG corpus.

## Approval gates

- [ ] Select existing TypeScript pipeline versus separate parser-service evaluation. Recommendation: existing pipeline first; no service adoption without a benchmark comparison.
- [ ] Approve corpus composition and correctness targets in the design; establish performance budgets after the baseline.
- [ ] Before RAG implementation, approve vision endpoint/fallback policy, synchronous versus background indexing and status/cancellation UX, page-rendering limits, and evidence/citation data shape.
- [ ] Before hybrid search, approve embedding/reranking provider, data flow, dependencies, and measured benefit.
- [ ] Approve any bottleneck fix that changes behavior, data formats, concurrency, persistence, or UI. Append a concrete implementation task with exact interfaces and regression assertions before editing product code.

Unresolved choices block their dependent implementation only. The evaluation design and inventory can be reviewed independently. This is a master plan, not a claim that architecture-dependent implementation is already specified mechanically.

## Task 1: Reproducible baseline and evaluation inventory

**Files:** Read `package.json`, `docs/office-v1-progress.md`, `scripts/smoke-llm.mjs`, existing tests, and the files mapped below. Create `docs/evaluations/2026-11-23-baseline.md` during approved execution.

**Output:** An inventory of workflows, test coverage, environment constraints, baseline check results, and available test/provider hosts.

- [ ] Record source commit, dirty-tree status, runtime/browser versions, test-instance URL, model IDs, and corpus SHA-256; identify unavailable host dependencies without exposing secrets.
- [x] Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build` separately. Capture exit status, failure counts, elapsed time, and artifact-scanner output; investigate failures before changing expectations. Results are recorded; build failure prevented the artifact-scanner stage.
- [x] Run `npm.cmd run smoke:llm` only against the selected test provider. Record chat/tool-call compatibility separately from application-level correctness.
- [ ] Reconcile historical local pass claims and pending host acceptance in `docs/office-v1-progress.md`; add dated evidence rather than rewriting history as if it were newly verified.
- [ ] Produce a coverage table marking automated regression, mocked integration, real-provider, browser, and deployment checks separately.

## Task 2: Gold PDF benchmark and scoring

**Files:** Create `tests/fixtures/knowledge/rag-gold.json`, `scripts/evaluate-rag.ts`, and `tests/rag-evaluation.test.ts`; extend `tests/fixtures/knowledge/builders.ts` only where needed. Read `tmp/pdfs/baseline-rag.mjs` as exploratory evidence, not as the final evaluator.

**Proposed evaluator contract:** `scripts/evaluate-rag.ts --cases <json> --out <json> --mode extraction|retrieval|answers`. Case records contain a stable ID, source hash, question/language/category, gold page(s), gold evidence, accepted answer, critical-value flag, and development/held-out assignment. Approve the final schema before implementation.

- [ ] Create and visually verify the proposed 30-case corpus from the design. Preserve the five known anchor questions and inspect additional pages before assigning gold answers.
- [ ] Add small deterministic fixtures for mixed pages, blank pages, merged cells, repeated headers, continuation tables, vector-only diagrams, and misleading neighboring values. Inspect generated fixture renders.
- [ ] Add scorer tests: a wrong value with a correct citation fails; a correct value with the wrong citation fails; missing footnote interpretation fails; an unanswerable case answered confidently fails. Assert category totals and exclusions explicitly.
- [ ] Run `node --import tsx --import ./tests/bootstrap.mjs --test tests/rag-evaluation.test.ts` before and after implementing the evaluator; failures must establish real scorer behavior.
- [ ] Record extraction fidelity, raw recall@1/3/8, final context evidence coverage, answer exactness/semantic correctness, citation accuracy, abstention, latency, and tokens separately. Treat multiple valid evidence pages as sets.
- [ ] Run actual answers through the application's knowledge-tool and tutor path on isolated test chats; score against the original page, not a generated description or a mock response. Repeat live quality runs and report variability.
- [ ] Publish raw case outcomes and per-category denominators. Hold out designated cases before tuning; do not evaluate a one-document result as universal PDF support.

## Task 3: Repair ingestion and evaluate complete visual evidence

**Files:** `src/knowledge/parsers/pdf.ts`, `pdf-ocr.ts`, `pdf-images.ts`, `src/knowledge/extract.ts`, `service.ts`, `vision-job.ts`, `contracts.ts`, `index-store.ts`, `src/store/knowledge.ts`, `app/api/knowledge/documents/route.ts`, `scripts/index-shared.ts`, `src/core/office-config.ts`. Tests: `tests/pdf-ocr.test.ts`, `tests/knowledge-image-understanding.test.ts`, `tests/knowledge-index.test.ts`, `tests/knowledge-api.test.ts`, `tests/knowledge-shared-api.test.ts`.

**Gate:** Approve configuration precedence, rendering resource limits, page selection, indexing execution/status/cancellation behavior, and schema changes before defining implementation signatures.

- [ ] Reproduce mixed-PDF OCR omission, disabled vision in each real indexing entry point, and image `sourceId` rejection using focused tests. A passing function-export test is insufficient.
- [ ] Specify exact configuration plumbing and per-page OCR selection; preserve existing native text and avoid duplicated content. Blank/failed OCR pages must have honest outcomes.
- [ ] Evaluate complete-page rendering for vector diagrams and image layouts; compare it with embedded-image extraction on the same pages. Test resolution, small labels, size limits, timeouts, cleanup, and model truncation before choosing settings.
- [ ] Implement the approved ingestion changes with failing regression tests first. Give text and visual chunks valid document identity, collision-free chunk IDs, stable reading order/sections, and honest ready/partial/failure behavior.
- [ ] Verify index -> validate snapshot -> write -> reload -> search -> open section -> delete. Confirm image chunks disappear with their document and cannot appear for another user.
- [ ] Evaluate unavailable vision, malformed model responses, slow OCR, aborted jobs, scanned-only visual content, and partial-page failures. Check that successful text is retained when a visual step fails.
- [ ] Run the relevant focused tests plus typecheck and the gold extraction/answer categories. Record provider cost and time separately. Commit only the approved, verified implementation slice.

## Task 4: Table preservation and passage-level citations

**Files:** `src/knowledge/parsers/pdf.ts`, `src/agent/subagents/pdf-ops.ts`, `src/knowledge/contracts.ts`, `chunk.ts`, `search.ts`, `open-section.ts`, `index-store.ts`; knowledge tool/prompt and citation UI consumers discovered through references. Tests: `tests/knowledge-structure.test.ts`, `knowledge-retrieval.test.ts`, `knowledge-search.test.ts`, `knowledge-open-section.test.ts`, `knowledge-tool.test.ts`.

**Gate:** Approve parser choice and the structured-table/evidence representation before implementation; include schema validation, migration/reindexing, and all consumers in the concrete task.

- [ ] Inspect gold table layouts, then compare candidate extraction results for row/column alignment, multi-line and merged headers, units, notes, and continuation pages. Report omissions rather than filling guessed cells.
- [ ] Specify table chunking that preserves complete row meaning, repeats the applicable headers/units/notes, and handles an oversized row without silently losing its column labels.
- [ ] Add regressions for a correct answer located in a neighboring page, multi-page evidence, repeated row labels, table continuation, and switch-bit order/polarity. Preserve the exact source citation for every evidence passage.
- [ ] Implement approved extraction/chunking/citation changes after the regressions fail. Include serialization, reload, open-section output, tool output, and rendered citations in the verification path.
- [ ] Run focused tests and gold table/citation cases. Check ordinary text, DOCX/PPTX tables, and old valid snapshots according to the approved compatibility policy. Commit the verified slice.

## Task 5: Retrieval and answer quality, with conditional hybrid search

**Files:** `src/knowledge/bm25.ts`, `tokenize.ts`, `search.ts`, `retriever.ts`, `cache.ts`, `src/server/chat-handler.ts`, and the knowledge tool/prompt implementation. Tests: `tests/knowledge-retrieval.test.ts`, `knowledge-search.test.ts`, `knowledge-prompt-gate.test.ts`, `knowledge-tool.test.ts`.

- [ ] Compare baseline versus extraction-correct chunks before attributing answer failures to ranking. Classify failure as absent evidence, ranking miss, context loss, incorrect interpretation, or incorrect citation.
- [ ] Measure paraphrases, Japanese/English variants, acronyms, exact part numbers, table rows, and visually described relations. Inspect top hits and final expanded tool context separately.
- [ ] Verify the actual tutor/tool flow grounds numeric claims and acknowledges missing evidence. Include knowledge OFF/ON, personal/shared scope, mid-session changes, and contradictory evidence.
- [ ] If retrieval still fails approved targets, write an explicit hybrid-search proposal using the existing ranker/RRF boundary. Account for the current synchronous `Ranker.rank` interface: remote query embedding requires a deliberate async orchestration/interface change, not a drop-in synchronous call.
- [ ] For an approved hybrid experiment, compare BM25, hybrid, and reranked results on held-out cases; measure query latency, indexing cost, cache/model invalidation, provider failure fallback, and owner filtering before ranking.
- [ ] Adopt the additional ranker only if it meets approved quality/latency targets. Otherwise retain the simpler measured solution and document the outcome.

## Task 6: Whole-application functional and browser evaluation

**Output:** `docs/evaluations/2026-11-23-app-functional.md`, with scenario IDs, preconditions, steps, expected/observed results, evidence, and repeatable defects. Add targeted regression tests only for confirmed defects during approved fix work.

| Workflow | Required scenarios | Existing anchors |
|---|---|---|
| Accounts and ownership | Login/logout, failed/expired session, two users in separate browser contexts, unauthorized document/chat/job/events access | `tests/office-auth-*.test.ts`, `office-chat-isolation.test.ts`, `office-events-ownership.test.ts` |
| New and returning chats | Create, send, stream, follow-up, reload, reopen, long history, failed-turn retry, abort then send again | `components/chat.tsx`, `src/server/chat-handler.ts`, `tests/chat-flow.test.ts`, `retry-failed-turn.test.ts`, `turn-liveness.test.ts` |
| Knowledge | Upload personal/shared/chat-only, duplicate upload, invalid/large input, list/delete, correct scope, map/open-section, citations, no-text and partial failures | `components/knowledge-page.tsx`, `knowledge-map.tsx`, `tests/knowledge-*.test.ts` |
| Tutoring and plan tools | Prober/teacher handoff, valid plan tool calls, prose-only retry, questions and answers, settings applied on the intended turn | `tests/probe-done.test.ts`, `question-retry-flow.test.ts`, `plan-retry.test.ts` |
| Practice | Generate set, answer, grade, explanation, revisit saved progress, provider failure recovery | `tests/practice-flow.test.ts`, `practice-agents.test.ts`, `practice-record.test.ts` |
| Graph | Extract, show correct propositions/chains, pan/zoom/filter, reload positions, empty/large graph, provenance | `components/graph-view.tsx`, `graph-canvas.ts`, `tests/graph*.test.ts` |
| Background work | Queue/start/finish/fail/abort, correct owner, result delivery once, UI reflects state after navigation | `src/server/jobs.ts`, `tests/jobs.test.ts`, `office-background-ownership.test.ts` |
| Languages and preferences | English/Japanese UI, separate teaching language, reasoning preference, retained settings, long labels and narrow viewport | `tests/office-language-preferences.test.ts`, `office-reasoning-preference.test.ts` |
| Web research and exports | Web disabled/enabled, approval ownership, unavailable provider, provenance, markdown export, `/source` artifact | `tests/office-web-provenance.test.ts`, `office-approval-ownership.test.ts`, relevant API routes |

- [ ] Run each scenario on a production-mode test build, with fresh and existing synthetic accounts. Capture console errors, failed requests, visible state, and persisted state; screenshot only synthetic data.
- [ ] Exercise keyboard navigation, focus after dialogs/errors, loading/error/empty states, scrolling during streaming, narrow layouts, and citation links. Record usability defects without inventing a redesign.
- [ ] Exercise long responses with math, code, tables, and Mermaid. Confirm UI remains interactive while chunks stream and retains learner position when reading older content.
- [ ] Record passed, failed, blocked, and not-run states separately. Link each failure to a minimal reproducible case and the owning module/test.

## Task 7: Reliability, concurrency, and recovery

**Files to inspect:** `src/server/turn-runs.ts`, `turn-liveness.ts`, `jobs.ts`, `events-stream.ts`, `pi/ui-stream.ts`, `compaction.ts`, `src/store/chats.ts`, `jobs.ts`, `graph.ts`, `knowledge.ts`; `components/server-events.tsx`. Existing tests include `turn-liveness`, `server-events`, `compaction-service`, `office-background-ownership`, and `chat-store-events`.

- [ ] Start with one user, then exercise three isolated users concurrently as already contemplated by the pilot acceptance checklist. Test chat + upload + practice/background work together; larger loads require an agreed host/load budget.
- [ ] Measure queue wait and fairness separately from provider execution. Verify the existing concurrency cap, slot release after exceptions/abort, and progress for other users.
- [ ] Drop and reconnect an SSE connection, navigate away/back, open two tabs for one chat, retry a failed turn, and abort during tool work. Assert exactly one persisted user action/result where the contract requires it, correct owner, and no indefinitely busy state.
- [ ] Force compaction with a synthetic long session; verify session intent, knowledge scope, citations, and next-turn continuity survive. Test timeout/tool-format error paths against controlled provider responses.
- [ ] Restart only the disposable test server during indexing/background work and after acknowledged chat writes. Reopen persisted data and verify truthful recovery, no corrupted snapshot, and no duplicate delivery.
- [ ] Repeat uploads/deletions and cache invalidation while searching; verify no lost update, resurrected deleted document, cross-user result, or corrupted publication. Assess process-local queues if deployment uses more than one worker.

## Task 8: Smoothness and bottleneck profiling

**Output:** `docs/evaluations/2026-11-23-performance.md` plus raw measurements under `tmp/evaluation/`. Proposed sizes: 1/10/100 copies of synthetic documents, 20/200/1000-message synthetic chats, and 100/1000/5000-node synthetic graphs. These are test points, not promised capacity or production limits; validate resource feasibility first.

- [ ] Record a production-build baseline on the intended machine, cold and warm. Use at least 30 successful samples per ordinary timed scenario; for expensive live-model runs report the actual smaller count and avoid treating its p95 as stable.
- [ ] Measure navigation/load, send-to-visible-acknowledgment, server admission/queue time, provider time-to-first-token, first visible token, stream cadence, end-to-end completion, retrieval, upload/indexing, graph load/pan, and practice latency separately.
- [ ] Capture browser long tasks, interaction delay, dropped frames during streaming/graph use, request waterfalls and payload sizes. Distinguish JavaScript/layout/rendering work from network/model delay.
- [ ] Capture CPU profiles, process RSS/heap, event-loop delay/utilization, disk I/O, provider calls/tokens, queue length, and cache read/preparation counts. Repeat with chat alone versus concurrent OCR/indexing/jobs.
- [ ] Investigate the static candidates below; establish actual time/memory attribution before proposing a fix.
- [ ] Run a 30-minute bounded soak with repeated navigation, streaming, upload/delete, and graph/practice activity. Check for rising memory, accumulated listeners/timers, orphaned workers, stale caches, and stalled jobs.
- [ ] Agree concrete UX/service budgets from the baseline and intended deployment. Compare candidate improvements on the same host/data/configuration and report both absolute numbers and percentage change.

| Candidate, not yet a measured bottleneck | Evidence to collect | Possible follow-up only after approval |
|---|---|---|
| Duplicate extraction for explicit personal/shared upload destinations | Route first calls indexing, then store upload indexes again; count parser/OCR/vision invocations and elapsed time | Reuse one validated extraction result through an approved store boundary |
| Full upload buffering and multiple byte copies | Peak RSS versus file size at multipart buffering/decoding/arrayBuffer boundaries; current file limit is 100 MiB despite an outdated route comment | Reduce copies/stream through approved validation |
| Repeated PDF parsing/rendering and sequential vision calls | Per-stage parse/render/OCR/vision counts and time; chart/vector coverage | Share document work and apply bounded scheduling |
| Synchronous chat/job/graph persistence | CPU/event-loop/disk profiles as histories/ledgers grow | Reduce repeated serialization/I/O or change persistence only with migration approval |
| Whole-snapshot validation, serialization, cache growth, and vault rebuilds | Upload/delete time versus corpus size, warm/cold reads, cache hit/miss/preparation counts, heap | Incremental work or cache bounds with tested invalidation |
| Stream and transcript rendering | React/browser profiles, render count, long tasks with long history and rich output | Target the measured render path; preserve stream ordering and scrolling |
| Graph layout and canvas work | Main-thread profile across proposed graph sizes | Target layout/drawing work without changing graph semantics |
| Provider saturation and retry loops | Admission wait versus inference time, call count, retries, context size, abort release | Adjust model-call/scheduling policy only after approval |

## Task 9: Prioritized fixes, controlled reindexing, and final acceptance

- [ ] Produce a backlog ordered by lost/corrupted data or isolation failures, incorrect answers/core workflow failures, then measured responsiveness/resource problems. Each item includes evidence, reproduction, affected users, root cause, fix proposal, regression assertion, effort, and residual risk.
- [ ] Ask for approval of concrete fix tasks and any remaining design decisions. Implement each accepted task with a reproducing regression first, focused checks after the change, and a separately reviewable commit.
- [ ] Before reindexing, specify extraction/model revision tracking, retained source availability, backup/rollback, deleted/missing files, idempotency, and atomic replacement. Evaluate all personal/shared/admin entry points and preview changed document/chunk counts on copies.
- [ ] Re-run the same held-out RAG cases, affected functional flows, concurrent-user exercise, and measured bottleneck scenario after fixes. Preserve baseline and final results side by side.
- [ ] Run final `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`; verify artifact scanning. Run real-provider and intended-host acceptance separately where available.
- [ ] Create `docs/evaluations/2026-11-23-summary.md` with exact commands/environment, case counts, accuracy and latency/resource deltas, defects fixed/open, and remaining unavailable checks. Update `docs/office-v1-progress.md` with dated evidence.
- [ ] Obtain rollout/reindex approval for the concrete reviewed result. A green automated suite alone does not establish smooth UI, PDF answer accuracy, or host readiness.

## Plan self-review

- [x] Includes all six originally proposed RAG stages and the expanded application evaluation scope.
- [x] Separates static findings, measured retrieval observations, quality targets, and unperformed live evaluation.
- [x] Maps the five review risks to owning tasks and explicit checks.
- [x] Keeps parser, schema, model, UX, and concurrency decisions gated rather than guessed.
- [x] Includes reproducible results, held-out cases, workflow correctness, UI smoothness, performance attribution, and final acceptance.
- [ ] Human review of implementation choices remains pending. Evaluation was authorized and its executed/blocked portions are recorded above. Architecture-dependent fix signatures must be specified after design decisions and before implementation.
