# Content, long-conversation, latency, and UI evaluation

Recorded: **2026-11-24 01:12 JST / 2026-11-23 16:12 UTC**. Evaluation only; no application fixes implemented by this evaluator. The user requested **record and propose**, with Claude reviewing in parallel. See the [timestamped bug register](2026-11-24-bug-register.md) for proposed fixes and verification criteria.

The app preserves useful context across a sampled 20-turn conversation and can display thinking and cited answers. It does **not** yet meet a reliable end-to-end teaching/chat acceptance gate: explanations contain factual errors, compaction loses a corrected session detail, a teacher quiz fails validation twice, practice ends after an incorrect answer, and a persistence failure loses a generated reply from saved history.

## Scope and provenance

- Runtime: isolated development app at port 3108, archived commit `5fc583ffc8b1ebcf0d1e0956e9dc485946efc634`, synthetic accounts/data, existing configured model endpoint. The main app on port 3000 was not the test target.
- Live tests: 20 sequential learner turns; adaptive probe with one intentionally wrong and three correct submissions; recovered plan approval and first teaching step; wrong/correct practice controls; reasoning plus knowledge search; two turns against a seeded 160-message long-context history; native-browser thinking and citation checks.
- Headless client uses the actual `components/session-core.ts` SessionModel, including streamed tool-part and status projection. It is not a browser rendering/FPS benchmark.
- Current root-workspace RAG and graph changes appeared during evaluation and were left untouched. These runtime results **do not verify those uncommitted changes**.
- Raw scripts, JSON, and logs: `tmp/content-evaluation/`. Test account files contain temporary credentials/cookies; do not publish them. Retain sanitized evidence and scenarios when handing bugs to another reviewer.
- After the run, the isolated port-3108 server was stopped and its archived source/build directory removed, with dependency junctions detached safely. Raw evidence, synthetic data, scripts, and the source archive remain. Recreate the snapshot from the recorded commit before rerunning the server; the user's main app was preserved.

## Content quality and continuity

All 20 natural-conversation turns completed without a recorded client error. The conversation stayed on beginner fractions, retained the pizza preference and corrected review label `MAPLE-7319`, and resisted a request to mark an incorrect answer correct. After a two-sentence preference was explicitly reinforced, subsequent replies generally followed it; the initial request for concise replies produced long responses.

Manual review found errors that an answer-only accuracy check would miss:

| Evidence | Finding | Assessment |
|---|---|---|
| `conversation-04.json` | Writes `6/8 ÷ (2/2) = 3/4` | False worked equation: dividing by one leaves 6/8. The final reduced fraction is correct. |
| `conversation-05.json` | Correctly obtains `2/3 + 1/6 = 5/6`, then calls the starting 2/3 a half-pizza | Analogy contradicts the arithmetic. |
| `conversation-10.json` | Says all sampled mistaken sums are smaller than the starting amount | False: `2/6 = 1/3` and `2/10 = 1/5`, so two examples equal the starting amount. |
| `conversation-12.json` | Gives `3/6` | Correct equivalent answer to 1/2; not counted as an arithmetic error. |
| `conversation-14.json` | Refuses to endorse the requested incorrect answer | Correct resistance to learner pressure, although the explanation has imprecise comparison wording. |

This is a small fraction-teaching sample, not a general model-accuracy percentage or coverage of other subjects.

## Questions, grading, and teaching progression

The probe initially produced a question in prose; the automatic question-retry subsequently created a real answer card. After allowing that follow-up to settle, four controlled submissions showed one wrong answer graded false and three correct answers graded true. Independent review confirmed the canonical keys for the three sampled questions: 2/3 is greater than 2/6, 1/4 + 1/4 = 2/4, and 1/2 + 1/3 = 5/6.

One addition question included a distractor saying `1/4 + 1/4 = 1/2 (by adding the bottoms)`. Its numerical amount is equivalent to the keyed 2/4, but its rationale is false. That is a misleading distractor for an amount question; it is not evidence that both complete option statements are true.

The final probe submission called `probe_done` twice, duplicated completion prose, and encountered a Windows `EPERM` rename error. An automatic follow-up **recovered** and created a coherent plan: fraction meaning → naming → common denominators → addition → goal. A later explicit Retry was correctly rejected because no failed tail remained. Do not report a permanent handoff failure from that stale Retry request.

After approval, the teacher stayed on the first `truth` node and used pizza examples, but called `quiz` twice without the schema-required `type`. Both tool results were validation errors. It then displayed a prose question with the correct key; there was no valid pending question card, so the planned next answer could not be submitted through the question flow. Evidence: `teacher-after-plan-1.json` and `teacher-after-plan-summary.json`. Its statement “a fraction is not a single number” is also an overstatement: a fraction represents a number, even when taught through count and piece-size roles.

Initial headless attempts that sent “continue” rather than answering a prose question, or collided with an automatic follow-up, were evaluator limitations. They are excluded from grading and browser-defect claims.

## Practice and durable history

For `1/2 + 1/4`, the posed problem's committed solution was correctly 3/4. On a wrong learner answer `2/6`, the model recognized the denominator mistake but called `conclude` with `outcome: movedOn` and `retest: true` without the learner requesting an end. This contradicts `src/agent/prompts/practice/10-doctrine.md`: give a minimal nudge and remain active until solved or explicitly ended. The conclude completed at approximately 175.9 seconds, **before** the evaluation's 240-second abort guard. Later prose was aborted by the evaluator and is not a completed native response. Evidence: `practice-quality-wrong.json`.

In a separate correct-answer control, the client received nonempty streamed text after submitting 3/4, but the reply never appeared in the durable record. The server logged `persist failed: EPERM ... rename` in `persistTurn`; a later record read still had only the original four messages and no assistant reply/conclusion, with `turnInFlight: false`. Evidence: `practice-positive-answer.json`, `practice-positive-late-record.json`, and `server.log` for chat `chat_mwtgh7ot_c21ee5e5`.

This is a **streamed-versus-saved history mismatch**, not proof that the model graded 3/4 incorrectly or simply forgot a tool. The harness did not retain the full transient client text, so the exact generated verdict is unavailable. At least two rename failures occurred across the probe and practice scenarios. Their underlying OS/locking cause has not been established.

## Actual context compaction

`long-context.mjs` seeded 160 synthetic messages, estimated 24,589 tokens, then made two real model turns. This is a stress fixture, not a naturally generated 160-message conversation. The early label was changed from `CEDAR-4826` to `MAPLE-7319`; both messages were inside the summarized span.

The first real compaction omitted both labels. The assistant then invented “Synthetic practice note 78” as the current label while retaining the broad learning goal, pizza example, and corrected misconception. The 20-turn conversation's successful recall therefore does **not** establish recall after compaction.

The effective threshold was 16,384 tokens (32,768 context minus reserve), while the retained-tail setting was 20,000. The first compacted projection remained about 20,765 estimated tokens. Logs subsequently reported that the kept tail alone exceeded the threshold; an anti-churn guard exists, so this is not evidence of an infinite loop.

First-turn acknowledgement took 158.9 seconds; the second took 172.8 seconds, including the compaction/start gate under concurrent model load. The first turn completed in 238.7 seconds. The second produced no final answer before the evaluation's 240-second intervention and recorded `stopReason: aborted`. A ready client state after that abort is not a successful completion. Evidence: `long-context-summary.json`, `long-context-1.json`, `long-context-2.json`, and `server.log`.

## Response latency and UI feedback

Twenty completed conversation turns, milliseconds converted to seconds:

| Measurement | Median | p95 | Maximum |
|---|---:|---:|---:|
| POST acknowledgement | 0.138 s | 0.782 s | 1.003 s |
| First visible answer text in SessionModel | 14.845 s | 131.099 s | 132.951 s |
| Whole evaluated turn, including settle checks | 39.475 s | 137.786 s | 138.859 s |
| Wire text → client-state projection | 0.00035 s | 0.01595 s | 0.12349 s |

These runs overlapped other users, long-context summarization, and dev compilation, and had different output lengths. They describe this loaded experiment, **not** isolated single-user latency, provider-only generation time, production performance, or an agreed SLO. The median first answer is already a noticeable wait, and the tail is severe. Attribution needs serial and concurrent reruns with queue, compaction, inference, and rendering timings separated.

In the reasoning/search scenario, thinking reached client state about 13 ms after its first wire event; answer text followed its wire event by about 1.7 ms. The search tool progressed from input-streaming to output-available in about 91 ms. Total turn duration was about 198 seconds, with first thinking at 169 seconds, under the same loaded conditions. Fast projection after data arrives does not make the upstream wait fast. Evidence: `thinking-tool-feedback.json` and `timing-summary.json`.

After the user logged into the dedicated test app, native-browser observation confirmed:

- Working/Thinking while generation was active; expandable completed thinking; Stop returning to Send on completion.
- A correct three-sentence fraction explanation.
- The knowledge control enabling office knowledge and a correct cited synthetic reference code, `VIOLET-9063`.
- Canceling an abort confirmation allowed generation to continue.

Cold development route compilation visibly delayed navigation; that cannot establish a production navigation defect. The brief live search card was not visually sampled. Headless state confirms tool transitions; source inspection shows `search_knowledge`/`open_section` use generic Working activity and have no settled artifact renderer in `components/artifacts/index.ts`. Whether to add a persistent named receipt is a UX decision, not an approved fix. Browser animation/FPS, long-history scrolling, and all tool types remain unverified.

## Automated coverage and remaining acceptance

A focused command ran the existing compaction, question/answer, probe handoff, stream activity, tool-part, reasoning-preference, and streaming-math tests: **234 tests / 51 suites passed, zero failures/skips**, exit 0. Files: `compaction.test.ts`, `compaction-service.test.ts`, `compaction-native-parity.test.ts`, `question-core.test.ts`, `question-tools.test.ts`, `question-retry-flow.test.ts`, `probe-done.test.ts`, `stream-activity.test.ts`, `tool-parts.test.ts`, `office-reasoning-preference.test.ts`, `render-streaming-math.test.tsx`. Invocation: `node --import tsx --import ./tests/bootstrap.mjs --test <listed test paths>`. Logs: `focused-tests.log`, `focused-tests-result.json`.

Those checks do not validate generated explanations, guarantee semantic compaction retention, or close the live failures above. Concurrent root edits also mean this is not a release gate for the current working tree. The [earlier evaluation](2026-11-23-summary.md) still governs the PDF/RAG findings and failed production build. A production soak, diverse held-out question corpus, long natural conversation with real compaction, and complete browser rendering/accessibility coverage remain open.
