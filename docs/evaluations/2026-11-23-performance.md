# Performance evaluation - 2026-11-23

Exploratory local measurements, not approved service budgets or production capacity. Runtime HTTP tests used a development build of the committed source snapshot because the production build failed. Warm HTTP samples exclude initial route compilation. Module benchmarks ran in separate Node processes; other machine activity was not controlled.

## Prepared retrieval

Refreshed run, 30 searches per size, repeating the manual's chunks with distinct synthetic IDs. Tokenization/preparation occurs before timed searches; full filesystem/network/provider work is excluded.

| Chunks | Preparation | Search p50 | Search p95 |
|---:|---:|---:|---:|
| 153 | 7.87 ms | 0.26 ms | 0.41 ms |
| 1,530 | 70.09 ms | 1.14 ms | 3.10 ms |
| 15,300 | 618.72 ms | 15.00 ms | 17.62 ms |

The final process RSS at the largest stage was approximately 520 MiB, after parsing/OCR and all preceding allocations. This is not a per-query allocation or measured peak. Repeated document text and warm prepared data limit generalization. These results do not identify ranking as the primary observed latency bottleneck.

## Warm HTTP requests

30 sequential samples per endpoint with one uploaded manual and otherwise small synthetic state; zero HTTP errors in the valid requests.

| Endpoint | p50 | p95 | Maximum |
|---|---:|---:|---:|
| Chat listing | 23.03 ms | 30.37 ms | 32.90 ms |
| Document listing | 20.38 ms | 60.11 ms | 69.92 ms |
| Knowledge map | 20.09 ms | 45.88 ms | 46.55 ms |
| Empty graph | 24.01 ms | 68.57 ms | 99.82 ms |
| Jobs with valid owned chat ID | 27.45 ms | 97.77 ms | 342.13 ms |

Initial page request wall times included development compilation and redirects and are not reported as production navigation performance. No browser interaction-delay or frame-rate data was captured.

## Synchronous persistence

30 samples per operation on synthetic chats with approximately 1,000 characters per message. `saveMessages` rereads and atomically rewrites the full record, including fsync.

| Messages | File bytes | Read p95 | Save p50 | Save p95 |
|---:|---:|---:|---:|---:|
| 20 | 23,861 | 1.32 ms | 3.09 ms | 5.07 ms |
| 200 | 236,722 | 3.64 ms | 5.20 ms | 8.04 ms |
| 1,000 | 1,183,123 | 4.43 ms | 9.19 ms | 13.90 ms |

One 20-message save was a 158.28 ms outlier. Loading summaries of 33 synthetic sessions took p50 **63.51 ms**, p95 **83.70 ms**, maximum **120.99 ms**, because the list path reads/project records. These observations motivate profiling repeated list requests; they do not establish that a database migration is necessary.

## Graph layout and cross-user impact

Default 300-tick `incrementalLayout`, synthetic connected graph, three samples per size:

| Nodes | Samples | Maximum timer blockage |
|---:|---|---:|
| 100 | 51.29 / 72.48 / 53.26 ms | 72.60 ms |
| 1,000 | 738.50 / 902.55 / 1,090.90 ms | 1,093.46 ms |
| 5,000 | 11,812.58 / 11,591.94 / 11,618.83 ms | 11,814.09 ms |

All positions were finite and counts matched inputs. Three samples are insufficient for a meaningful p95, so individual samples are reported.

Live isolated-server confirmation: 1,000 synthetic propositions, 999 chains, empty initial account graph. A position commit that triggered settling took **1,354.21 ms**. Another user's five overlapping preference requests took **1,342.35 / 1,318.20 / 1,205.26 / 1,113.82 / 1,019.82 ms**, compared with five idle samples **87.75 / 44.94 / 52.31 / 38.63 / 29.93 ms**. This directly demonstrates server responsiveness impact across users. Public graph API node/edge counts are not assumed to equal the internal derived layout-node count.

## Ingestion and provider observations

- Manual: 4,363,035 bytes; direct index **13.98 seconds** in refreshed diagnostics; personal HTTP upload/index **28.50 seconds** in one separate run. Different overhead/cache conditions prohibit a precise speedup claim. Source confirms two indexing calls on that explicit-destination route.
- Duplicate upload: **42.87 ms** in one run; stored content-hash deduplication reused document identity.
- Full-page visual description: page 6 yielded no description near 30 seconds; page 19 timed out at 30 seconds. A diagnostic page-6 retry with a longer observation window finished at **34.04 seconds**, but all 512 completion tokens were consumed before final content; the response carried reasoning and `finish_reason=length`.
- Five-part RAG answer: approximately **73.2 seconds** from durable input to final record update, three retrieval calls, one run overlapping other control work. No isolated inference/queue breakdown is claimed.
- Recovery control: acknowledgment **141 ms**; first observed text **7.42 seconds** after stream attachment; replay text **151 ms** after reattachment; reply after abort **8.53 seconds** total with first text **7.90 seconds** after attachment. These are single samples with different model work, not percentiles.
- Japanese SD answer **23.43 seconds**; four-part abstention answer **18.56 seconds**, one sample each.

## Next measurements

Prioritize layout scheduling, per-request indexing invocation counts, visual-description output/timeout policy, and list/persistence work under larger real histories. Approve concrete behavior-preserving changes and responsiveness budgets before implementation. Production tracing, browser long tasks, upload peak memory, multi-process caches/queues, restart-under-load, and a 30-minute production soak remain open; a development-mode run cannot establish production readiness.

Raw evidence: `tmp/evaluation/performance-results.json`, `live-graph-results.json`, `rag-results.json`, `http-results.json`, `recovery-results.json`, `vision-results.json`, `vision-page6-response.json`, and `answer-boundaries.json`.
