# Task 5 — Upload API and localized Knowledge page

## Place in the plan

This is Task 5 of `docs/superpowers/plans/2026-11-04-office-knowledge.md`. Tasks 1–4 are committed; the storage/indexing foundation is commit `f3b10a9`. This task adds the authenticated personal-document boundary and UI. Task 6 will later add session controls and the agent tool. Do not implement Task 6.

## Binding requirements

- Create `app/api/knowledge/documents/route.ts`, `app/api/knowledge/documents/[id]/route.ts`, `app/knowledge/page.tsx`, `components/knowledge-page.tsx`, API/UI tests, locale keys, and navigation changes as needed.
- Authenticated users may list, upload, and delete only their own documents. Reuse the existing auth/session gate patterns; unauthenticated API requests must be rejected consistently with the rest of the app.
- All personal data access and writes go through the approved per-user composition root (`storesForUser` / checked owner services). No raw user-root construction and no old global stores.
- Accepted input types: PDF, PPTX, DOCX, MD, TXT. Reject Excel and every other format with a clear localized UI message.
- Maximum upload/input size is exactly 25 MiB (26,214,400 bytes). Reject larger content before indexing. Do not trust a client-reported size without also enforcing the bytes actually received.
- Uploads are content-hash idempotent: uploading identical bytes for the same owner must not create a second source file, document, or chunks. Return the existing document as the successful result. Identical content owned by another user remains completely separate.
- Index synchronously for the pilot using the committed extraction/chunk/index contracts. Statuses exposed to the UI are `ready`, `rejected`, and `no_text_layer`.
- Scanned PDFs with no text show the localized explanation `no text layer (OCR not supported)` / its natural Japanese translation. They contribute no chunks.
- Store original filename as metadata, but never use it as an unchecked filesystem path. Personal source files remain under `<user-root>/knowledge/`.
- Deletion is owner-scoped and removes the selected owner's source plus its document/chunks from the personal snapshot. Unknown or another owner's ID must not reveal that it exists.
- The Knowledge page must work in English and Japanese with no missing keys. All visible UI text belongs in `locales/en.json` and `locales/ja.json`, never inline in components.
- Add a localized navigation link to the Knowledge page.
- UI language and teaching language remain independent; this task must not alter teaching-language behavior.
- Preserve the existing UTF-8/LF and mojibake checks. Japanese strings must round-trip unchanged.
- Do not add cloud providers, embeddings, OCR, Excel, model/provider settings, or prompt overrides.

## Required tests and TDD

Follow strict RED → GREEN → REFACTOR. Before production code, add focused tests and run them to observe expected failures for:

1. unauthenticated list/upload/delete;
2. owner A cannot list/delete owner B documents;
3. accepted upload and cited extracted metadata;
4. same-owner duplicate upload idempotence;
5. unsupported extension/type rejection;
6. the exact 25 MiB boundary and oversized rejection (use a cheap fixture/stub at the route/service boundary if allocating 25 MiB repeatedly would make the test slow, but assert actual byte-length enforcement);
7. scanned PDF `no_text_layer` status and explanation code;
8. deletion removes source, document, and chunks only for the owner;
9. English and Japanese Knowledge-page rendering, navigation, and locale-key parity/no missing keys.

Tests must exercise real route/service/component behavior and assert observable outcomes, not grep source text or merely assert mocks exist.

## Next.js requirements

Before editing Next.js code, read the installed-version guides at:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/02-guides/forms.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`

Follow existing application patterns where they are stricter or more specific.

## Verification cadence

- During this sub-step run only the focused tests for files changed, `npm.cmd run typecheck`, and `git diff --check`.
- Do not run `npm test`, lint, build, or artifact scanning. The user explicitly reserves the full gate for the completed #6 acceptance item (Task 7).
- Do not commit. The controller will arrange independent review, focused verification, and the logical commit.
- Do not modify `.superpowers/` except this report path, and do not dispatch subagents.

## Report

Write a full report to `.superpowers/sdd/2026-11-04-office-knowledge/task-5-report.md` containing:

- files changed and decisions recorded in `docs/office-v1-progress.md`;
- RED commands and concise failure evidence;
- GREEN focused-test command/output summary;
- typecheck and diff-check results;
- any concerns or design conflict.

Return only status, a one-line focused-test summary, and concerns.
