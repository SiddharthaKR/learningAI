# Task 5 implementation report

Status: implemented in the shared checkout, verified with the focused checks below, and not committed. No Task 6 functionality was added.

## Files changed

- `app/api/knowledge/documents/route.ts`: directly authenticated owner-scoped list/upload routes; bounded multipart reading; sanitized public document metadata and stable explanation/error codes.
- `app/api/knowledge/documents/[id]/route.ts`: directly authenticated owner-scoped deletion with identical 404 responses for unknown and foreign IDs.
- `app/knowledge/page.tsx`: authenticated dynamic server page loading only the current owner's records.
- `components/knowledge-page.tsx`: localized upload/delete interface, file validation, ready/rejected/no-text status rendering, and localized errors.
- `components/knowledge-navigation-link.tsx`, `components/sidebar.tsx`: localized Knowledge navigation using existing sidebar styling.
- `src/knowledge/upload.ts`: shared extension/MIME/filename validation and exact 26,214,400-byte limit.
- `src/knowledge/index-store.ts`: optional validated SHA-256 content hash on document records, retaining compatibility with existing v1 snapshots.
- `src/store/knowledge.ts`: per-owner serialized upload/delete operations, content-hash deduplication, ID-based original-source paths, atomic snapshot publication and failed-upload cleanup.
- `locales/en.json`, `locales/ja.json`: all Knowledge text, including unsupported Excel and scanned-PDF explanations.
- `tests/knowledge-api.test.ts`: real authenticated route and composed-store tests, five real document fixtures/citations, owner isolation, concurrent deduplication, size/MIME boundaries and scanned PDF behavior.
- `tests/knowledge-page.test.tsx`: English/Japanese SSR/navigation tests and mounted submit/error/upload/delete interaction tests. Only transport and linkedom's missing browser FormData/reset behavior are adapted; observable DOM outcomes are asserted.
- `docs/office-v1-progress.md`: Task 5 checkpoint and mechanical contract decisions.

## Recorded decisions

The controller approved multipart field `file`, JSON `{ documents }` / `{ document }`, existing page/sidebar styles, and existing `{ error }` conventions. Successful deletion returns `{ deleted: true }`.

All personal reads/writes use `checkedStoresForUser(currentUserId()).knowledgeStore`; no raw user-root construction or global personal stores were introduced. Original filenames remain metadata, while physical source filenames are validated document IDs under the composed owner's `knowledge/documents/` directory. Unsupported extensions, incompatible MIME types and unsafe filename forms are rejected before indexing. Empty or generic binary MIME is allowed for accepted extensions because browsers may omit precise MIME types.

Mutations are queued by owner root in the pilot server process. The snapshot records SHA-256 content hashes so concurrent same-owner uploads of identical bytes, including different filenames, return the first existing document. Other owners retain independent records and source files.

Actual file length is enforced at the store boundary. Incoming multipart bytes are independently counted and capped at 25 MiB plus 64 KiB of multipart-envelope allowance. Content-Length is never authoritative. Exactly 25 MiB is accepted; one byte beyond is rejected before indexing. Extraction/indexing is synchronous, using the committed contracts. Parser failures produce rejected records without chunks; scanned PDFs produce no_text_layer without chunks. The response exposes a stable explanation code and the UI supplies localized text. Teaching-language behavior was not changed.

## RED evidence and limitation

Initial command, before production modules were created:

```text
node --import tsx --import ./tests/bootstrap.mjs --test tests/knowledge-api.test.ts tests/knowledge-page.test.tsx
```

The sandboxed invocation could not initialize tsx because Windows `uv_os_get_passwd` returned ENOMEM. The approved unsandboxed rerun reached missing-module failures for the absent `app/api/knowledge/documents/route.ts` and `components/knowledge-page.tsx` (0 passed, 2 failed). These were feature-absence import failures, not individual behavioral assertion failures. This does not establish strict per-assertion pre-implementation RED; that limitation was disclosed to the controller.

During GREEN the exact-size test exposed synchronous throwing from a Promise-returning store method. The method was made async so validation failures consistently reject the returned Promise; the focused test then passed.

At the controller's request, targeted removal checks were then run and each mutation was restored before the next check. These are post-implementation regression evidence, not retroactive pre-implementation RED:

```text
node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern '<pattern>' tests/knowledge-api.test.ts
```

| Pattern | Temporary mutation | Observed behavioral failure |
| --- | --- | --- |
| `rejects unauthenticated` | Bypass GET authentication | `200 !== 401` |
| `hides another` | Treat absent owner-scoped deletion ID as success | `200 !== 404` for foreign ID |
| `enforces exactly` | Remove actual-byte length rejection | `Missing expected rejection` for 25 MiB + 1 byte |
| `deduplicates identical` | Disable hash lookup | Identical bytes uploaded under two names returned different document IDs |
| `returns scanned` | Force public status to ready | `ready !== no_text_layer` |

All five focused mutation invocations exited 1 on the intended assertions. One no-text mutation patch initially did not match the full source line; it made no change, was corrected, and the check above then ran and failed as intended.

## Final GREEN verification

After restoring every mutation:

```text
node --import tsx --import ./tests/bootstrap.mjs --test tests/knowledge-api.test.ts tests/knowledge-page.test.tsx tests/knowledge-index.test.ts tests/render-sidebar.test.tsx tests/i18n-encoding.test.ts
```

Exit 0: 51 tests passed, 0 failed, 0 skipped, across 4 suites; approximately 2.1 seconds. This includes the 10 new API/UI tests and directly affected snapshot/sidebar/locale checks. Japanese strings round-trip unchanged, no mojibake is detected, and locale key sets match. The focused runner used the approved unsandboxed workaround for tsx's Windows user-information failure.

```text
npm.cmd run typecheck
```

Exit 0, no diagnostics.

```text
git diff --check
```

Exit 0, no whitespace errors.

No full suite, lint, build, artifact scan, commit or subagent dispatch was performed. The full acceptance gate remains reserved for Task 7.

## Concerns / review notes

- Strict TDD limitation: the initial red run failed to import missing feature modules rather than reaching the individual assertions. The five subsequent targeted mutation checks provide explicit assertion-level regression evidence, but are not claimed as pre-implementation RED.
- Mutation serialization is process-local, consistent with the pilot's single server process. Multiple independent web workers writing one owner snapshot would require a cross-process lock.
- Source files and the JSON snapshot are separate filesystem objects. Normal success and failed-upload cleanup are covered; a process crash between their publication/removal can leave an unreferenced source file. No crash-recovery transaction layer was added.
- No remaining design conflict is known. Independent review and the later Task 7 full gate are still required by the controller workflow.

## Fix loop round 1: preserve the upload envelope through Next proxy

Read the installed `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md` before editing. It confirms that the default 10 MiB proxy body-cloning buffer truncates larger request bodies without rejecting the request.

Added test `preserves the supported 25 MiB multipart upload envelope through the Next proxy configuration`. It imports and evaluates the actual exported `next.config.ts` object, requires a numeric proxy buffer limit, and checks that it covers the approved 26,279,936-byte multipart envelope. It also independently pins the file limit to 26,214,400 bytes. This is a focused configuration-boundary regression test; no full Next server was launched.

RED command (before implementation):

```text
node --import tsx --import ./tests/bootstrap.mjs --test --test-name-pattern 'preserves the supported 25 MiB multipart' tests/knowledge-api.test.ts
```

Observed output, exit 1:

```text
✖ preserves the supported 25 MiB multipart upload envelope through the Next proxy configuration (60.8272ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 777.628
AssertionError [ERR_ASSERTION]: Next proxy must have an explicit numeric body-buffer limit
+ actual - expected
+ 'undefined'
- 'number'
```

Implementation: exported `MAX_KNOWLEDGE_MULTIPART_BYTES = MAX_KNOWLEDGE_UPLOAD_BYTES + 65_536` from `src/knowledge/upload.ts`; both the route's incoming-body counter and `next.config.ts` now reuse it. `experimental.proxyClientMaxBodySize` therefore resolves to numeric 26,279,936. The separate actual-file limit remains exactly 26,214,400 bytes. Also restored indentation on the existing actual-byte validation line.

GREEN command:

```text
node --import tsx --import ./tests/bootstrap.mjs --test tests/knowledge-api.test.ts
```

Observed output, exit 0:

```text
✔ rejects unauthenticated list, upload, and delete consistently (74.8242ms)
✔ uploads all five accepted formats and preserves extracted citation metadata (595.3607ms)
✔ deduplicates identical bytes across names, including simultaneous uploads, separately per owner (18.763ms)
✔ hides another owner's IDs and deletes only the selected owner's source, record, and chunks (22.636ms)
✔ rejects unsupported extensions and mismatched MIME types before storing (3.1663ms)
✔ enforces exactly 25 MiB on actual bytes, even when reported size lies (144.1511ms)
✔ preserves the supported 25 MiB multipart upload envelope through the Next proxy configuration (0.1603ms)
✔ returns scanned PDF status with a stable explanation and no chunks (13.9031ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1616.698
```

`npm.cmd run typecheck`: exit 0, no diagnostics. `git diff --check`: exit 0, no output. Tests used the established approved unsandboxed workaround for tsx. No full suite, build, lint, server launch or commit was performed. The Important finding is addressed; no new concern was identified in this round.
