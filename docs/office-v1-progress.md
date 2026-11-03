# Office v1 pilot progress

Plan: `docs/superpowers/plans/2026-11-02-office-v1-pilot.md`

Last update: 2026-11-03. The implementation is in progress; no host acceptance has been performed.

| Acceptance item | Status | Evidence / next gate |
|---|---|---|
| 1. Deployment | In progress | `npm test` 1,732/1,732, `npm run typecheck`, and `npm run build` pass locally. Build artifact check passes and the former dynamic filesystem tracing warning is gone. systemd and `.126` checks pending. |
| 2. Auth | Locally verified | Account/session/rate-limit tests pass; all API paths are checked by the proxy gate test. `/login`, `/signup`, and `/source` are public. Host acceptance pending. |
| 3. Isolation | In progress | `storesForUser`, checked owner stores, owner-qualified events/turn/extraction/job registries, and approval ownership are in place. Focused graph and scope tests pass (29/29); the new focused auth/store/ownership tests also pass in the full run. Both maintenance scripts now require `--user <username>` and use `storesForUser()`. |
| 4. Teaching and practice | In progress | Practice and prompt parser/stream adapter tests pass. Researcher, visual, and local PDF jobs have passing focused tests. Real LLM smoke and bilingual full session pending. |
| 5. UI languages | Pending | Auth forms have initial English/Japanese copy; full localization and dynamic `<html lang>` pending. |
| 6. Office knowledge | Pending | Indexing, upload, retrieval, and citation work pending. |
| 7. Web research | In progress | Researcher background job re-enabled with explicit owner and checked per-user stores. URL-only mode registers `web_fetch` without `web_search`; learner and search-result URL provenance tests pass (3/3). Proxy and approval integration need further verification. Search deferred when provider is `none`. |
| 8. Outbound traffic | Pending | Host observation pending. |
| 9. `/source` | Pending | Archive route and inspection pending. |
| 10. Concurrency | Pending | Three-user host exercise pending. |

Latest local checks: `tsc --noEmit` passes. `npm run build` passes with the post-build artifact check and no graph tracing warnings. Full `npm test` ran 1,805 tests: 1,718 passed and 87 failed. Failures include stale configurable-provider/model and demo/research expectations, plus retained practice, import, and UI assertions that still need updating or repair. Focused graph/scope tests pass (29/29). The tests that pass include new auth, store-construction, user-store, background ownership, events ownership, and approval ownership coverage. `My background` has been added to the requested scope and is not implemented yet.

2026-11-03 update: line endings were committed alone as `41bdd56` (`normalize line endings (no code changes)`). A later full run counted 1,783 tests: 1,709 passed, 74 failed. After that run, focused researcher/web tests pass (16/16), and owner-scoped import route tests pass (3/3); these changes have not yet been reflected in a new full-suite count. The original A/B/C table below remains the audit of the 87-failure baseline, not a reclassification of the 74-failure run.

Latest gate after the researcher and test migration: **1,732/1,732 tests pass; typecheck passes; production build and artifact check pass without tracing warnings.** The 87-failure baseline remains classified A 48, B 36, C 3. The three C practice failures were fixed in production code. Research, visual, local PDF, import, model catalog, removed-tool registry, and UI expectation tests now pass under the fixed office design. The net test-count reduction includes cloud-provider matrix and removed demo/setup cases; focused fixed-office and URL-provenance tests were added. This green local gate does not establish the ten-item host acceptance checklist.

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
| 3 Isolation | Per-user stores and owner-scoped job/approval tests present; graph extraction ownership should be re-audited before deployment. |
| 4 Full teaching/practice | Existing local flow tests pass; real LLM tool-call run pending. |
| 5 English/Japanese UI | Preference and session teaching language wiring begun; full UI translation and missing-key audit pending. |
| 6 Office knowledge | Indexing, extraction, retrieval, citations, upload, and provenance behavior pending. |
| 7 Web research | URL-only provenance and researcher job tests present; `web_search` deferred for `SEARCH_PROVIDER=none`; proxy/approval UI/live verification pending. |
| 8 Outbound traffic | Local audit pending. |
| 9 `/source` | Pending. |
| 10 Concurrency | MAX_CONCURRENT_LLM and three-user live load test pending. |

**Next in approved order:** finish full i18n (#5), then office knowledge (#6, including setting sticky `knowledgeUsed` on actual retrieval), web toggle/approval behavior (#7), `/source` (#9), deployment docs/systemd, and `.126` acceptance. Remove legacy prohibited source paths and complete the registered-tool allowlist test. The account `background` must be passed to measure/plan/teach only for that owner; the current foreground build passes it, but verify practice and async behavior as part of the final language audit. Do not claim v1 completion from the local gate.
