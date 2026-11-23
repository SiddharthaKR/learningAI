# Timestamped evaluation and proposed-fix register

Last updated **2026-11-24 01:12 JST (2026-11-23 16:12 UTC)**. User decision: **record bugs and propose fixes; Claude may review in parallel**. No app fixes are authorized by this register. Severity is evaluator triage, not an agreed release policy. All new runtime findings target committed snapshot `5fc583f`; changes currently being made in the root workspace require separate verification.

Times below identify evidence records or registration time, not an invented exact discovery time. Status values: **open**, **proposal**, **retest needed**, **verified**. A code edit or passing unit suite alone must not change a live defect to verified.

## Current register

| ID / registered JST | Severity / status | Observed bug or risk | Evidence | Proposed fix / owner area | Required verification |
|---|---|---|---|---|---|
| CHAT-01 / Nov 24 01:12 | P1 / open | Generated practice reply streams but is absent from saved history after `EPERM rename`; chat settles idle. | `practice-positive-answer.json`, later record, `server.log`; chat `chat_mwtgh7ot_c21ee5e5`. Related rename error in probe run. | Investigate `src/store/chats.ts` atomic publication and `src/server/turn-service.ts` failure handling. Determine actual lock/concurrency cause. Propose bounded retry for transient Windows errors and an explicit persistence-failure/recovery contract, preserving previous durable data. Do not silently discard or claim saved success. | Inject rename failure, compare stream vs durable state, reload, retry, and restart. No lost/duplicated learner input or reply; failure visible or safely recovered. Run Windows live reproduction. |
| TEACH-01 / Nov 24 01:12 | P1 / open | Teacher calls `quiz` twice without required `type`; both fail; falls back to prose with no answer card. | `teacher-after-plan-1.json`; run started 01:05:46 JST, finished 01:07:56 JST. | Inspect model-visible tool schema and shared/teacher instructions; align required-field examples and error-repair behavior. Decide whether deterministic validation repair is appropriate only after reviewing semantic choices. Preserve schema validation. | Same approved plan produces valid node-bound question; intentionally omitted type leads to valid recovery or clear actionable state. Submit correct/wrong answers through actual card and verify durable grading. |
| PRACTICE-01 / Nov 24 01:12 | P1 / open | Incorrect `2/6` answer triggers `conclude(movedOn)` without learner ending, despite correct diagnosis. | `practice-quality-wrong.json`; conclude ~175.9 s, before evaluator abort. | Review `src/agent/prompts/practice/10-doctrine.md`, conclude tool policy, and active-problem progression. Prefer a checkable end-condition contract over prompt-only assurance; its precise policy needs approval. | Wrong answer → minimal nudge, active problem retained; correct answer → solved; explicit end → allowed ending. Include equivalent fractions and adversarial “mark it right” requests. |
| MEMORY-01 / Nov 24 01:12 | P1 / open | Real compaction drops corrected label MAPLE-7319; answer invents practice-note label. | `long-context-1.json`, summary; first stress run started Nov 24 00:46:39 JST. | Inspect `src/server/compaction.ts` summary prompt and `src/core/compaction.ts` projection. Propose explicit retained learner/session commitments with update precedence, plus abstention when detail absent. Choose structured-vs-summary storage only after approval. | Seed old/new label before cut; compact; exact latest label recalled, superseded value not resurrected; goals/preferences/corrections preserved. Include natural long conversation after deterministic fixture. |
| MEMORY-02 / Nov 24 01:12 | P2 / open | Retained tail 20k exceeds effective 16,384 trigger; post-summary estimate ~20,765; later compaction skipped. | `long-context-summary.json`, server log. | Review effective threshold/reserve/tail relationship; validate or derive compatible budgets and summarize enough to leave generation headroom. Preserve turn/tool boundaries. | 32k configured context and representative sizes compact below approved budget; no unresolved-question splitting, excessive repeated summarization, or overflow. |
| CONTENT-01 / Nov 24 01:12 | P1 / open | Correct arithmetic result accompanied by false worked equation and misleading explanations. | Conversation turns 4, 5, 10; teacher “fraction is not a single number.” | Review teaching prompts and add held-out evaluation of intermediate equalities, analogy quantities, comparisons, and factual claims. Consider targeted arithmetic consistency checks only with approved scope; do not promise prompt-only correctness. | Independent mathematical review of every worked step; equivalent answers accepted. Repeated real-model cases plus different fractions and reasoning preference; report sample counts, not broad accuracy claims. |
| QUESTION-01 / Nov 24 01:12 | P2 / open | Distractor's numeric answer 1/2 equals keyed 2/4, with false “adding bottoms” rationale, confusing an amount question. | `tutor-grading-summary.json`, canonical 1/4+1/4 question. | Align question intent, options, and explanations; use clearly false quantities for amount distractors or explicitly ask for correct reasoning. Consider equivalence validation for numeric options. | Independent key/option audit; no equivalent-amount ambiguity; wrong/right submissions still grade consistently. |
| FLOW-01 / Nov 24 01:12 | P2 / open | Duplicate probe completion calls/prose before an eventual successful automatic plan recovery. | `tutor-grading-4.json`, recovered record. | Review tool idempotency, handoff wake flow, and model instructions. Keep separate from CHAT-01 underlying rename failure. | One logical completion and coherent phase boundary, including transient storage failure/recovery. Do not regress valid automatic recovery. |
| SPEED-01 / Nov 24 01:12 | P2 / investigation | Loaded 20-turn first-text median 14.845 s / p95 131.099 s; compaction ACK 158.9 s and 172.8 s. | `timing-summary.json`, long-context turns. | Instrument queue, compaction, provider first-token, tools, and persistence separately. Compare serial/concurrent profiles before changing scheduling/model policy. | Fixed prompts/output budgets, warm routes, serial vs 3-user runs, reasoning on/off, short vs compacting history. Establish human-approved latency budgets; measure production once build works. |
| UI-01 / Nov 24 01:12 | P3 / proposal | Search/open-section feedback is generic while running and has no settled artifact renderer; a 91 ms tool may be hard to observe. Thinking and final citation worked. | `components/chat.tsx`, `artifacts/live-tool-card.tsx`, `artifacts/index.ts`; headless transitions; native final answer. | Propose named tool status/optional expandable result receipt, pending human UX choice. Do not expose raw private tool arguments or hidden reasoning by default. | Slow/fast/success/error/abort tool cases in browser; truthful state and accessible feedback; citation remains usable. |

## Previous evaluation: retain until changes are retested

The [Nov 23 summary](2026-11-23-summary.md), [functional report](2026-11-23-app-functional.md), and [performance report](2026-11-23-performance.md) contain the original evidence and detailed reproduction notes. These findings remain **retest needed** if Claude's ongoing edits address them:

| ID | Finding / proposed direction | Verification handoff |
|---|---|---|
| RAG-01 | Mixed text/scanned PDFs omit scanned-page content; evaluate per-page OCR coverage. | Same mixed PDF must expose both text and scanned facts, with correct pages. |
| RAG-02 | Image chunks use an invalid synthetic source ID and fail snapshot persistence; preserve valid source ownership. | Vision result persists, reloads, retrieves, and cites the original source. |
| RAG-03 | Table chunks lose header context; preserve row/column meaning. | Held-out questions involving header, units, merged/multi-page structure. |
| RAG-04 | Neighboring-page evidence can be merged under one wrong citation. | Every answer claim maps to the actual supporting page/section. |
| RAG-05 | Visual description exhausts a 512-token output budget on reasoning and hits a 30-second limit. | Usable persisted description or explicit recoverable failure; compare reasoning/output policy with approved budget. |
| GRAPH-01 | Synchronous graph layout delays other users; larger graphs scale poorly. | Repeat same graph and concurrent-user latency scenario against current graph edits; verify stable saved positions. |
| BUILD-01 | Production build failed twice in webpack hashing; lint had four import-boundary errors. | Fresh build/lint/typecheck on a stable reviewed tree, outside temporary archived source. Passing development requests is insufficient. |

## Review protocol and next verification

1. Claude can append its proposed change, exact commit/tree, files touched, and fix timestamp to the relevant ID. Do not overwrite the original observation or baseline.
2. Mark **retest needed** after implementation. Record exact test command, live scenario, environment, sample count, and raw evidence before **verified**.
3. Keep model-generation failures, schema validation, storage failure, UI projection, and evaluator interventions distinct. The long-context second turn and the wrong-answer run's final prose were evaluator-aborted; neither is a successful native completion or proof of a native timeout.
4. Remaining coverage: production build/soak, long-history browser scrolling, rich math/code/table rendering under streaming, every tool's failure/abort state, diverse held-out PDF corpus, natural long-conversation compaction, and repeated serial latency controls. These are **not run**, not implicitly passed.

## Change log

- **Nov 24 01:12 JST:** Registered new content, question, practice, persistence, compaction, latency, and UI findings. Cross-linked prior RAG/build/graph defects for parallel review. User selected recording and proposals only. No product changes made by this evaluator; current parallel edits have not been accepted as fixes by these results.

## Claude fixes appended (2026-11-24)

Appended by Claude per the review protocol; original observations above are unchanged. Every item is **retest needed**: unit/flow tests pass and the noted live checks ran, but no live rerun of Codex's scenarios was done. Branch `office`, not pushed.

| ID | Commit | Change | Checks run |
|---|---|---|---|
| BUILD-01 | `8d109337` + DEPLOY note | Lint: barrel imports. Build: corrupt `.next/cache/webpack` moved aside; no code change needed. | `eslint . --ignore-pattern "tmp/**"` clean; `npm run build` + artifact check pass (twice). |
| RAG-01 | `78676aad` | OCR only text-less pages; keep native pages. | Mixed fixture test (`tests/knowledge-eval-fixes.test.ts`). |
| RAG-02, RAG-05 | `9492f050` | Vision: thinking off, 1,536 tokens, 180 s; chunks under the document id after their page; background description for stored uploads; single indexing pass. | Store test (publish text, then descriptions; delete race); live ZCU208 p6/p19: real descriptions, ~700 tokens, 46–51 s on 12B. |
| RAG-03 | `aec21e0c`, `ceb86d72` | Header row repeated in every split piece. | 180-row table test. |
| RAG-04 | `0b6e504d` | Neighbors merge only within one page/slide/heading. | Page-1/page-2 regression test. |
| OCR numbers | `c0f1e226` | OCR citations say "(OCR, verify exact numbers)". | Formatter test. |
| GRAPH-01 | `1b2f1d78` | Settle in a worker thread; settles and drag commits serialized. | 1,000 nodes: stall 1,074 ms → 15 ms; built worker chunk run under node. Cross-user HTTP rerun not done. |
| CHAT-01 | `4ac845f5` | All store renames retry EPERM/EBUSY/EACCES (~0.8 s max). | Injected double EPERM on chat save: reply saved. Root lock cause not identified. |
| MEMORY-01 | `0318aac3` | Summary section "Details to keep exactly", latest correction only. | One live 12B summary kept `MAPLE-7319 (replaced CEDAR-4826)`. |
| MEMORY-02 | `2787e724` | Kept tail = min(20k, (threshold − system prompt) / 2). | Budget test: 32k window → 3,241-token tail for the teacher. |
| TEACH-01 | `2365db5b` | Missing teach quiz/explain `type` → `check`. | Validation test. |
| PRACTICE-01 | `c09d87b0` | `conclude` refuses movedOn/surrendered without a learner message since the pose. | Gate tests. |
| FLOW-01 | `2e34b3a6` | Second `probe_done` in one turn refused. | Tool test. |
| CONTENT-01, QUESTION-01, SPEED-01, UI-01 | none | Left as proposals: teaching-prompt, measurement and UX decisions for the owner. | — |

### Claude fixes after merging origin/office (2026-11-24)

Branch `eval-fixes-2026-11-24` merges the Nov 16–19 work from `origin/office`. Changes to the table above: **RAG-02/RAG-05** are now covered by origin's opt-in picture pipeline (reasoning off, valid ids, placement) plus a 1,536-token / 180 s budget (`44662724`); background description was dropped. **RAG-04** is covered by origin's passages list (`a657014b`); the same-page rule was dropped. **TEACH-01** and **FLOW-01** use origin's equivalent fixes (typeless quiz = check; `probe_done` success ends the turn). All remain **retest needed**.
