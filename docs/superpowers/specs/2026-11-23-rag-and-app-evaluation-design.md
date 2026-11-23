# PDF RAG improvement and application evaluation design

Status: evaluation authorized by the user's "evaluate" request on 2026-11-23; implementation choices remain proposed for human review. This document authorizes no implementation choices by itself. Executed results and outstanding checks are in `docs/evaluations/2026-11-23-summary.md`.

## Intent

Improve answers based on PDF tables and images, and evaluate whether the application's principal workflows work correctly and remain responsive. Find bottlenecks through reproducible measurements before selecting optimizations.

The user requested an improvement plan, allowed choosing a test document, and expanded the plan to include evaluation of other application features, smooth operation, and bottlenecks. The user has not yet selected a parser architecture or approved implementation.

## Existing evidence

- `src/knowledge/parsers/pdf.ts` returns immediately when any page supplies text; OCR is therefore skipped for remaining scanned pages.
- PDF extraction produces page text rather than table blocks. `src/knowledge/chunk.ts` has table-specific splitting, but does not repeat table headers when splitting.
- `src/knowledge/parsers/pdf-images.ts` extracts embedded raster image objects; this does not establish coverage of vector diagrams or complete page layouts.
- Personal storage, the upload route, and the shared-index script call `indexKnowledgeDocument` without its optional vision configuration.
- `src/knowledge/service.ts` creates image chunks with `sourceId = documentId + "-img"`; `src/knowledge/index-store.ts` requires a 64-character hexadecimal source ID matching a ready document. Enabling vision requires addressing this mismatch.
- `src/knowledge/search.ts` can merge neighboring chunks across pages while retaining the best hit's single citation. Evaluate attribution at the individual evidence passage level.
- On 2026-11-23, `node --import tsx tmp/pdfs/baseline-rag.mjs` completed successfully outside the Windows sandbox: 153 chunks, zero image-description chunks. All five sample queries retrieved the expected page within the top eight hits. These are retrieval observations, not answer-accuracy results.
- The benchmark script's `tableTaggedChunks` field is not a valid table-preservation metric: `KnowledgeChunk` currently has no `kind` field. Measure extracted blocks and actual cell/header preservation instead.
- `docs/office-v1-progress.md` contains historical local results and explicitly pending host acceptance. Those results are not current verification of this branch or deployment.

## Approaches awaiting selection

1. **Extend the existing TypeScript pipeline first (recommended proposal).** Reuse PDF.js, OCR, vision configuration, filesystem snapshots, and the ranker boundary. Benchmark table extraction before committing to a larger parser dependency. This reduces deployment changes, but difficult layouts may need additional parsing capability.
2. **Introduce a separate document parser service.** Evaluate a candidate such as Docling against the same corpus before adopting it. This adds another runtime, deployment and failure boundary; compatibility, licensing, resource consumption, and actual accuracy must be checked against current primary documentation and measurements.

No approach has been selected by the user. The implementation plan records gates rather than treating the recommendation as approval. Embeddings and reranking are conditional follow-up work if extraction-correct evidence remains difficult to retrieve.

## Goals and boundaries

- Preserve exact values, row/column associations, units, footnotes, figure labels, and page citations.
- Cover native-text, scanned, mixed, vector, and image-based PDF evidence.
- Evaluate extraction, retrieval, answer correctness, abstention, and citations separately.
- Evaluate login, sessions, tutoring, practice, graph, knowledge, jobs, language preferences, and failure recovery.
- Measure browser responsiveness and server/provider performance separately.
- Preserve personal/shared ownership, authorization, audit records, accepted formats, and recoverable persisted data.
- Produce a prioritized, evidence-backed backlog; implement only approved fixes in bounded follow-up tasks.
- Avoid a database replacement, new external service, model/provider change, concurrency-policy change, or UX redesign without a specific approved decision.

## Benchmark and evaluation design

Use `docs/ug1410-zcu208-eval-bd.pdf` as the primary real-document corpus. It is currently untracked; record its SHA-256 and document version and avoid silently committing the full manual. The rendered pages already inspected are PDF pages 6, 17, and 19. Add synthetic fixtures for precisely controlled OCR, layout, and failure cases. Other repository PDFs may provide held-out cases after inspection; do not claim performance generalizes from one manual.

Proposed initial corpus: 30 questions, comprising 8 table questions, 6 diagram/image questions, 4 ordinary text controls, 4 scanned/mixed-page questions, 4 ambiguous/unanswerable questions, and 4 English/Japanese retrieval variants. Each question records gold evidence and page(s), acceptable answers, answer category, and its development/held-out assignment before tuning. Compare every candidate against the same baseline and held-out cases.

Evidence examples visually checked:

| Case | Expected evidence | PDF page |
|---|---|---|
| SW2 SD boot, switch order [4:1] | OFF, OFF, OFF, ON | 19 |
| Default boot mode | QSPI32; default identified by note 1 | 19 |
| J17 default | OFF; sequencer normal operation | 17 |
| ADC connector | RFMC CONN. 1 | 6 |
| PS DDR4 SODIMM width | 64-bit | 6 |

Proposed gates, pending human approval: all five verified anchor questions exact and correctly cited; 100% exact values on the designated critical-value subset; at least 90% gold-evidence recall@8 and answer correctness overall; all designated unanswerable cases abstain; no cross-user access or lost/duplicated persisted actions. Report denominators and per-category results. A vision-generated description is not ground truth; inspect original page evidence when scoring.

Performance targets must be agreed after collecting a baseline on the intended machine. Record p50/p95/max, request counts, errors, memory, event-loop delay, queue wait, and provider time. Do not invent a universal generation-time threshold for an unknown model/host. Separate proposed product budgets from measured regressions.

## Deliverables and approval

The companion plan defines three workstreams: RAG evaluation/improvement, whole-app functional evaluation, and responsiveness/bottleneck evaluation. Evaluation reports must distinguish measured failures, static risks, passed checks, and unavailable checks. No production rollout or reindexing occurs merely because this plan exists.

Before implementation, obtain approval for the approach, acceptance targets, vision endpoint policy, indexing execution/status behavior, evidence/citation representation, and any new dependency or provider. Follow `AGENTS.md`: investigate, plan, obtain approval, then implement. Before Next.js code changes, read the relevant installed guide under `node_modules/next/dist/docs/`.
