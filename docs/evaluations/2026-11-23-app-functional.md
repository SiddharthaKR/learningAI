# Functional evaluation - 2026-11-23

Run against an isolated development instance of commit `5fc583ffc8b1ebcf0d1e0956e9dc485946efc634` at `127.0.0.1:3107`. Three synthetic accounts and their test data were used. No existing user accounts or documents were changed.

## Executed checks

`tmp/evaluation/http-results.json` records **40/40 passing** HTTP checks after correcting the evaluator to follow the actual request contract. `tmp/evaluation/recovery-results.json` records another **7/7 passing** recovery/practice checks. These counts cover scenario assertions, not an exhaustive product test suite.

| Area | Observed behavior |
|---|---|
| Accounts | Three signups; correct login/logout behavior; wrong password denied; Japanese preferences persisted |
| Authentication | Anonymous chat, knowledge, map, jobs, and graph API access rejected with 401 |
| Ownership | Other users could not read private chats or personal document sections; personal listings stayed isolated; concurrent responses stayed with their owners |
| Knowledge | Manual upload ready; duplicate bytes returned same document ID; unsupported format rejected; malformed PDF reported rejected; shared synthetic text visible to another account |
| Session controls | Knowledge ON and personal scope persisted; Web OFF preserved |
| Sections/map | Personal section read returned 200 with explicit truncation at 12,000 characters; unauthorized owner received 404; knowledge map requests succeeded |
| HTTP pages | Home, knowledge, preferences, settings redirect, and chat page resolved to HTTP 200; browser rendering not verified |
| Concurrency | Three independent live control chats returned the expected account-specific strings and settled |
| Streaming | Live text arrived; reader cancellation kept turn running; new attachment replayed output; explicit abort settled; a subsequent message completed; original user input remained single |
| Practice | Actual `problem` tool created 2 + 3 exercise; normal thinking submission of 5 led to actual `conclude` verdict `solved` |
| Source export | Public source archive response 200 with gzip; archive contents checked separately |

## Live answer inspection

The English five-part PDF question called `search_knowledge` three times, marked knowledge used, settled, and answered:

| Fact | Expected and observed | Required PDF page |
|---|---|---|
| SD boot SW2 [4:1] | OFF, OFF, OFF, ON | 19 |
| Default boot mode | QSPI32 | 19 |
| J17 default and meaning | OFF; sequencer normal operation | 17 |
| ADC connector | RFMC CONN. 1 | 6 |
| PS DDR4 SODIMM width | 64-bit | 6 |

Original page renders were the reference. This was a single combined run, not five independent model trials. Supplemental page-18 references were not independently scored in this run.

The Japanese SD-boot answer correctly preserved switch order/values, mode `1110`, OFF=High/ON=Low, and page 19. Four questions about the current physical board's serial number, temperature, measured ADC noise floor, and current switch positions were all declined as unavailable. That abstention run made no retrieval call, so it establishes answer restraint only, not document inspection.

## Evaluator corrections

The first temporary script incorrectly treated `POST /api/chat` as the response stream. The actual contract is an immediate JSON acknowledgment plus `GET /api/chats/[id]/stream`; corrected capture refetched the durable records and verified terminal streams. It also omitted `chatId` from the jobs endpoint. A 400 on that invalid request is correct behavior. Initial false failures and those invalid timing samples are excluded from the final results, with the initial report retained separately for audit.

## Unverified

Browser hydration, visual layout, scrolling, focus/keyboard behavior, rich math/code/Mermaid rendering, and graph frame rate were not inspected. Browser host access was unavailable and automatic review rejected selecting unrelated private Chrome content. Dedicated-window approval remains pending.

Real prober-to-teacher lessons, graph extraction/auditing, all background-agent types, web search approval flows, process restart recovery, and real long-history compaction were not live-tested. The full automated suite passed, but its mocks and fixtures cannot substitute for these live scenarios. No production or deployed-host acceptance is claimed.
