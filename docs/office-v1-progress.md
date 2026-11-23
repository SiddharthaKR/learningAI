# Office v1 pilot progress

2026-11-24 content/long-conversation follow-up: 20 live turns retained sampled preferences/corrections, but manual review found false explanations; real synthetic-history compaction lost a corrected label; the teacher repeated an invalid quiz call; wrong-answer practice ended prematurely; a Windows rename failure lost a streamed reply from durable history. Thinking and cited-answer UI were observed in the dedicated browser. Under concurrent development load, median first text was 14.845 s and p95 131.099 s; these are not production SLO measurements. Focused existing tests recorded 234 passes. User selected recording and proposed fixes only, for parallel Claude review: [evaluation](evaluations/2026-11-24-content-and-long-conversation.md), [timestamped bug register](evaluations/2026-11-24-bug-register.md). Runtime used commit `5fc583f`; current parallel app edits remain unverified by this run.

2026-11-23 evaluation of commit `5fc583ffc8b1ebcf0d1e0956e9dc485946efc634`: **2,151/2,151 tests pass and typecheck passes, but lint fails with four restricted-import errors and production build fails in webpack hashing (reproduced outside the sandbox).** An isolated development instance passed 40 corrected HTTP workflow assertions and seven recovery/practice assertions. Sampled PDF answers were correct, while targeted diagnostics reproduced mixed-page OCR omission, invalid image-chunk source IDs, lost neighboring-page citations, missing split-table headers, visual-description output-budget exhaustion, and cross-user delay during synchronous graph layout. No product fixes or host acceptance were performed. See [current evaluation and limitations](evaluations/2026-11-23-summary.md). Earlier results below are historical.

Plan: `docs/superpowers/plans/2026-11-02-office-v1-pilot.md`

Last update: 2026-11-07. The implementation is in progress; no host acceptance has been performed.

| Acceptance item | Status | Evidence / next gate |
|---|---|---|
| 1. Deployment | In progress | `npm test` 1,733/1,733, `npm run typecheck`, and `npm run build` pass locally. Build artifact check passes and the former dynamic filesystem tracing warning is gone. systemd and `.126` checks pending. |
| 2. Auth | Locally verified | Account/session/rate-limit tests pass; all API paths are checked by the proxy gate test. `/login`, `/signup`, and `/source` are public. Host acceptance pending. |
| 3. Isolation | In progress | `storesForUser`, checked owner stores, owner-qualified events/turn/extraction/job registries, and approval ownership are in place. Focused graph and scope tests pass (29/29); the new focused auth/store/ownership tests also pass in the full run. Both maintenance scripts now require `--user <username>` and use `storesForUser()`. |
| 4. Teaching and practice | In progress | Practice and prompt parser/stream adapter tests pass. Researcher, visual, and local PDF jobs have passing focused tests. Real LLM smoke and bilingual full session pending. |
| 5. UI languages | Locally verified | Reachable UI copy is catalog-backed in English and Japanese; both catalogs have the same 498 keys. Browser language selects the signup default, `<html lang>` follows the account UI language, and teaching language remains a separate session-fixed value. Encoding, catalog parity, preference/session independence, full-suite, typecheck, and production-build checks pass. Host bilingual acceptance remains pending. |
| 6. Office knowledge | Locally verified | Tasks 1–8 complete. Secure archive/XML primitives, bilingual extraction, BM25 retrieval, isolated indexing, personal uploads, session controls (6A), knowledge tool + agent wiring (6B), controls/audit/citation UI (6C), full gate (7), and image understanding via Gemma 4 vision (8) are implemented. 1,915/1,915 tests pass; typecheck clean; production build + artifact check pass; locale parity 518 keys. Host acceptance pending. Plan: `docs/superpowers/plans/2026-11-04-office-knowledge.md`. |
| 7. Web research | In progress | Researcher background job re-enabled with explicit owner and checked per-user stores. URL-only mode registers `web_fetch` without `web_search`; learner and search-result URL provenance tests pass (3/3). Proxy and approval integration need further verification. Search deferred when provider is `none`. |
| 8. Outbound traffic | Pending | Host observation pending. |
| 9. `/source` | Pending | Archive route and inspection pending. |
| 10. Concurrency | Pending | Three-user host exercise pending. |

Latest local checks (2026-11-07 Task 8 gate): `tsc --noEmit` passes. `npm run build` passes with the post-build artifact check (route-tree-aware scanner). Full `npm test`: **1,915/1,915 tests pass; 0 failures.** Locale parity: 518 keys in both EN and JA catalogs.

2026-11-03 update: line endings were committed alone as `41bdd56` (`normalize line endings (no code changes)`). A later full run counted 1,783 tests: 1,709 passed, 74 failed. After that run, focused researcher/web tests pass (16/16), and owner-scoped import route tests pass (3/3); these changes have not yet been reflected in a new full-suite count. The original A/B/C table below remains the audit of the 87-failure baseline, not a reclassification of the 74-failure run.

Latest gate after the researcher and test migration: **1,732/1,732 tests pass; typecheck passes; production build and artifact check pass without tracing warnings.** The 87-failure baseline remains classified A 48, B 36, C 3. The three C practice failures were fixed in production code. Research, visual, local PDF, import, model catalog, removed-tool registry, and UI expectation tests now pass under the fixed office design. The net test-count reduction includes cloud-provider matrix and removed demo/setup cases; focused fixed-office and URL-provenance tests were added. This green local gate does not establish the ten-item host acceptance checklist.

2026-11-04 UI-language gate: commits through `3287052` localize the reachable interface and keep all user-facing copy in `locales/en.json` and `locales/ja.json`. The catalogs contain the same 498 flattened keys; the UTF-8/mojibake guard and known-Japanese round-trip checks pass. Fresh verification after the final localization slice: **1,733/1,733 tests pass, `npm run typecheck` passes, and `npm run build` passes with the post-build artifact check.** The build scanner found no `data/`, `knowledge/`, `index/`, `indexes/`, or JSONL content under `.next`. `.126` browser acceptance is still required before item 5 is host-complete.

2026-11-04 Office knowledge Task 1 initial gate: the focused test command first failed because the secure primitives did not exist (`ERR_MODULE_NOT_FOUND`), then passed 29/29; the full suite passed 1,762/1,762. Review subsequently found that these tests missed split authority between structural validation and fflate's independent ZIP scans. A forged EOCD/directory inside a comment bypassed declared limits, embedded local headers in unselected stored data were inflated, embedded descriptor signatures truncated selected bytes, and unsigned descriptors were truncated or rejected. The initial test gate did not establish those security claims.

Task 1 review fix round 1 RED: six new regressions failed before changing production code: both 17 MiB selected and 101 MiB total declarations bypassed rejection with forged comment metadata; an embedded selected local header inside unselected stored data triggered an actual-output limit; a selected 80-byte stored payload containing a descriptor signature returned 32 bytes; a valid unsigned stored descriptor returned 23 of 27 bytes; and a valid unsigned DEFLATE descriptor rejected as `ZIP_INVALID`. GREEN: the focused suite passed **35/35** and typecheck passed. A full suite also passed **1,768/1,768** before the per-sub-step cadence changed; subsequent knowledge sub-steps use focused tests plus typecheck, with the next full gate reserved for completion of item 6.

Task 1 review ruling: replace the plan's `unzipSync`/`Unzip` discovery path with a single validated central directory that remains the sole authority for names, declared sizes, compression, offsets, and limits. Extraction reads only exact selected compressed spans. Stored bytes pass through in bounded chunks; raw DEFLATE uses fflate `Inflate` with actual-byte counters and immediate exception-based abort at the first excess. Signed and unsigned descriptors are validated outside those spans; payload signatures and unselected payloads never enter ZIP discovery or decompression. This supersedes the initial implementation's broader claim of selected-only behavior.

Task 1 review fix round 2 RED: four new regressions failed before implementation: raw DEFLATE accepted padding after its final block; the real decoder retained 262,145 bytes of pending input while repeatedly copying padding; corrupted stored output was accepted; and DEFLATE output was accepted despite disagreeing with the central CRC. The fix encapsulates pinned fflate 0.8.3's pending/bit/final-block fields in one helper: retained input cannot exceed 65,541 bytes, each push adds at most 1,024 bytes, and BFINAL must end at the exact selected compressed span with only its last partial byte allowed to remain. A valid literal 65,535-byte stored DEFLATE block tests the bound without rejecting valid input. Incremental CRC32 of every selected output is compared with the authoritative central CRC before its result is returned. GREEN: the focused suite passes **40/40**, typecheck passes, and scoped re-review reports both spec compliance and quality PASS. The full suite and build remain deferred to the item 6 gate.

Task 1 rulings: `KnowledgeArchiveError.code` provides stable ZIP limit/invalid/compression and XML unsafe-declaration/invalid categories alongside readable messages. XML parsing preserves namespace prefixes, attributes, string values, and whitespace with `processEntities: false`, `ignoreAttributes: false`, `parseTagValue: false`, `parseAttributeValue: false`, and `trimValues: false`. The v1 ZIP contract accepts conventional single-disk, unencrypted archives and central-directory-matched data descriptors; ZIP64, multidisk, and encrypted structures reject as invalid/unsupported. These rulings are covered by the focused tests. This primitive gate does not establish format extraction or item 6 host acceptance.

2026-11-05 Office knowledge Task 2 RED: `node_modules/.bin/tsx.cmd --import ./tests/bootstrap.mjs --test tests/knowledge-extraction.test.ts` first failed for the missing extraction module, then all 32 initial behavior tests failed against the explicit unimplemented interface. `tests/pdf-ops.test.ts` failed for the missing `pdfPageTexts` export. The new ordered XML regression failed because the default parser grouped interleaved runs instead of retaining document order. Subsequent regressions caught DOCX heading character references being decoded twice and all three approved Markdown edge cases (empty heading anchoring and backtick/tilde fences) before their fixes.

Task 2 GREEN: `node_modules/.bin/tsx.cmd --import ./tests/bootstrap.mjs --test tests/knowledge-extraction.test.ts tests/pdf-ops.test.ts` passes **42/42** (36 extraction, 6 PDF operations). `node_modules/.bin/tsx.cmd --import ./tests/bootstrap.mjs --test --test-name-pattern='ordered mode' tests/knowledge-archive.test.ts` passes **2/2** new ordered XML checks. `npm.cmd run typecheck` and `git diff --check` pass. Focused tests required execution outside the sandbox because its OS username lookup failed with `uv_os_get_passwd`/`ENOMEM` before tsx could start. The full suite and build were not run; the full **#6 gate remains deferred** until the entire Office Knowledge item is complete.

Task 2 contracts and rulings: extension dispatch accepts only PDF, PPTX, DOCX, MD, and TXT, with a clear Excel/other-format rejection. Real bilingual PDF builders exercise the existing pdfjs path, stable 1-based page boundaries, and a painted no-text PDF (`no_text_layer`, no OCR). PPTX uses one allowlisted extraction pass for slides, slide relationships, and notes; relationships determine which notes enter blocks. Media and embeddings are excluded from extraction; unrelated notes and external targets are excluded from block content. Runs concatenate within paragraphs, paragraphs join with newlines, notes follow a blank line, and the first non-empty slide paragraph supplies the title. DOCX tracks built-in/named heading styles and original body paragraph indexes, including empty paragraphs. Optional ordered XML parsing retains the existing declaration rejection and entity-disabled defaults; standard XML character references decode once at the extracted-text and semantic-attribute boundaries while CDATA remains literal. MD/TXT decode fatal UTF-8, strip BOM, normalize newlines, and trim only boundary blank lines. MD strips ATX markers in block text, preserves original inclusive citation ranges, ignores headings inside backtick/tilde fences, and anchors empty headings without adding empty heading text or metadata. Indexing, BM25, upload/UI, session tools, and research remain outside Task 2.

Task 2 review fix round 1 RED: six new focused regressions failed before changing production code. The cumulative-budget regression supplied 60 MiB of slide XML plus 45 MiB of notes XML, all individually below 16 MiB and with understated original-size headers; two extraction calls accepted it despite exceeding the 100 MiB actual-output document limit. Encoded notes targets lost notes, encoded style names/IDs lost heading citations, and ordinary text decoding incorrectly transformed literal CDATA in PPTX and DOCX. A primitive regression showed ordered parsing did not preserve CDATA provenance. The approved fix selects only `ppt/slides/slideN.xml`, matching slide relationship paths, and `ppt/notesSlides/notesSlideN.xml` in one secure extraction call; relationships subsequently filter notes for block inclusion. Ordered XML parsing marks CDATA separately, extracted text retains that provenance, and semantic attribute references decode exactly once.

Task 2 review fix round 1 GREEN: `node --import tsx --import ./tests/bootstrap.mjs --test tests/knowledge-extraction.test.ts tests/pdf-ops.test.ts` passes **47/47**. `node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern='safe Office XML' tests/knowledge-archive.test.ts` passes **11/11** XML tests. `npm.cmd run typecheck` and `git diff --check` pass. The six review regressions also pass in isolation, and scoped re-review reports spec compliance and quality PASS with no new Critical or Important findings. The full suite/build remain deferred to the **#6 gate**.

2026-11-05 Office knowledge Task 3 RED: `node --import tsx --import ./tests/bootstrap.mjs --test tests/knowledge-retrieval.test.ts` first failed for the missing tokenizer module, then all **27/27** focused behavior tests failed against explicitly unimplemented interfaces. Coverage includes deterministic citation-preserving Unicode chunking and overlap, boundary priority, repeated content at distinct positions, no-text documents, Latin/CJK tokenization, Japanese-only and mixed-language retrieval, independent-query maximum-score deduplication, BM25 score arithmetic, query validation before loading, owner propagation/isolation, deterministic ties, and the eight-result cap.

Task 3 GREEN: the same focused retrieval command passes **27/27**; `npm.cmd run typecheck` and `git diff --check` pass. The focused test requires execution outside the sandbox because tsx's OS username lookup otherwise fails with `uv_os_get_passwd`/`ENOMEM` before loading the tests. Initial typecheck caught token-array fallback inference and a test-fixture union narrowing issue; explicit types resolved both. The full suite/build were not run; the full **#6 gate remains deferred** until the entire Office Knowledge item is complete.

2026-11-05 Office knowledge Task 4 RED: the focused command first failed for missing snapshot/service modules and missing personal-store wiring. After explicit unimplemented interfaces were added, all **9/9** initial knowledge-index behavior tests failed. A subsequent regression failed because document helper paths retained Windows separators instead of normalizing the relative filename before content/path hashing and citation extraction. Another regression caught the output snapshot being indexed when Windows directory-entry casing differed from its configured path. Personal index isolation and checked background access tests also failed before the store was added to the composition root.

Task 4 GREEN: `node --import tsx --import ./tests/bootstrap.mjs --test tests/knowledge-index.test.ts tests/office-user-stores.test.ts tests/office-store-construction-ban.test.ts tests/office-background-ownership.test.ts` passes **23/23**. `npm.cmd run typecheck` and `git diff --check` pass. Typecheck caught the framework's required `NODE_ENV` augmentation of `ProcessEnv`; the CLI accepts a plain environment-variable record so its config-error tests need no unrelated LLM or framework configuration. Focused tests required execution outside the sandbox because tsx otherwise failed with `uv_os_get_passwd`/`ENOMEM`. Existing graph-ownership refusal tests emit expected extraction error logs while passing. No full suite or build was run; the full **#6 gate remains deferred**.

Task 4 contracts: v1 snapshots validate every document/chunk/citation field, normalized relative paths, unique IDs, and source/citation consistency before exposing fresh deeply frozen objects. Missing reads return an empty snapshot without creating storage. Readers open with `r`, close in `finally`, and reopen on each retrieval. Authorized writers validate before writing, use a random same-directory exclusive temporary file with mode `0600`, fsync/close, rename atomically, and clean failed temporary writes. Personal indexes live only under `storesForUser(userId).root/knowledge/index.json`; checked operations and the default retrieval loader recheck owner existence. The shared command independently requires `KNOWLEDGE_SHARED_DIR` and `KNOWLEDGE_INDEX_FILE`, traverses regular files in normalized relative-path order, skips symlinks/hidden/temp/output paths, and records rejected unsupported or malformed documents without aborting the remaining extraction work. Document IDs hash normalized path plus SHA-256 content identity, keeping duplicate bytes at distinct paths separate and repeat indexing stable. Upload bytes/UI, session tools/prompts, and web research remain outside this task.

Task 4 review round 1 RED: three new regressions reproduced an in-flight personal write publishing after its account and owner directory were deleted, a single source read failure aborting the shared run, and Windows namespaced output paths bypassing exclusion. The selected run failed **3/4** assertions; the strengthened no-LLM check passed with every `LLM_*` variable and `SESSION_SECRET` temporarily removed and restored afterward. GREEN: the selected regressions pass **4/4**, and the complete focused Task 4 indexing/store/ownership command passes **26/26**; `npm.cmd run typecheck` and `git diff --check` pass. Personal stores now receive a synchronous owner recheck from the composition root; the atomic writer invokes it after temp fsync/close and immediately before a synchronous atomic rename, with no event-loop gap. Rejected publication cleans the temporary file. Source read failures produce safe rejected records with deterministic normalized-path/read-failure identities because bytes are unavailable, and indexing continues through later good files. Windows ordinary/namespaced paths share one namespace before case-aware relative-path exclusion. No commit, full suite, or build was run; the **#6 gate remains deferred**.

Task 3 independent review reports spec compliance and quality PASS with no Critical, Important, or Minor findings. The reviewer independently reran all **27/27** retrieval tests plus typecheck and diff-check.

Task 3 chunking ruling: within 900–1,200 Unicode code points, choose the latest paragraph break (`\n\n`), otherwise the latest newline, otherwise the latest whitespace; hard-split at 1,200 when none exists. Keep exactly 200 code points of overlap and retain repeated text at distinct source positions with distinct ordinal-based IDs; avoid re-emitting the same source span or a trailing overlap-only chunk. Chunk IDs are SHA-256 over a JSON tuple of source ID, citation JSON with sorted keys, document-wide emitted-chunk ordinal, and unchanged text. The retriever accepts an injected synchronous/asynchronous owner-qualified chunk loader and exposes only `Retriever.search(queries, userId)` to callers. Storage, uploads, APIs/UI, session tools/prompts, and research remain outside Task 3.

Maintenance script decision: `scripts/backfill-graph.ts` remains useful for manually re-extracting one user's graph; `scripts/replay-layout.ts` remains useful for manually regenerating one user's graph layout. Both require `--user <username>` and resolve all personal stores through `storesForUser()`.

Actual SSH, model, and proxy values are still required for host acceptance; the values supplied so far contain placeholders.

## Classification of the 87 failing tests (2026-11-03)

A tests may be deleted only for the named removed feature. B assertions must be updated while preserving their intent. C failures require production code fixes.

| # | Test | Category | Reason / action |
|---:|---|:---:|---|
| 1 | `chat-flow.test.ts` — a pinned provider whose key is gone refuses with 503 provider_key_missing — nothing lingers | B | Fixed office model replaces per-chat provider-key gate; keep turn-gate intent. |
| 2 | `demos.test.tsx` — dispatch through a teacher turn: the call acks mid-turn and the runner completes in the background | A | Demo builder and headless Chromium removed. |
| 3 | `graph-tools.test.ts` — graphStore present → list_sessions + list_propositions join the registry beside the usual set | B | Registered tool allowlist changed; keep exact registry/toggle assertion. |
| 4 | `jobs.test.ts` — the research call resolves immediately with an ack; the turn continues and the runner steers | B | Background researcher job is retained; update for explicit owner ID, web_fetch, conditional search_knowledge, and approval rules. |
| 5 | `jobs.test.ts` — runJob completes the job: result + sources on the job, brief on the steer, activity recorded | B | Background researcher job is retained; update for explicit owner ID, web_fetch, conditional search_knowledge, and approval rules. |
| 6 | `model-catalog.test.ts` — serves the keyed providers' catalogs with the picker's DTO shape | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 7 | `model-catalog.test.ts` — toModelDto projects the raw catalog model verbatim | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 8 | `model-catalog.test.ts` — catalogSlots projects the record's tiers — NULL only where a tier holds no model | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 9 | `model-catalog.test.ts` — catalogProviders reads keys env-wins, fresh per call | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 10 | `model-catalog.test.ts` — accepts a valid slot and rejects unknown provider/model | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 11 | `model-catalog.test.ts` — thinking levels never reject a slot write (owner, interlude 2026-09-22) | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 12 | `model-catalog.test.ts` — clampModelsLevels: the slot's own model translates the pin (the owner's exact case) | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 13 | `model-catalog.test.ts` — thinking levels never reject a chat write (owner, interlude 2026-09-22) | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 14 | `model-catalog.test.ts` — clampChatLevel: the body's model, else the strong slot, translates the pin | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 15 | `model-catalog.test.ts` — glm-5.3-flash: low\|high\|max; anything else clamps to the nearest | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 16 | `model-catalog.test.ts` — the engine factory clamps explicit levels; unknown models throw honestly | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 17 | `model-catalog.test.ts` — UNSET levels resolve from the baked DEFAULT_THINKING_ORDER (owner, 2026-09-22) | B | Server-owned fixed model replaces provider catalog, slots, and thinking controls; assert fixed projection or disabled writes. |
| 18 | `notes-import-route.test.ts` — route keeps three-worker batching, request positions and mixed per-file outcomes/config details | B | The test mutates an owner-scoped extraction proxy; inject the pipeline explicitly and retain batching/outcome assertions. |
| 19 | `notes-import-route.test.ts` — real route plus in-memory ledgers and faux stages reprocess identical imports for all four filename cases | B | The test mutates an owner-scoped extraction proxy; inject the pipeline explicitly and retain repeat-import assertions. |
| 20 | `openrouter-free-models.test.ts` — recursive/flint-v1.0:free: shared listing, validation, tool-capable engine, native modality, and zero cost | A | OpenRouter cloud catalog removed. |
| 21 | `openrouter-free-models.test.ts` — xingchen-agi/xing4.0-29b-a4b:free: shared listing, validation, tool-capable engine, native modality, and zero cost | A | OpenRouter cloud catalog removed. |
| 22 | `openrouter-free-models.test.ts` — nvidia/nemotron-3.5-super-vl:free: shared listing, validation, tool-capable engine, native modality, and zero cost | A | OpenRouter cloud catalog removed. |
| 23 | `openrouter-free-models.test.ts` — openrouter/free: shared listing, validation, tool-capable engine, native modality, and zero cost | A | OpenRouter cloud catalog removed. |
| 24 | `practice-agents.test.ts` — problem is REJECTED while a problem is active (conclude first) | C | Practice remains required; fix tool response/description code. |
| 25 | `practice-agents.test.ts` — conclude is REJECTED with nothing active | C | Practice remains required; fix tool response/description code. |
| 26 | `practice-agents.test.ts` — bare registry: the session pair + the learner-filesystem set — no question, plan, or lesson tools | B | Registered tool allowlist changed; keep exact registry/toggle assertion. |
| 27 | `practice-agents.test.ts` — THE RARELY-NEEDED SET (owner round 10): jobs + map readers compose in when their roots are passed | B | Registered tool allowlist changed; keep exact registry/toggle assertion. |
| 28 | `practice-agents.test.ts` — aligns the conclude description with the canonical ack without changing outcomes or the runtime pause mechanism | C | Practice remains required; fix tool response/description code. |
| 29 | `provider-neutral-agents.test.ts` — visual: native opencode-go/anthropic-messages endpoint, payload and live per-request auth | B | Retain this subagent coverage as one fixed office endpoint test for visual maker/PDF reader; remove cloud routing assertions. |
| 30 | `provider-neutral-agents.test.ts` — visual: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 31 | `provider-neutral-agents.test.ts` — pdf: native opencode-go/anthropic-messages endpoint, payload and live per-request auth | B | Retain this subagent coverage as one fixed office endpoint test for visual maker/PDF reader; remove cloud routing assertions. |
| 32 | `provider-neutral-agents.test.ts` — pdf: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 33 | `provider-neutral-agents.test.ts` — visual: native opencode-go/google-generative-ai endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 34 | `provider-neutral-agents.test.ts` — visual: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 35 | `provider-neutral-agents.test.ts` — pdf: native opencode-go/google-generative-ai endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 36 | `provider-neutral-agents.test.ts` — pdf: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 37 | `provider-neutral-agents.test.ts` — visual: native opencode-go/openai-completions endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 38 | `provider-neutral-agents.test.ts` — visual: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 39 | `provider-neutral-agents.test.ts` — pdf: native opencode-go/openai-completions endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 40 | `provider-neutral-agents.test.ts` — pdf: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 41 | `provider-neutral-agents.test.ts` — visual: native opencode-go/openai-responses endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 42 | `provider-neutral-agents.test.ts` — visual: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 43 | `provider-neutral-agents.test.ts` — pdf: native opencode-go/openai-responses endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 44 | `provider-neutral-agents.test.ts` — pdf: opencode-go missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 45 | `provider-neutral-agents.test.ts` — visual: native openrouter/openai-completions endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 46 | `provider-neutral-agents.test.ts` — pdf: native openrouter/openai-completions endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 47 | `provider-neutral-agents.test.ts` — visual: native openai/openai-responses endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 48 | `provider-neutral-agents.test.ts` — visual: openai missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 49 | `provider-neutral-agents.test.ts` — pdf: native openai/openai-responses endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 50 | `provider-neutral-agents.test.ts` — pdf: openai missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 51 | `provider-neutral-agents.test.ts` — visual: native anthropic/anthropic-messages endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 52 | `provider-neutral-agents.test.ts` — visual: anthropic missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 53 | `provider-neutral-agents.test.ts` — pdf: native anthropic/anthropic-messages endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 54 | `provider-neutral-agents.test.ts` — pdf: anthropic missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 55 | `provider-neutral-agents.test.ts` — visual: native google/google-generative-ai endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 56 | `provider-neutral-agents.test.ts` — visual: google missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 57 | `provider-neutral-agents.test.ts` — pdf: native google/google-generative-ai endpoint, payload and live per-request auth | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 58 | `provider-neutral-agents.test.ts` — pdf: google missing selected key does not fall back to configured OpenRouter | A | Provider-matrix case for selectable cloud routing removed; visual maker and local PDF reader remain covered by fixed endpoint tests. |
| 59 | `question-tools.test.ts` — the prober's tool registry carries the nodeId-less quiz, probe_done, and the learner-filesystem set | B | Registered tool allowlist changed; keep exact registry/toggle assertion. |
| 60 | `question-tools.test.ts` — createProberTools: absent record = full set; explicit false drops exactly that tool; probe_done survives everything | B | Registered tool allowlist changed; keep exact registry/toggle assertion. |
| 61 | `question-tools.test.ts` — createTeacherTools: {research: false} removes exactly research; unknown keys are no-ops | B | Retain researcher dispatch/tool gating; update for web_fetch, optional web_search/search_knowledge, and explicit owner. |
| 62 | `render-activity-dock.test.tsx` — a key-refused job reads as info — 'needs a provider key' (zero-keys wave, 66dbea9) | A | Per-user provider keys and BYOK setup removed. |
| 63 | `render-activity-dock.test.tsx` — a models-refused job reads as info — 'needs model setup', not 'failed' (BYOK, 2026-09-22) | A | Per-user provider keys and BYOK setup removed. |
| 64 | `render-cards.test.tsx` — a models-refused job is INFO: quiet card, 'needs model setup', deep-link to the dialog | A | Per-user provider keys and BYOK setup removed. |
| 65 | `render-cards.test.tsx` — a key-refused job is INFO: 'needs a provider key', 'Add a key' (zero-keys wave, 66dbea9) | A | Per-user provider keys and BYOK setup removed. |
| 66 | `render-new-session.test.tsx` — renders the composer blob, the stats bar, and the fresh-chat empty state | B | Fixed model removes client model picker/stat; retain remaining UI and usage assertions. |
| 67 | `render-settings.test.tsx` — the dialog frame: role=dialog + the ✕ + the six-section nav, General active | B | Settings navigation/actions changed; retain dialog and active keyboard assertions. |
| 68 | `render-settings.test.tsx` — renders every registry action in its scope group | B | Settings navigation/actions changed; retain dialog and active keyboard assertions. |
| 69 | `render-stats-bar.test.tsx` — renders NOTHING on the left when there are no turns yet (owner, wave 7 sweep) | B | Fixed model removes client model picker/stat; retain remaining UI and usage assertions. |
| 70 | `render-stats-bar.test.tsx` — folds context + cost from the turns log (core/prices, no local math) | B | Fixed model removes client model picker/stat; retain remaining UI and usage assertions. |
| 71 | `schema-stamps.test.ts` — golden fixtures are deliberately the unstamped legacy shape (lazy v1 = current-valid) | B | Fixture path moved into per-user root; retain format assertion. |
| 72 | `session-identity.test.ts` — complete native opencode-go/claude-haiku-5-5 foreground serialization carries app identity and exact sessions | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 73 | `session-identity.test.ts` — complete native opencode-go/gemini-4-argon-contributor foreground serialization carries app identity and exact sessions | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 74 | `session-identity.test.ts` — complete native opencode-go/glm-5.3 foreground serialization carries app identity and exact sessions | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 75 | `session-identity.test.ts` — complete native opencode-go/gpt-6-luna foreground serialization carries app identity and exact sessions | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 76 | `session-identity.test.ts` — complete native openrouter/openrouter/free foreground serialization carries app identity and exact sessions | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 77 | `session-identity.test.ts` — native OpenAI cache keys clamp to 64 characters while affinity retains exact session | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 78 | `session-identity.test.ts` — native OpenAI cache-key clamp counts Unicode code points, not UTF-16 units | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 79 | `session-identity.test.ts` — native Codex serialization shares the 64-code-point clamp without an account or OAuth flow | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 80 | `session-identity.test.ts` — SDK native header precedence and cache-off behavior remain untouched | A | Selectable cloud-provider wire formats/cache behavior removed. |
| 81 | `session-identity.test.ts` — completed malformed native JSON stays rejected despite app prepareArguments healing | B | Retain malformed tool JSON rejection on the fixed office model. |
| 82 | `setup-dialog-interaction.test.tsx` — the empty vision list gives the approved next action without an em dash | A | Provider-key/model setup UI removed. |
| 83 | `web-search.test.ts` — createTeacherTools: unavailable drops research on the live wiring path | B | Retain researcher dispatch/tool gating; update for web_fetch, optional web_search/search_knowledge, and explicit owner. |
| 84 | `web-search.test.ts` — createTeacherTools: available keeps research (the gate reads the signal both ways) | B | Retain researcher dispatch/tool gating; update for web_fetch, optional web_search/search_knowledge, and explicit owner. |
| 85 | `web-search.test.ts` — createProberTools: research + pdf are phase-omnipresent; the gate drops research only | B | Retain researcher dispatch/tool gating; update for web_fetch, optional web_search/search_knowledge, and explicit owner. |
| 86 | `web-search.test.ts` — createProberTools: the user toggle drops research independently of the gate | B | Retain researcher dispatch/tool gating; update for web_fetch, optional web_search/search_knowledge, and explicit owner. |
| 87 | `zero-keys.test.tsx` — before a pick: the provider trigger, no key input yet | A | Provider-key/model setup UI removed. |

**Counts:** A 48; B 36; C 3; total 87.

### C resolution

The three practice failures came from corrupted em dashes in the `problem` and `conclude` tool responses and description. The production strings now match the approved copy. A focused run of those three tests passes (3/3). The B and A tests remain for the next pass; no test was deleted or weakened during the C fix.

The background researcher job is retained by the approved design and must carry an explicit owner ID. The visual maker and local PDF reader are also retained; their selectable cloud-provider matrix is replaced with one fixed office endpoint test per subagent. No research or subagent test has been deleted yet.

### A removals completed

- `tests/openrouter-free-models.test.ts`: removed OpenRouter model catalog and cloud routing coverage.
- `tests/setup-dialog-interaction.test.tsx`: removed per-user provider key/model setup dialog coverage.
- `tests/zero-keys.test.tsx`: removed BYOK provider-key setup and dictation-key UI coverage. These features are out of scope for the pilot.
- Cloud-provider transport matrices in `tests/provider-neutral-agents.test.ts` and `tests/session-identity.test.ts` were removed. The visual and local PDF loops retain abort/stream tests plus one fixed-office-endpoint test each; malformed tool JSON rejection remains on the office model.
- The demo dispatch registration case was updated to the retained visual dispatch. The demo builder remains unregistered; its old internal tests are still in the suite pending source removal.

## Resume note — 2026-11-03

The only commit made for this work is `41bdd56 normalize line endings (no code changes)`. The office pilot implementation remains uncommitted in the working tree; do not discard it. The A/B/C classification above remains **A 48, B 36, C 3**. The researcher background job is re-enabled with explicit owner scope, `storesForUser(owner)`, URL provenance, and the web approval callback. The retained visual maker and local PDF reader have fixed-office-endpoint tests. The first full green gate after that work was 1,732 tests.

This session added account Preferences (`uiLanguage`, `teachingLanguage`, optional private `background`), a language selector on the new-session form, immutable session `teachingLanguage`, language instructions to foreground agents and the researcher/visual/PDF jobs, and a read-only teaching-language label in the session header. Signup still initializes both languages from the signup UI/browser choice. `tests/office-language-preferences.test.ts` checks that changing a preference does not change an existing session. Legacy route tests now seed an account for their test owner. The mid-run steering test now waits until its scripted model step begins, removing a suite-load race without relaxing its ordering assertions.

**Verified at this checkpoint:** `npm test` **1,734/1,734 pass**; `npm run typecheck` passes; `npm run build` passes; the post-build artifact check finds no `data/`, `knowledge/`, `index/`, or JSONL user files in `.next`. The test log `.test-run.log` was temporary and should be removed. There is no `.126` deployment or live LLM smoke result; host, model, proxy, and SSH values provided so far are placeholders.

| Acceptance item | Checkpoint status |
|---|---|
| 1 Deployment | Local test/typecheck/build gate passes; systemd and DEPLOY.md pending. |
| 2 Auth | Signup/login/logout, cookie expiry, route gates and rate-limit tests present; live browser verification pending. |
| 3 Isolation | Per-user stores and owner-scoped job/approval tests present. Graph extraction now has a direct isolation test covering another owner's chat and account deletion before async access. |
| 4 Full teaching/practice | Existing local flow tests pass; real LLM tool-call run pending. |
| 5 English/Japanese UI | Preference and session teaching language wiring begun; full UI translation and missing-key audit pending. |
| 6 Office knowledge | Indexing, extraction, retrieval, citations, upload, and provenance behavior pending. |
| 7 Web research | URL-only provenance and researcher job tests present; `web_search` deferred for `SEARCH_PROVIDER=none`; proxy/approval UI/live verification pending. |
| 8 Outbound traffic | Local audit pending. |
| 9 `/source` | Pending. |
| 10 Concurrency | MAX_CONCURRENT_LLM and three-user live load test pending. |

**Next in approved order:** finish full i18n (#5), then office knowledge (#6, including setting sticky `knowledgeUsed` on actual retrieval), web toggle/approval behavior (#7), `/source` (#9), deployment docs/systemd, and `.126` acceptance. Remove legacy prohibited source paths and complete the registered-tool allowlist test. The account `background` must be passed to measure/plan/teach only for that owner; the current foreground build passes it, but verify practice and async behavior as part of the final language audit. Do not claim v1 completion from the local gate.

### Encoding and graph ownership checkpoint

The Japanese source text was valid UTF-8. The apparent mojibake came from inspecting UTF-8-without-BOM files through Windows PowerShell 5.1 `Get-Content`, which decoded them with the legacy Windows code page. Do not use PowerShell 5.1 `Set-Content` or `Out-File` for repository text; edits use the patch tool, and programmatic writers must select UTF-8 without BOM explicitly. Locale catalogs now live in `locales/en.json` and `locales/ja.json`. The encoding test scans source, app, locales, and prompts for common mojibake markers, checks catalog key parity, and verifies a known Japanese string survives UTF-8 decoding unchanged.

The graph extraction audit traced both the manual route and turn-triggered path through `extractionForOwner(ownerId)`. Production pipelines are cached per explicit owner and receive only `checkedStoresForUser(ownerId)`. Those proxies recheck account existence before every store operation. A direct isolation test proves Alice's pipeline cannot read Bob's chat and refuses further access after Alice's account is deleted.

### Office knowledge Task 5: personal uploads and bilingual page

Added authenticated `GET`/`POST /api/knowledge/documents`, owner-scoped `DELETE /api/knowledge/documents/[id]`, the `/knowledge` page, and a localized sidebar link. Uploads use multipart field `file`; successful responses are `{ document }`, lists are `{ documents }`, deletions return `{ deleted: true }`, and failures follow the existing `{ error }` shape. Machine-readable upload errors are translated by the English/Japanese Knowledge catalogs. Scanned PDFs expose `no_text_layer` and the localized explanation that OCR is unsupported. Parser failures remain `rejected` and contribute no chunks.

All personal operations resolve `checkedStoresForUser(currentUserId()).knowledgeStore`. Source paths use validated document IDs under `<user-root>/knowledge/documents/`; original filenames remain citation metadata. The personal snapshot adds an optional SHA-256 `contentHash` field, leaving existing/shared v1 snapshots valid. Identical bytes for one owner return the existing record, including simultaneous uploads with different names. Owners retain separate source files and snapshots. Mutations are serialized per owner within the pilot server process to avoid duplicate publication and lost snapshot updates.

The exact file limit is 26,214,400 bytes (25 MiB). Validation checks supported extension and compatible MIME type, permits absent/generic binary MIME, and enforces actual file bytes at the store boundary. The route also counts incoming multipart bytes and aborts beyond the file limit plus 64 KiB envelope allowance; client Content-Length is not trusted. PDFs, PPTX, DOCX, MD and TXT index synchronously; other types, including Excel, are rejected. Teaching-language settings and behavior are unchanged.

Focused Task 5 verification covers authentication, five-format citations, owner isolation/deletion, concurrent duplicate uploads, MIME/extension rejection, exact and oversized byte boundaries, scanned PDFs, English/Japanese rendering and interaction, sidebar behavior, and locale UTF-8/key parity. Initial tests failed on missing feature modules; later explicit removal checks proved auth, non-disclosing deletion, byte limits, idempotence, and no-text status assertions detect regressions. Full suite, lint, build and artifact scanning remain reserved for Task 7 as directed. This checkpoint does not complete acceptance item #6; session/tool/provenance wiring is Task 6.

### Office knowledge Task 6A: durable session controls and sticky state

The authenticated owner-scoped session settings PUT now accepts only `webResearchEnabled` and `officeKnowledgeEnabled`; model/provider/thinking overrides and unknown fields are rejected. Both flags remain optional in stored `ChatSettings`, and absence means OFF. PUT is replace-whole for the two controls: omitted flags read as false. The response exposes exactly those two effective booleans. A semantic no-op performs no publication, audit append, or event and preserves the record byte-for-byte, including an existing server-stamped/internal model pin. The first semantic controls change replaces the settings object with only the two approved flags; this is the normalization boundary for legacy settings.

Each semantic controls change publishes the settings and one native `session-controls-changed` marker together. Its neutral details are `{ at, changes }`, with an ISO timestamp and changes ordered `webResearchEnabled` then `officeKnowledgeEnabled`, each carrying `{ field, from, to }` booleans. The marker is explicitly absent from LLM wire messages and compaction summary input; the UI protocol exposes `data-session-controls-changed` with stable message/part identity for Task 6C. Localization belongs to that later renderer. Successful semantic changes emit owner/session-scoped `record-changed` after persistence. Validation failures, persistence failures, and no-ops emit nothing. Settings/audit writes do not change `updatedAt` or sidebar ordering. Agent composition remains Task 6B and adopts controls at the next run.

`ChatStore.markKnowledgeUsed(chatId)` fresh-reads and synchronously persists false/absent to true once, returning whether it made the transition. There is no clearing operation; settings, messages, usage, tree, and rename writers preserve sticky state. The existing foreground settlement already fresh-reads before merging its turn messages; a deferred-turn regression verifies that a controls audit and sticky transition added during a run both survive settlement.

All chat-record publications now use the central same-directory atomic replacement: an unpredictable exclusive temporary file with mode `0600`, write, file fsync, close, and rename. Failure cleanup removes only temporary files created by that writer. Existing owner composition and future-version refusal remain intact. Focused behavioral RED failures preceded implementation, and final focused verification passed 166 tests across nine affected files; TypeScript and `git diff --check` pass. Full suite, lint, build, and artifact scanning remain Task 7. Task 6B knowledge tools and Task 6C controls/citation UI were not implemented here.

Task 6A review fix: compaction also crosses an asynchronous summary boundary. Its publication now fresh-reads the record and appends the summary marker to the current history, preserving messages and controls audits added during summarization while retaining the cut that the summary actually covered. A deterministic deferred-summary test reproduced the lost-audit bug before the fix and now verifies exact order, stable identities, no duplication, unchanged cut/wire semantics, sticky state, and single usage publication. A second deferred test preserves future-version refusal and leaves upgraded files byte-identical without success events. The amended focused compaction/session-control gate passes 55/55 tests; TypeScript and diff check pass.

### Office knowledge Task 6B: knowledge tool and agent wiring

`search_knowledge` tool (`src/agent/tools/knowledge.ts`): accepts 1–4 queries, searches through an injected `Retriever` port, and formats results with exact inline citations — `[fileName, page N]` (PDF), `[fileName, slide N: title]` (PPTX), `[fileName, §heading, ¶N]` (DOCX), `[fileName, §heading, lines N–M]` (MD/TXT). The sticky `knowledgeUsed` flag is set atomically via `markKnowledgeUsed` BEFORE chunks are returned to the model; a persist failure withholds chunks entirely.

Prompt fragments: `src/agent/prompts/teacher/35-knowledge.md` and `src/agent/prompts/prober/35-knowledge.md` provide query formulation rules (Japanese + English + key terms) and citation discipline. Both use conditional language ("When `search_knowledge` is available") and are auto-loaded by the segment discovery. Practice agents do not receive the fragment (per ruling: teacher + prober only).

Registry wiring (`src/agent/tools.ts`): `knowledge?: KnowledgeToolContext` added to both `ProberToolContext` and `TeacherToolContext`. The tool is conditionally spread into both registries via `...(ctx.knowledge ? createKnowledgeTool(ctx.knowledge) : {})`. When `knowledge` is absent, no `search_knowledge` appears in the registry.

Composition root (`src/server/chat-handler.ts`): imports `Bm25Retriever`, `loadKnowledgeChunks`, and `KnowledgeToolContext`. When `record.settings?.officeKnowledgeEnabled === true`, constructs a `KnowledgeToolContext` with the session owner's ID, the chat ID, a `Bm25Retriever` backed by `loadKnowledgeChunks`, and the `chatStore.markKnowledgeUsed` operation. The context is passed to both `createTeacherAgent` and `createProberAgent` but NOT to practice agents.

Decisions: knowledge is teacher + prober only (practice excluded). The prompt fragment is unconditionally loaded but uses conditional wording. The retriever is instantiated fresh per turn via the composition root. `markKnowledgeUsed` delegates directly to the store's synchronous monotonic operation.

Focused tests (`tests/knowledge-tool.test.ts`): 10 behavioral tests covering tool existence, empty retrieval, sticky persist before return, persist failure withholding, all four citation formats (PDF/PPTX/DOCX/MD), and registry gating (absent when no knowledge context, present when provided). All 10 pass; TypeScript passes; 117 affected tests across 5 suites pass with zero failures.

### Office knowledge Task 6C: controls UI, audit markers, and citation rendering

Session controls UI: already implemented in `components/stats-bar.tsx` — checkboxes for `webResearchEnabled` and `officeKnowledgeEnabled` with locale-backed labels, PUT to `/api/chats/:id/settings`, loading/saving states, and error display. No changes needed; the Task 6A backend and existing stats-bar controls are already wired.

Audit marker rendering (`components/chat.tsx`): added `data-session-controls-changed` case to the conversation's marker-card switch. Renders as a compact centered line (same style as practice-next) showing each changed control's display name and ON/OFF state. Uses `activityUi.webResearch` / `activityUi.officeKnowledge` for field names and `chat.controlOn` / `chat.controlOff` for toggle state.

Locale keys: added `chat.controlOn` ("ON") and `chat.controlOff` ("OFF") to both `locales/en.json` and `locales/ja.json`. Parity confirmed: 518 keys in both catalogs.

Citation rendering: per earlier ruling, citations are inline text produced by the `search_knowledge` tool's `formatCitation` function — `[fileName, page N]`, `[fileName, slide N: title]`, `[fileName, §heading, ¶N]`, `[fileName, §heading, lines N–M]`. They render as normal markdown text in assistant messages. No additional UI styling was applied (inline text ruling).

Decisions: controls toggles reuse the existing stats-bar pattern rather than adding a separate header widget. Audit markers use the same chrome-line style as practice-next. Citation rendering stays as inline formatted text.

Focused verification: TypeScript passes; locale parity passes (518 keys); 53 affected tests across 3 suites pass with zero failures.

### Office knowledge Task 7: full acceptance gate

Prompt-overrides test fix: the pinned prober segment list in `tests/prompt-overrides.test.ts` was updated to include `prober/35-knowledge.md` (the new knowledge prompt fragment discovered by `listSourceSegments`).

Build artifact scanner fix: `scripts/check-build-artifacts.mjs` now excludes the Next.js route tree (`server/app/`) from the forbidden-directory-name check. The `knowledge` API and page routes are compiled route bundles, not data files; the scanner continues to flag any `knowledge/` directory outside the route tree and any `.jsonl` files anywhere.

Full gate results:
- **`npm test`**: 1,902/1,902 tests pass (0 failures).
- **`npm run typecheck`** (`tsc --noEmit`): passes clean.
- **`npm run build`**: production build succeeds; build artifact check passes (no data/, knowledge/, index/ or JSONL files outside the route tree).
- **Locale parity**: 518 keys, EN and JA catalogs match.

### Office knowledge Task 8: image understanding via Gemma 4 vision model

Embedded images in PDF/PPTX/DOCX are extracted at indexing time and described by the Gemma 4 vision model. Descriptions are stored as searchable text chunks with `imageDescription: true` on the existing `KnowledgeCitation` discriminator. No vision call at retrieval time; image description is best-effort background enrichment — failures never block text indexing.

**Contracts** (`src/knowledge/contracts.ts`): added `imageDescription?: boolean` to PDF, PPTX, and DOCX citation variants. Added `ExtractedImage` interface (`data`, `mimeType`, `width`, `height`, `citation`). Added optional `images?: ExtractedImage[]` to `ExtractedDocument` ready/no_text_layer variants. Snapshot validation (`src/knowledge/index-store.ts`) updated with `imageDescriptionSchema` on all three applicable citation schemas.

**PDF image extraction** (`src/knowledge/parsers/pdf-images.ts`): walks pdfjs-dist operator list for `paintImageXObject`, deduplicates per page, filters by minimum threshold (10 KB + 100×100 px), converts RGBA bitmap to PNG using fflate `deflateSync` with inline CRC32 and chunk encoder. Returns `[]` on any failure.

**Office image extraction** (`src/knowledge/parsers/office-images.ts`): PPTX extracts `ppt/media/*` entries and maps to slide numbers via relationship XML. DOCX extracts `word/media/*` entries via document relationships. Both parse PNG IHDR, JPEG SOF0/SOF2, and GIF headers for dimensions, enforce the same minimum threshold, and use `extractSelectedZipEntries` for secure ZIP access.

**Vision description job** (`src/knowledge/vision-job.ts`): `describeImages(images, config, callFn?)` iterates images, base64-encodes each, and calls the vision model (LM Studio at `VISION_BASE_URL` or injected `callFn` for tests). Returns `ExtractedBlock[]` with `imageDescription: true` citations. Default HTTP: POST to `${baseUrl}/chat/completions` with `image_url` content, 30s timeout. Per-image errors are caught silently.

**Config** (`src/server/office-config.ts`): added `visionBaseUrl?`, `visionModel?`, `visionApiKey?` fields reading `VISION_BASE_URL`, `VISION_MODEL`, `VISION_API_KEY` environment variables.

**Pipeline wiring** (`src/knowledge/extract.ts`): PDF, PPTX, and DOCX branches call their respective image extractors alongside text extraction and attach images to the result. **Service wiring** (`src/knowledge/service.ts`): `indexKnowledgeDocument` accepts optional `visionConfig`; when present and images exist, calls `describeImages` and chunks the resulting blocks as `id + "-img"` source, appending image chunks to text chunks.

**Tests** (`tests/knowledge-image-understanding.test.ts`): 13 focused tests across 5 suites — PDF image extraction (function existence, min size filtering, return type), PPTX/DOCX extraction (function exports, empty input), vision description job (function export, imageDescription citation, best-effort skip), and image-derived chunks (chunking survival, snapshot validation, backward compat).

**Gate** (2026-11-07): `npm test` **1,915/1,915 pass**; `tsc --noEmit` clean; `npm run build` + artifact check pass.

### UI polish (2026-11-07, post-Task 8)

Three commits after Task 8:

1. **Light/dark theme support and auth + knowledge page redesign** (`1b88fd1`): restructured CSS tokens for light/dark mode with system auto-detection and manual toggle via localStorage. Redesigned auth forms as centered cards with proper visual hierarchy. Rebuilt knowledge page with drag-and-drop upload zone, format badges, status badges, and file size display. Added `.env` to `.gitignore`.

2. **Sidebar icons, preferences toggle, and sans-serif UI font** (`67c3936`): added `BookOpenIcon` to Knowledge link and `SlidersHorizontalIcon` to Preferences link in sidebar (matching Settings/Logout). Added `SidebarToggle` to the preferences page header so the sidebar can be reopened from `/preferences`. Switched the UI chrome font from monospace (`ui-monospace, Consolas`) to system sans-serif for a cleaner look.

These are UI polish changes. All acceptance items remain at their prior status; no acceptance gate was affected.

### Remaining gaps

| Item | Status | Notes |
|---|---|---|
| Web research | SearXNG working on .126 (2026-11-16) | SearXNG returns results on .126 (`curl --noproxy '*' 127.0.0.1:8080/search?q=fpga&format=json`). Image installed offline from the `searxng-image` branch; `general.contact_url` and `outgoing.proxies` set in `~/searxng/settings.yml`. App side: set `SEARCH_PROVIDER=searxng`, restart, then the in-app test (see plan below). |
| `/source` route | Implemented, host-untested | AGPL compliance route: unauthenticated archive download of the app source, excluding `.env`, `data/`, knowledge files, indexes, and secrets. |
| Deployment on .126 | In progress (2026-11-16) | App updated from `office` and running; SearXNG running. Picture reading is NOT working on .126 yet (images do not reach the model; see "Picture reading on .126" below). Full acceptance checks (`DEPLOY.md` section 8) not yet run. |
| Concurrency limits | Untested | `MAX_CONCURRENT_LLM=2` is set but not host-tested with multiple users. |
| Shared knowledge index | Operator-configured | Paths are set in the host `.env` by the operator (decided 2026-11-11); empty means off. Optional admin-built index. Separately, users upload to the Shared pool on the Knowledge page (`data/shared/`, audited). |

## Admin pages and password reset (2026-11-16)

- **Admin identity:** `LH_ADMIN_USERNAME` (`src/server/admin.ts`: `adminUsername`, `isAdminUsername`); `isAdminUser` in `knowledge-audit.ts` uses the same check. No role is stored on accounts. Guards: `withOfficeAdmin` (route-scope, 401/403) and `withOfficeAdminPage` (page-scope, redirects to /login or /).
- **Accounts:** `list()` and `resetPassword(username, newPassword)` (same 12-character rule as signup).
- **Admin UI/API:** `/admin` (users, reset password, delete), `PUT /api/admin/users/[username]/password`, `DELETE /api/admin/users/[username]` (refuses the admin account; removes only the account record). Login page shows "Forgot password? Contact your administrator."
- **`/admin/knowledge`:** totals, uploads per day and uploader per document, from `sharedKnowledgeStore` plus the audit log (`computeKnowledgeStats` in `src/knowledge/stats.ts`).
- **Graph:** Graph/Table toggle on the graph page (`components/graph-table.tsx`): search, per-row and bulk delete through the existing delete dialog.
- **Known gaps:** no sidebar link to `/admin`.

## Picture reading, new-session switches, search label (2026-11-16)

Merged into `office` as PR #3 (`a6d5681f`). CI checks passed locally: typecheck, lint, 2108 tests (four clean full runs), production build.

- **Picture reading (opt-in).** A "Read pictures (slower)" box on each PPTX/Word/PDF attachment in the chat box and on the Knowledge page upload. Shown only when the server has vision (`LLM_VISION=true`, or `VISION_BASE_URL` + `VISION_MODEL`). Off by default; each user's choice is saved on their account (`readPictures` in `accounts.json`, `PATCH /api/preferences`).
  - Pictures are described by the vision model and indexed as text where they appear: slide (PPTX), page (PDF), paragraph under its heading (Word). Template/header/footer art and duplicates are skipped; at most 30 per file; calls share the background LLM limit.
  - The vision call asks for `reasoning_effort: "none"` (measured on Gemma 4 e4b: 8 s vs 20 s, and thinking can no longer consume the whole answer), retrying once without it if the server rejects the option.
  - Scanned PDFs are skipped (already read by OCR). Word pictures now cite their real paragraph and heading (were all "paragraph 1").
  - Documents record `hasPictures` / `picturesRead`. A saved text-only file shows **Read pictures** on the Knowledge page (`POST /api/knowledge/documents/[id]/pictures`; owner for personal, anyone for shared); re-attaching it with the box ticked reads them in place (same id, no duplicate). Upload extracts once (no double indexing); re-attaching a saved file reuses its stored chunks.
  - Failure never stops the upload or the chat: the text is kept, the model is told, and the user sees a dismissible note naming the slides/pages/headings (en/ja).
  - Fixed latent bugs: picture chunks used an invalid `sourceId` (`<id>-img`, rejected by the snapshot validator); template pictures were labelled "slide 1".
- **New-session switches.** The new-session screen shows the same web/knowledge switches as a running session, both off every time (owner decision). Ticked switches are saved to the session (`PUT /api/chats/[id]/settings`) before its first reply, so turn 1 already uses them. Before, the switches only appeared after the first reply.
- **Web switch label.** "Enable web search" / 「ウェブ検索を有効にする」 when a search provider is configured; "Read linked pages" when the tutor can only open pasted links. Nothing passed the mode before, so it always said "Read linked pages". Server setup reaches the UI through `ServerCapabilitiesProvider` in the root layout.
- **Verified in the browser with the real model (laptop, Gemma 4 e4b):** knowledge ticked before the first message answered from the shared lab rules on turn 1; a picture-only value (t_setup 2 ns, t_hold 1 ns) was read from a slide; the remembered choice pre-ticked the box in a new session; "Read pictures" upgraded a saved deck in place.
- **Commit attribution:** no Claude co-author line on commits from now on (owner, 2026-11-16); past history is left unchanged.

### Picture reading on .126: not working yet

With `LLM_VISION=true` on .126, every picture "description" came back as *"Please provide the image you would like me to describe"*: the model received the instruction but not the image. Either LM Studio has Gemma 4 26B loaded without its vision projector (mmproj), or `gemma4_proxy.py` (:8088) drops image parts when it re-renders the chat template. The app currently accepts that reply as a description, so it ends up in the chat text and, for saved files, in the knowledge index.

## Plan (next steps)

**On .126 (operator)**
1. Set `LLM_VISION=false` in `.env` and restart until images reach the model (hides the box; decks read as text).
2. Delete any deck saved with pictures ticked while vision was broken, and re-upload it later.
3. Load Gemma 4 26B's vision projector in LM Studio; then run the image test:
   `curl --noproxy '*' 127.0.0.1:8088/v1/chat/completions` with an `image_url` part, `"max_tokens":1024`, `"reasoning_effort":"none"`. A real description means it works; "please provide the image" means the proxy drops images.
4. If the proxy drops images: make `gemma4_proxy.py` forward `image_url` parts to LM Studio. Then set `LLM_VISION=true` again and restart.
5. Web search in the app: `SEARCH_PROVIDER=searxng`, `SEARXNG_URL=http://127.0.0.1:8080`, `NO_PROXY` includes `127.0.0.1`; restart; check `GET /api/search` reports `available: true`; in a Chat tick "Enable web search" and ask for sources. After a reboot: `deploy/searxng.sh start`.
6. Page reading (opening result pages) needs `HTTPS_PROXY`/`HTTP_PROXY`; ask IT for a service account or an IP allowlist for .126 rather than a personal login.
7. Check `LLM_CONTEXT_WINDOW` matches the context actually configured in LM Studio for the 26B (compaction triggers at window − 16k).
8. Run the `DEPLOY.md` section 8 acceptance checks.

**Code (proposed, needs the owner's go-ahead)**
1. Vision self-check at server start: send one small test picture with a known word; if the model can't read it back, keep picture reading off (box hidden) and log why.
2. Per-picture check: the describe prompt asks for a fixed marker when no image is visible; that marker, or replies asking for an image, count as failed (they show in the "couldn't read" note and are never stored).
3. Picture reading is already in `office` (PR #3), so until 1–2 land, .126 must run with `LLM_VISION=false` (operator step 1).

**Known gaps / later**
- No sidebar link to `/admin` (open by URL).
- The user's own message shows the whole extracted attachment text under an English "Extracted attachment content" label (the tutor uses that line as a marker, so it needs a display-only fix).
- Quiz options: the accessible name drops emphasised words (e.g. "before"/"after"), so screen readers hear identical options.
- `npm audit`: 2 high from `linkify-it` via the unused dependency `ansi-to-react` (remove it); 3 moderate from `minimatch` in ESLint tooling (dev only). Do not run `npm audit fix --force`.
- `fast-xml-parser` is pinned at 5.12.0 (5.12.1 available; bump in its own PR with the extraction tests).
- Teaching on the small laptop model skipped `plan_init` even after the retry nudge; retest planning on the 26B.

## Tool calls typed as text, slow replies, proxy (2026-11-19)

### What users saw on .126
- A quiz showed as raw JSON, including `correctAnswer` and the explanation ("the question had the answer").
- The plan appeared twice: the model drew it as a ```mermaid block instead of calling `plan_init`, then the retry nudge made it present the whole plan again.
- With web research on, "latest version" questions (Vivado, DOCA) were answered from memory.
- Probing and planning showed "THINKING…" for a long time with nothing appearing.

### Causes found
- **`gemma4_proxy.py` (the :8088 proxy between the app and LM Studio :1234):**
  - **No streaming:** it waits for the whole reply (thinking included) and sends it in one go (`# stream=true: emit the finished result as SSE chunks`). That is the long blank wait.
  - **Only Gemma's native call format is recognised** (`<|tool_call>call:name{…}<tool_call|>`). A call the model writes as a JSON or mermaid block reaches the app as plain text. That explains the leaked quiz, the duplicate plan and research never being dispatched.
  - **It drops images** (`normalize`: "content parts -> text only"). It renders a raw prompt for LM Studio's `/v1/completions`, which cannot carry images. That is the real cause of "Please provide the image".
- **Tested on Gemma 4 26B through Google AI Studio** (`GEMINI_API_KEY`, model `gemma-4-26b-a4b-it`), using the app's own Chat prompt and research tool: the model called `research` every time. The model is fine; the calls get lost in the proxy path. Free tier allows only 16k input tokens per minute and one planning request is ~13k, so repeated planning runs there are slow.
- **Other contributors:**
  - With `LLM_REASONING=true`, every turn uses the "medium" thinking level by default (`src/core/settings.ts` `DEFAULT_THINKING_ORDER`).
  - The teacher instructions are ~39k characters (~10k tokens) per request.
  - The handoff tells the model to "take your time".
  - The owner wants no accuracy loss, so the thinking level stays as it is.

### Done (this branch, not yet in `office`)
- **App-side safety net:** `src/agent/tool-salvage-stream.ts`, wired for native tool mode in `src/agent/models.ts`, with 10 tests in `tests/tool-salvage-stream.test.ts`. Typecheck and lint are clean.
  - Holds back ```json / ```mermaid / bare ``` blocks while the reply streams. Other code blocks stream as before.
  - If the reply has **no real tool call**, a held block becomes the call it unambiguously is:
    - `{name, arguments}` naming an available tool;
    - an object that fits exactly one tool's schema (required fields present, no unknown keys, schema check passes);
    - a mermaid `graph`/`flowchart` block while no plan exists yet → `plan_init`.
  - The converted call goes through the normal tool path, with the same validation as a real call.
  - Everything else is shown exactly as written.
- Full test suite not yet re-run after this change.

### Plan (approved by the owner 2026-11-19: "approve all")
1. **New proxy in the repo** (`deploy/gemma4-proxy/`). It **replaces** the existing one on :8088; the owner wants one proxy for opencode and LearnHarness, run the same way as before (`UPSTREAM=… TEMPLATE=… uvicorn gemma4_proxy:app --port 8088`).
   - Real token streaming: request `/v1/completions` with `stream:true`, and forward text and thinking deltas as they arrive. Hold back only a tool call until it is complete, then parse it with the existing `CALL_RE`/`_P` code (identical results). Pass `stream_options.include_usage` through.
   - `stream:false` must stay byte-for-byte the same as today, for opencode.
   - `STREAM=0` turns streaming back to the old behaviour.
   - Optional JSON tool-call fallback behind `JSON_TOOL_CALLS=1`, **off by default** so opencode is never affected. LearnHarness has the app-side net.
   - Python tests with a fake LM Studio. Local Python is `py` (3.14); use `uv run --with fastapi --with httpx --with jinja2 --with uvicorn`. Local Ollama is not a faithful raw-completions backend (it strips Gemma's special tokens), so tests use a fake upstream.
2. **Pictures:** set `VISION_BASE_URL=http://127.0.0.1:1234/v1` (LM Studio directly, not the proxy) plus `VISION_MODEL`, and load the mmproj. Document in `DEPLOY.md`, then run the image `curl` there.
3. **End-to-end chat tests** for speed, accuracy and visuals:
   - the dev server against the new proxy with the fake upstream (streaming visible, quiz card not JSON, single plan);
   - the dev server against AI Studio Gemma 26B for a real Teaching run;
   - screenshots in English and Japanese.
4. Re-run the full suite, commit (no Claude co-author line), push, and open a PR to `office`.
5. On .126 (operator): stop the old proxy, start the new one on :8088 with the same command, and check opencode still works. Then retest the black-hole Teaching flow and the DOCA question with web search on.

**Speed ideas that keep accuracy (later, need go-ahead):**
- Pause background knowledge extraction while a live reply is being written.
- Speculative decoding in LM Studio with Gemma 4 E2B/E4B as the draft model.
- Match LM Studio parallel slots to `MAX_CONCURRENT_LLM`.

### Update 2026-11-19 (later): proxy built and tested
**Done:**
- `deploy/gemma4-proxy/gemma4_proxy.py` — the new single proxy (replaces the old one on :8088, same start command). Real streaming; `stream=false` unchanged; `STREAM=0` restores the old stream; `:` allowed in tool names; `JSON_TOOL_CALLS=1` opt-in (off). 12 tests in `deploy/gemma4-proxy/tests/` compare every answer with the original proxy (`tests/legacy_proxy.py`) across plain text, thinking, one/two tool calls, Japanese, whitespace and stray `<`, at 1/2/5/64-character chunking.
- The app also renames a real call with a namespaced tool name (`default:probe` → `probe`). Gemma 4 26B did this in testing; the "not found" round trip cost an extra call, and the model told the learner there was a "system glitch".
- `DEPLOY.md`: proxy section, and pictures go straight to LM Studio (`VISION_BASE_URL=http://127.0.0.1:1234/v1`, `LLM_VISION=false`), because the proxy's raw-prompt path cannot carry images.

**Measured:**
- **Fake slow LM Studio:** the old proxy showed nothing for 4.3 s (the whole reply); the new proxy showed the first text at 0.6 s, with identical content.
- **App + real Gemma 4 26B (AI Studio):** probing calls showed the first text in 1.0–1.7 s; whole turns took 10–24 s. Planning could not run there: one planning request is ~100k characters (~25k tokens), more than the free tier's 16k tokens per minute.
- **App + laptop Ollama `gemma4-e4b`:**
  - first planning call (20.7k tokens): 16.6 s to the first text, 48.5 s total;
  - next call (24k tokens): 0.9 s to the first text, because Ollama reused the already-processed start of the prompt;
  - probing (6k tokens): 2.3 s, then 0.6 s.
- **On .126, prompt reuse decides speed.** Every teaching call re-sends ~20–25k tokens. LM Studio (llama.cpp) reuses a cached prompt start only if it is unchanged and the slot has not been taken by another chat. Check LM Studio's log for how many tokens are reused per call.

**Seen working in the browser:**
- A quiz the model typed as ```json became a real quiz card: no answer or explanation visible, graded correctly, explanation shown after answering.
- On Ollama, the model typed the plan as a ```mermaid block → converted to `plan_init` (`salvaged_…` id) → plan created once, map drawn once, no retry, no repeated presentation.

**Accuracy findings, not fixed (need decisions):**
1. **Answer key contradicts its own explanation (Gemma 4 26B):** the explanation said the "cosmic vacuum cleaner" idea is wrong, yet `correctAnswer` pointed at that option, so a learner's correct answer was graded wrong.
2. **The prober taught the answer right before asking** (a "why can't light escape" question after the text had just explained it). This is the other form of "the question had the answer".
3. **The prober kept teaching after its assessment,** and wrote its own outline as text before planning started.
4. **The small model dropped the quiz's required `type` field** twice, then apologised to the learner for a "system problem". Each rejection costs a full call.

**UX gaps seen:**
- "Something went wrong: Connection error." shows in English on the Japanese screen.
- When the very first model call failed with HTTP 400, the chat stayed empty with no error.

### Update 2026-11-19 (evening): teaching fixes and the 26B measurement
**Done** (commit `7beb0ea5`; 2128/2128 tests pass):
- A successful `probe_done` now ends the prober's turn, so it can no longer keep teaching or write its own outline after the assessment. A refused `probe_done` still lets it fix course in the same turn.
- A teaching `quiz`/`explain` call without `type` is read as `"check"`, the UI's existing reading of a typeless question, instead of being rejected.
- A saved failed turn (`stopReason: "error"`) shows an error line instead of a blank chat. Checked in the browser on the earlier HTTP 400 chat.
- The error prefix and the thinking label come from the locale files (ja: `エラーが発生しました：`, `考え中`).
- No prompt changes (owner: not for now).

**Measured only — issues 1 and 2, no change made (owner):**
- **Method:** the real prober instructions and tools on Gemma 4 26B (AI Studio), 3 topics × 2 runs, first probing question after the goal is set.
- **Results:**
  - **Wrong answer key: 1 of 5 quizzes.** TCP flow vs congestion control: `correctAnswer` "b", but the explanation supports "a". Together with the black-hole case seen in the browser, that is 2 wrong keys in 6 quizzes seen.
  - **One-letter option values ("a"/"b"/"c"): 5 of 5.**
  - **The correct option was written first: 4 of 5.** The app shuffles options on screen, so this does not leak to the learner.
  - **Answer given away before the first question: 0 of 5.** The earlier give-away came later, after the learner answered: the model explained, then asked about what it had just explained. A first-question test cannot catch that; it needs multi-turn runs.
  - **No question at all: 1 of 6 runs** (black holes #1). The model only planned in its thinking and ended the turn without calling a tool, leaving the learner with nothing to answer.

### Update 2026-11-19 (night): answer keys and the probing reminder
**Done** (commits `a008a07d`, `7ed71e9e`; 2134/2134 tests pass):
- **New quizzes must name their option values.** A one-character or all-digit value standing in for a longer label (`"a"`, `"2"`) is rejected at the authoring boundary (`quizAuthoringProblems`). Saved quizzes still display: the display parse uses `quizInputProblems`, which is unchanged.
- **The tool description's example quiz now uses named values** (`"6cos2x"`…), owner-approved. The model had been copying the old `"a"/"b"/"c"`.
- **Probing reminder:** when a probing turn ends with no tool call (not stopped or failed, before `probe_done`), the app sends one reminder per learner input, with owner-approved wording, through the plan-retry path. The chat shows the usual "Retrying…" line.

**Measured on Gemma 4 26B after the change** (4 topics × 3 runs, rejections replayed as the app sends them):
- **Named values:** 10 of 10 quizzes ended up with named values. Only 1 was rejected first and fixed itself on the next try.
- **Answer keys:**
  - 9 of 10 match their explanation.
  - 1 is doubtful: a CPU-cache quiz keyed "latency-bandwidth trade-off" while its explanation talks about trading capacity for latency, and no option says that. This is a badly built question more than a wrong letter.
  - Before the change: 2 wrong keys in 6 quizzes.
- **No question at all: 2 of 12 runs.** The app now sends the reminder for this case. This test does not include the reminder, so it shows how often the reminder will fire, not the result after it.
- **Not done:** the extra answer-key check call (about 1–2 s per quiz) is waiting for the owner's decision.

### Update 2026-11-19 (late): quiz answer-key check
**Done:**
- Before a quiz reaches the learner, one small extra call to the same model asks which option the explanation supports. The call has no tools, thinking is off where the server allows it, and it allows up to 1024 output tokens.
- If the answer differs from `correctAnswer`, the quiz goes back to the model. Single-select quizzes only.
- **Fail-open:** a 10 s timeout, an error or an unclear reply lets the quiz through.
- **Switch:** `QUIZ_ANSWER_CHECK` in `.env` (owner: server setting, on by default; `false` turns it off). Documented in `DEPLOY.md` and `.env.example`; tests run with it off.
- Files: `src/server/answer-key-check.ts`, `answerKeyCheckPrompt`/`answerKeyMismatch` in `src/core/question-core.ts`, hooked into the probing and teaching quiz tools.

**Verified once on Gemma 4 26B (AI Studio), on three quizzes Gemma wrote earlier:**
- **Wrong key** (TCP flow vs congestion control, key "b" while the explanation backs "a"): **caught** in 5.3 s, and the model was told "the explanation supports option "a", but correctAnswer is "b"".
- **Correct key:** passed in 5.1 s.
- **Doubtful cache quiz** (no option fits its explanation): Gemma deliberated without settling, so the check let it through (fail-open). The check catches keys that contradict the explanation, not questions with no right option.

**Notes:**
- **Google:** Gemma 4 always thinks first there ("Thinking budget is not supported" when asked to stop). The first version allowed 200 tokens, all of them went to thinking, and nothing was checked. Hence 1024.
- **On .126:** the proxy runs with thinking off unless `THINKING=1`, so the check should reply in about a second there. This is not yet measured on .126.
- Google returned 503 "high demand" during testing; two calls hit the 10 s limit because of retries, not because of the check.

### Update 2026-11-19 (end of day): chat images, reminder fix, sidebar filter
- **Chat images go through the vision route** (`f3f5a3d0`). With `LLM_VISION=false` and `VISION_*` set, an image attached in any session (chat, teaching, practice) is described once by the vision model, which is LM Studio directly, not the proxy (the proxy cannot carry images). The description is stored on the message and given to the chat model in place of the picture; the learner still sees the image.
  - Verified with the owner's flow-chart screenshot on local Gemma 4: the model described the five steps. About 21 s on the laptop, including the description.
- **Probing reminder** (`1bb1c6d5`): it now fires only when a probing turn showed nothing.
  - Owner report: the 26B wrote its goal question as a text list, the reminder fired, and the model apologised and asked again.
  - A question written as text can be answered by typing, so it is left alone.
- **Sidebar "Filter by type" follows the session you're in.**
  - Opening a session, or a new Teaching/Practice/Chat draft, switches the filter to that type.
  - A filter picked by hand stays until you move to another session or draft.
  - Checked in the browser, all 6 steps as intended.
- **Tests:** 2154/2154 pass.

## Codex handoff — 2026-11-19

### Branch workflow and committed work

The owner confirmed that development belongs on `claude/pptx-image-reading` and that they will create the PR into `office`. Continue development in its existing worktree at `.claude/worktrees/admin-auth-knowledge-75b74a`. Keep fixes in separate verified commits.

The following follow-up commits are pushed to `origin/claude/pptx-image-reading`.

- `49a9d5af` updates four stale test expectations after the appearance change. The default is now System, and plan outlines/arrows use foreground-aware classes.
- `42e7dbdc` ends a Chat turn after a successful research dispatch. The next model request waits for the research brief through the existing job-delivery flow. Chat's research description and acknowledgement describe this scheduling. A scripted regression test demonstrates that dispatch makes one model request, and a delivered brief permits the next request.
- `a657014b` fixes citations when knowledge search expands a hit with passages from other slides/pages. Expanded results retain their original passages and `search_knowledge` labels each passage with its own location. Existing indexes work with this change.

Local `office` was briefly fast-forwarded during this session. Its push was rejected because remote `office` contained newer commits. After the owner said they would create the PR, local `office` was restored to its starting commit `10f0c34c`. No push from this session changed remote `office`.

### Verification completed

The final code through `a657014b` passed all **2,162 tests**, TypeScript checking, repository lint, the Webpack production build, and the build-artifact check. The full suite required normal Windows filesystem and loopback-network access. Restricted-shell runs prevented the local HTTP vision stubs from receiving requests and produced misleading picture-reading failures.

Browser checks used the existing root `.env`, which points to Ollama's OpenAI-compatible endpoint at `http://localhost:11434/v1` with model `gemma4-e4b-ctx65536`. The owner also showed the user-variable name `GEMINI_API_KEY`; Google's 26B endpoint was not exercised in this session.

Temporary test servers ran the development worktree on port 3001 with Webpack and its production build on port 3002. Both used isolated data under `dist/verification/browser-data` and were stopped after testing. Test launchers, logs, and sample decks are ignored under `dist/verification`.

Browser results covered the following flows.

- Appearance offers System, Light, and Dark. Explicit Light and Dark settings applied, survived reload, and System was restored on the test account. Actual OS preference changes were not triggered.
- The populated Knowledge page retained its light palette after reload, including a saved PowerPoint row. A model-generated Mermaid diagram visibly redrew with readable labels, edges, and arrows in both Light and Dark.
- A new Chat answered a calculation, remembered a code word in a follow-up, and retained the conversation after reload. A new Chat also worked through the production server.
- A PowerPoint saved to Personal Knowledge reached Ready. Teaching used its contents, accepted probe answers, progressed into a generated plan and lesson, and opened an interactive comprehension quiz.
- Practice generated a question from the same deck, graded the submitted answer as solved, and generated another problem when explicitly asked to continue. The Next problem action first returned closing text after a request for one exercise; the current practice doctrine explicitly permits wrapping up a completed arc.
- Live Knowledge retrieval reproduced a real citation error: the sentence on slide 2 was attributed to slide 1 because neighboring passages shared the best hit's label. After `a657014b`, a fresh Chat quoted the sentence and correctly cited slide 2. No JavaScript errors were captured during that retest.

Cold development-route compilation caused visible delays. Warm Chat follow-ups were much faster. One model-generated teaching analogy about a short ruler was inaccurate. The older Chat containing the incorrect slide citation also repeated that old answer without making another search call when asked to search again; the fresh-chat retrieval check verified the corrected tool output.

### Owner's latest report — investigate before changing behavior

The owner subsequently supplied a screenshot from their **Gemma 26B server** showing a neural-networks lesson. They asked for an explanation before changes. No code changes were made in response to this report.

The screenshot shows a previously graded MCQ, subsequent questions written as ordinary text, the literal word `thought` in the transcript, and dashes in the token/context and cost summary. The actual application URL, deployed revision, proxy configuration, and raw completion response still need to be confirmed. The owner identified the model as their Gemma 26B server, distinct from the local Ollama verification above.

Relevant implementation points for the next investigation follow.

- `probeNudgeOwed` in `src/core/native-messages.ts` deliberately accepts a non-empty plain-text response. Commit `1bb1c6d5` added this behavior to avoid repeating a question after the model wrote it as text. It does not require that a question be posed through the interactive tool. The model can therefore bypass the MCQ/free-text question card and its confidence/grading controls.
- The owner remembers the earlier interactive MCQ flow. Confirm their desired behavior before enforcing interactive cards or changing the reminder. A free-response question posed through `ask_user_question` can still use the card; a plain-text question bypasses that mechanism.
- The thinking panel depends on structured reasoning events. `src/agent/models.ts` declares reasoning support from `LLM_REASONING`. The bundled Gemma proxy defaults to thinking off unless `THINKING=1` and translates recognized thought markers into `reasoning_content`. The literal `thought` in the screenshot is a clue to inspect response parsing, not a confirmed diagnosis.
- The first stats dash represents unavailable context/token information; the second represents unavailable cost. Check `components/stats-bar.tsx`, persisted `turns[].steps`, provider usage events, and the proxy's `stream_options.include_usage` handling. Token reporting has not been diagnosed on the owner's deployed endpoint.
- The research-wait fix has deterministic regression coverage. End-to-end web research timing on the owner's Gemma 26B server still needs verification.
- Whole-section retrieval through `open_section` still exposes a single leading citation with merged section text. If a multi-page section produces misleading page-level citations, investigate its location metadata as well as the already-fixed neighbor-search formatting.

The owner requested this handoff and a commit of the completed work. They retain control of PR creation and main-branch integration.

| Shared knowledge index | Operator-configured | Paths are set in the host `.env` by the operator (decided 2026-11-11); empty means off. Currently not wired: `KNOWLEDGE_SHARED_DIR` and `KNOWLEDGE_INDEX_FILE` are not pointed at real directories; only personal uploads work. |

### Upstream fixes taken from amosblomqvist/learnharness (2026-11-23)

The fork point is v0.3.4 (`6cba9c8`); upstream `main` was at v0.7.0 with 607 commits. Upstream work that only applies to the desktop app, subscription logins, Claude Code, plugins, flashcards, drawing pad, themes, or pricing was not taken. Each commit message names its upstream source commit.

Cherry-picked unchanged (or with a test-only trim):
- `3c769309`: math such as `$a<b$` is no longer cut off while a reply streams. The test drops the tool-content renderer case, which this branch does not have.
- `485c51f0`: the chat list sets `pendingProblem`, so the sidebar "Problem waiting" marker shows.
- `ef0075fc`: rendered Markdown does not load remote images.
- `c4f5a09f`, `ca196470`, `6842bd02`, `d2214b4c`, `0a8c0445`: evidence-led probing and confidence calibration in the prober prompts.

Ported by hand:
- Compaction cut walk (from `624c91a4`, compaction parts only; the pricing and usage-meter rework was not taken). The cut follows Pi coding-agent 1.4.0 `findCutPoint`: when the whole history fits in the 20k keep budget, nothing is summarized (the old walk summarized everything), and `compact()` returns early when the cut drops nothing. Failed responses no longer anchor the context estimate, and images count as a fixed 4,800 characters. Tests: `tests/compaction-native-parity.test.ts` (new) and updated cut tests.
- Superseded compaction summaries (`b81f0a34`): when a newer summary is active, older summary markers are not sent to the model again, and the summarizer gets the prior summary once instead of also reading old markers in its span. A summary that stops at the output limit (`length`) is treated as a failed compaction, leaving history unchanged. The controls-audit marker stays filtered from the wire.
- Retry a failed turn (from `a5726759`, `82c6999a`, `5984eb49`, `3b29b5e9`, and the banner part of `671d2c8b`). When a model call fails, the error banner offers **Retry** (en "Retry", ja 「再試行」; banner text is now localized through `chat.somethingWentWrong`). Retry adds no learner message: the failed attempts stay in the saved chat, and only the model's history for that run leaves out the trailing failures (`retryDrops` in `src/core/input-events.ts`). The server refuses Retry with a 400 when nothing failed, or when a compaction landed after the failure ("Send a new message to continue"). The banner is rebuilt from the saved chat, so it also shows after a reload; plan and compaction markers do not clear it. Tool calls inside a failed response no longer get synthesized results. Office adaptations: Retry from a dropped connection calls `stop()` first because this branch's `send()` only runs when ready (upstream solved that in `7d65fa87`, which was not taken), and the call-purpose and turn-failure-memory test cases were dropped. Tests: `tests/retry-failed-turn.test.ts` (new), banner cases in `tests/session-core.test.ts`.

Not taken because this branch already has its own version:
- `ca0ac24c` (re-read the chat before saving the summary): done in Task 6A.
- `e3618cbb` (marker placed before messages saved during the summary): the owner kept the Task 6A behavior, which appends the marker at the end.

Model config (local `.env`, not committed): the chat and vision model is `gemma4-12b-ctx32768`, an Ollama model built from `gemma4-12b-ctx16k` with `num_ctx 32768`, and `LLM_CONTEXT_WINDOW=32768`. A 16k window made the compaction threshold 1 token (window − 16,384 reserve).

Gate (2026-11-23): `npm test` 2,131/2,131 pass; `tsc --noEmit` clean; ESLint clean on changed files.

### Reasoning switch, tool guard, and local speed (2026-11-23)

**Reasoning preference.** Each user has a Reasoning switch on the Preferences page (en "Reasoning", ja 「推論」), default on. It is stored on the account as `reasoning: false` only when off. When off, tutor turns (probe, teach, practice, chat) run at thinking level `off`; compaction, extraction, research and PDF engines keep the configured default. The office model supports exactly two levels, `off` and `medium` (`thinkingLevelMap: { minimal: null, low: null, medium: "medium", high: null }`). The old map had `off: null`, which pi-ai reads as "off unsupported" and clamped up to `minimal`, so thinking never switched off. Every office request carries both thinking signals through `withOfficeThinking` (an `onPayload` hook in `src/agent/models.ts`): on sends `reasoning_effort: "medium"` and `chat_template_kwargs.enable_thinking: true`; off sends `reasoning_effort: "none"` and `enable_thinking: false`. Ollama obeys only `reasoning_effort: "none"`; the Gemma 4 proxy reads `enable_thinking`. Measured on the laptop (Ollama, gemma4-12b-ctx32768): a short answer with reasoning on produced about 500 reasoning characters; off produced none and answered in 1.5 s. Tests: `tests/office-reasoning-preference.test.ts`, `tests/office-thinking-wire.test.ts`.

**Gemma 4 proxy copy.** `deploy/gemma4-proxy/gemma4_proxy.py` is the 2026-11-05 vault copy plus per-request `chat_template_kwargs.enable_thinking`, falling back to `THINKING`. The previous proxy defaults to `THINKING=0`, so the office server probably ran without reasoning; with this copy and the default-on preference, reasoning turns on there. Not run here (no Python on the laptop).

**Probe tool guard.** While probing, the learner can answer only through a question tool. A small model sometimes writes the question as prose and ends the turn without calling one (seen with the 12B model: "(Select the correct option)" and no question card). Tool forcing through the API is not available: Ollama ignored `tool_choice: "required"` in 3 of 3 tries, and the Gemma 4 proxy does not forward it. So the app re-runs instead. `questionRetryOwed` (`src/core/native-messages.ts`) is true when the session has no `probe_done` yet and the last reply stopped normally with no tool call. The server then delivers one `question-retry` marker (id `steer_qretry_<input id>`) through the plan-retry wake pipeline, and the model reads `QUESTION_RETRY_TEXT` (`src/core/contracts/chat.ts`). The transcript shows "Retrying question" / 「質問を再試行中」; the prose reply stays. It fires at most once per learner input, and never in reply to its own nudge. Tests: `tests/question-retry.test.ts` (decision, marker, view) and `tests/question-retry-flow.test.ts` (one nudge delivered end to end, no second nudge).

Gate (2026-11-23): `npm test` 2,151/2,151 pass; `tsc --noEmit` clean; ESLint clean on changed files.

**Local Ollama tuning (laptop only, not in the repo).** `OLLAMA_KV_CACHE_TYPE=q8_0` and `OLLAMA_FLASH_ATTENTION=1` are set as user environment variables. On the 8 GB RTX 5060 the 12B model then fits 35 of 49 layers on the GPU instead of 33; generation is about 11.5 tok/s. A variant without the speculative draft model was slower (about 9.3 tok/s) and was removed.

### Evaluation fixes (2026-11-24)

Fixes for Codex's evaluations (`docs/evaluations/2026-11-23-summary.md`, `docs/evaluations/2026-11-24-bug-register.md`). Owner decisions were taken through questions on 2026-11-24; decisions Claude took alone while the owner was away are listed at the end.

- **Build and lint (BUILD-01).** The webpack `WasmHash` crash came from a corrupt 1.1 GB persistent cache in `.next/cache/webpack`; with that cache removed, `npm run build` and the artifact check pass (documented in DEPLOY section 7). The old cache copy was deleted after the fix was confirmed. The four lint errors were knowledge map/section imports that skipped the barrels (`8d109337`).
- **Mixed PDFs (RAG-01).** Pages without a text layer are OCRed even when other pages have text; native text is kept per page (`78676aad`).
- **Tables (RAG-03).** Every split piece of a large table repeats the header row (`aec21e0c`, `ceb86d72`).
- **Citations (RAG-04).** Search widens a hit only with neighbors from the same page, slide or heading (and the same OCR/image flags); MD/TXT results widen their line span (`0b6e504d`).
- **OCR numbers (eval P2).** OCR citations reach the tutor as "(OCR, verify exact numbers)" (`c0f1e226`).
- **Image descriptions (RAG-02, RAG-05).** Vision requests run with thinking off, 1,536 tokens, 180 s timeout. With `VISION_BASE_URL` and `VISION_MODEL` set, personal and shared uploads return after text indexing and describe images in the background; descriptions are chunked under the document's own id right after their page and replace the document's chunks through the same serialized queue. The upload route hands its index result to the store, so the file is indexed once (`9492f050`). Measured on the laptop: ZCU208 pages 6 and 19 described in 46–51 s, ~700 tokens; the manual has 28 images.
- **Graph layout (GRAPH-01).** The settle computes in a worker thread (`src/core/layout-runner.ts`, `layout-worker.ts`); settles and drag commits are serialized. At 1,000 nodes the event-loop stall fell from 1,074 ms to 15 ms. The built worker chunk runs under `node` directly (`1b2f1d78`).
- **Lost reply (CHAT-01).** All store renames retry EPERM/EBUSY/EACCES for up to ~0.8 s (`4ac845f5`).
- **Compaction (MEMORY-01, MEMORY-02).** The kept tail is at most half of what the threshold leaves after the system prompt (about 3.2k tokens for the teacher on a 32k window, `2787e724`). The summary gains "Details to keep exactly", with only the latest value of a corrected detail (`0318aac3`); one live 12B check kept `MAPLE-7319 (replaced CEDAR-4826)`.
- **Teach quiz (TEACH-01).** A teach quiz/explain call without `type` defaults to `check` (`2365db5b`).
- **Practice (PRACTICE-01).** `conclude` refuses `movedOn`/`surrendered` unless the learner sent their own message since the pose (`c09d87b0`).
- **Probe (FLOW-01).** A second `probe_done` in one turn is refused (`2e34b3a6`).

Not changed (proposals only, in the bug register): CONTENT-01 (false worked steps), QUESTION-01 (equivalent-amount distractors), SPEED-01 (latency attribution), UI-01 (named search receipts). These touch the owner's teaching prompts, measurement plan, or UX.

**Decisions Claude took without asking (owner away, 2026-11-24):**
1. DOCX image descriptions go after all text (DOCX images carry no real position).
2. Chat-attachment uploads (`destination: "chat"`) get no image descriptions; `npm run index:shared` describes inline.
3. Vision requests always send the thinking-off fields, whatever `LLM_REASONING` says.
4. The neighbor "place" key includes the OCR and image-description flags, so a description never merges into page text.
5. A table header longer than half the split budget is not repeated.
6. Layout settles and position commits share one process-wide queue; a settle reruns up to 3 times if nodes change mid-compute.
7. The test suite settles inline (`NODE_ENV=test`); only `tests/layout-worker.test.ts` starts the worker (`LH_LAYOUT_WORKER=1`). An idle worker sometimes kept a test process alive.
8. Rename retry: 6 retries, 10–400 ms backoff, applied to every store rename including accounts and knowledge snapshots.
9. Kept tail = min(20k, (threshold − system prompt) / 2).
10. Missing quiz `type` defaults to `check`, matching how the UI already shows typeless calls.
11. The practice end-condition treats any plain learner message after the pose as a possible request to end; answer commits never count.
12. Lint runs clean only when `tmp/` is excluded (Codex's running copy of the app lives there); the ESLint config was not changed.

Gate (2026-11-24): `npm test` 2,178/2,178 pass; `tsc --noEmit` clean; `eslint . --ignore-pattern "tmp/**"` clean; `npm run build` and artifact check pass.

**Cleanup (2026-11-24).** Three test processes left hanging by the stopped run that first exposed the layout-worker exit hang (decision 7 above) were stopped, and the 1.1 GB corrupt webpack cache copy was deleted. No other process or file was touched.
