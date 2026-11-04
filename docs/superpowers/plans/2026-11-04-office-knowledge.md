# Office Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure bilingual office-document extraction, local BM25 retrieval, isolated personal uploads, a read-only shared index, and session-scoped knowledge tools with precise citations.

**Architecture:** Format parsers produce citation-bearing text blocks behind one document-extraction interface. A character/word BM25 implementation indexes those blocks and is exposed only through a `Retriever` interface. Personal index state lives under `storesForUser(userId).root`; the configured shared index is an immutable JSON snapshot opened read-only by the web process.

**Tech Stack:** TypeScript, Node.js, `pdfjs-dist`, `fflate@0.8.3`, `fast-xml-parser@5.12.0`, Next.js 16.3, filesystem JSON snapshots.

**Spec:** `docs/superpowers/specs/2026-11-02-office-v1-pilot-design.md`

## Global Constraints

- Accept only PDF, PPTX, DOCX, MD, and TXT. Reject every other format with a clear message.
- Reuse the existing local PDF implementation and preserve stable 1-based page citations. OCR is out of scope.
- ZIP preflight limits are 2,000 entries, 100 MiB total declared uncompressed size, and 16 MiB declared size for any selected XML entry.
- Extract only allowlisted PPTX/DOCX XML and relationship paths. Streaming extraction also enforces 100 MiB actual selected output and 16 MiB actual output per selected entry, aborting on the first excess.
- Reject XML containing `DOCTYPE` or `ENTITY` declarations before parsing and configure `fast-xml-parser` with `processEntities: false`.
- Personal document writes and personal indexes derive only from `storesForUser(userId).root`. Shared knowledge is a separate immutable snapshot opened with filesystem read-only access.
- Knowledge defaults OFF. `search_knowledge` is registered only when it is ON. `knowledgeUsed` is sticky once a returned chunk enters model context.
- All session agents and background jobs use the session's fixed `teachingLanguage` and explicit owner ID.
- Each task follows red/green TDD, passes typecheck, and is committed independently.

## Review Focus

- ZIP headers that under-report output: streaming actual-byte counters reject immediately.
- Streaming ZIPs with missing local sizes: central-directory preflight remains authoritative for declared limits.
- Entity declarations with mixed case or whitespace: parser rejects before XML parsing.
- Japanese text without spaces: character bigrams retrieve it by Japanese and English concept formulations when matching bilingual content exists.
- Shared-index replacement during a request: a request uses one fully parsed immutable snapshot, never a partial write.

---

### Task 1: Secure archive and XML primitives

**Files:** Create `src/knowledge/archive.ts`, `src/knowledge/xml.ts`, and `tests/knowledge-archive.test.ts`; modify `docs/office-v1-progress.md`.

**Interfaces:** `extractSelectedZipEntries(data: Uint8Array, select: (name: string) => boolean): Map<string, Uint8Array>` and `parseOfficeXml(xml: Uint8Array): unknown`.

- [ ] Write failing tests for entry-count, declared-total, declared-selected-entry, actual-total, and actual-selected-entry limits; selected-path-only extraction; malformed ZIP; and XML `DOCTYPE`/entity rejection.
- [ ] Run the focused test and verify each failure is caused by the missing secure primitives.
- [ ] Implement central-directory preflight with `unzipSync(..., { filter })` returning false for every entry, followed by `Unzip` streaming extraction of selected entries with actual-byte counters and immediate termination.
- [ ] Implement XML declaration rejection plus `XMLParser({ processEntities: false, ... })`.
- [ ] Run focused tests, the full suite, typecheck, update the progress ledger, and commit.

### Task 2: Citation contracts and format parsers

**Files:** Create `src/knowledge/contracts.ts`, `src/knowledge/extract.ts`, `src/knowledge/parsers/pdf.ts`, `pptx.ts`, `docx.ts`, `text.ts`, fixture builders/data, and `tests/knowledge-extraction.test.ts`; modify `src/agent/subagents/pdf-ops.ts` only to expose structured page text.

**Interfaces:** `extractDocument(input: { fileName: string; data: Uint8Array }): Promise<ExtractedDocument>` produces `ExtractedBlock[]` with a discriminated `KnowledgeCitation`: PDF page; PPTX slide number/title; DOCX nearest heading/paragraph index; MD/TXT heading or line range.

- [ ] Add English and Japanese fixtures for each accepted format and failing assertions for extracted text and exact citation fields.
- [ ] Add failing cases for scanned/no-text PDF status, unsupported Excel, malformed Office archives, and PPTX speaker notes.
- [ ] Add `pdfPageTexts(filePath): Promise<Array<{ page: number; text: string }>>` using the existing pdfjs document path.
- [ ] Implement PPTX extraction from slide, slide relationship, and notes XML; title is the first non-empty slide text when no explicit title placeholder is available from the selected entries.
- [ ] Implement DOCX paragraph extraction using `word/styles.xml` to identify heading styles and track the nearest heading with 1-based paragraph indexes.
- [ ] Implement UTF-8/BOM MD/TXT extraction with headings and stable line ranges; reject invalid UTF-8 rather than guessing an encoding.
- [ ] Run focused tests, full suite, typecheck, update progress, and commit.

### Task 3: Chunking and BM25 Retriever

**Files:** Create `src/knowledge/tokenize.ts`, `chunk.ts`, `bm25.ts`, `retriever.ts`, and `tests/knowledge-retrieval.test.ts`.

**Interfaces:** `Retriever.search(queries: string[], userId: string): Promise<KnowledgeResult[]>`; queries must contain 1–4 non-empty strings. Latin text uses normalized word tokens, CJK text uses overlapping character bigrams, and mixed text uses both. Results merge by chunk ID and retain the highest score.

- [ ] Write failing tests for Japanese-only queries, English plus Japanese formulations finding a Japanese or bilingual chunk, mixed chunks found from either language, four-query validation, and cross-query deduplication.
- [ ] Implement deterministic chunk IDs and citation-preserving chunks with a 1,200-character target and 200-character overlap inside one citation block.
- [ ] Implement BM25 with `k1=1.2`, `b=0.75`, deterministic score/id ordering, and a default result limit of 8.
- [ ] Implement the `Retriever` interface over injected shared/personal snapshots so tools never depend on storage format.
- [ ] Run focused tests, full suite, typecheck, update progress, and commit.

### Task 4: Isolated personal index and read-only shared snapshot

**Files:** Create `src/knowledge/index-store.ts`, `src/knowledge/service.ts`, `scripts/index-shared.ts`, and isolation/index tests; modify `src/server/stores.ts`, `config.ts`, `package.json`, `.env.example`.

**Interfaces:** personal files/index live under `<user-root>/knowledge/`; `npm run index:shared` recursively indexes regular accepted files under `KNOWLEDGE_SHARED_DIR` into an atomic snapshot at `KNOWLEDGE_INDEX_FILE`. The web process opens that snapshot with flag `r`, validates it completely, and never writes it.

- [ ] Write failing tests that every personal write stays under two distinct temp user roots and shared-index reads cannot mutate the snapshot.
- [ ] Test recursive traversal ignores symlinks, hidden/temp files, the output index itself, and unsupported files while recording per-file extraction status.
- [ ] Implement atomic personal/shared snapshot writes for their authorized writers and immutable validated reads for the web process.
- [ ] Add the shared index command and environment documentation.
- [ ] Run focused tests, full suite, typecheck, update progress, and commit.

### Task 5: Upload API and Knowledge page

**Files:** Create `app/api/knowledge/documents/route.ts`, `app/api/knowledge/documents/[id]/route.ts`, `app/knowledge/page.tsx`, `components/knowledge-page.tsx`, locale keys, and API/UI tests; modify navigation.

**Interfaces:** authenticated users list/upload/delete only their own documents. Uploads are content-hash idempotent, capped at 25 MiB compressed/input size, and indexed synchronously for the pilot. Status includes `ready`, `rejected`, or `no_text_layer` with localized explanatory text.

- [ ] Write failing auth/isolation tests for list/upload/delete, duplicate upload, unsupported type, oversized input, and no-text PDF status.
- [ ] Write failing EN/JA rendering tests with no missing locale keys.
- [ ] Implement APIs through the per-user knowledge service and add the localized Knowledge page.
- [ ] Run focused tests, full suite, typecheck, build/artifact check, update progress, and commit.

### Task 6: Session controls, tool, sticky use, and teaching provenance

**Files:** Modify chat contracts/store/settings route, chat header/composer controls, `src/agent/tools.ts`, teacher/practice/background composition, teaching prompts, locale catalogs, and tests.

**Interfaces:** session settings persist `officeKnowledgeEnabled` and `webResearchEnabled`; each change appends a localized-neutral audit event to history and applies next turn. `search_knowledge({ queries: string[1..4] })` exists only when Knowledge is ON, searches shared plus owner snapshots, and atomically sets `knowledgeUsed` before its chunks enter context.

- [ ] Write failing tests for OFF-by-default registration, mid-session ON/OFF changes, audit history, sticky `knowledgeUsed`, existing-session language independence, background owner propagation, and the Knowledge ON → retrieve → OFF → Web ON approval rule.
- [ ] Add prompt assertions requiring Japanese and English query formulations plus key terms/acronyms.
- [ ] Add teaching prompt assertions that cited document claims are separated from uncited general background and ambiguous slides are called out without guessing.
- [ ] Implement the tool and foreground/background wiring, sticky flag, session header marker, and citation rendering.
- [ ] Run focused tests, full suite, lint, typecheck, build/artifact check, update progress, and commit.

### Task 7: Office knowledge acceptance gate

**Files:** Modify `docs/office-v1-progress.md` and only defects found by the gate.

**Interfaces:** One integration test indexes shared English/Japanese fixtures, uploads a personal document for each of two users, and verifies isolated cited retrieval through the same tool path used by agents.

- [ ] Run the complete extraction, retrieval, storage, API, session/tool, and provenance integration tests.
- [ ] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` with artifact scanning.
- [ ] Record #6 evidence and remaining host-only checks in the progress ledger.
- [ ] Commit the gate documentation or any test-proven defect fixes separately.
