# Office v1 Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a five-person LearnHarness pilot on `.126` and pass all ten acceptance items.

**Architecture:** A Node/Next server authenticates every request and resolves personal state only through `storesForUser(userId)`. The office model has native or prompt tool transport, while knowledge and proxy research are opt-in session tools. Deploy as a non-root systemd service.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Node, pi-ai, filesystem stores, systemd, local BM25.

**Spec:** `docs/superpowers/specs/2026-11-02-office-v1-pilot-design.md`

## Global Constraints

- Read the relevant `node_modules/next/dist/docs/` guide before changing Next code.
- All user personal writes go through `storesForUser(userId)` into `data/users/<id>/`; shared index is opened read-only by the web app.
- UI and teaching support `en|ja`; session teaching language never changes after creation.
- Knowledge and Web default OFF and changes take effect on the next turn; `knowledgeUsed` is sticky.
- Prompt mode sends no OpenAI `tools`; native mode bypasses prompt parsing.
- No unexpected outbound destinations; telemetry disabled and fonts local.
- After each task report all ten acceptance items as passed, pending, deferred, or blocked with evidence.

## Review Focus

- Simultaneous signups for one username: exactly one account persists; Task 2 test.
- A stale session cookie after account deletion: all protected endpoints deny it; Task 2 test.
- A background wake after ownership or chat deletion: no cross-user read/write; Task 3 test.
- A split tool tag followed by malformed JSON: one retry and no tool execution; Task 1 test.
- Redirect from public URL to private address: fetch is blocked before the proxy request; Task 7 test.

---

### Task 1: LLM tool transport

**Files:** Modify `src/server/office-config.ts`, `src/agent/models.ts`, `scripts/smoke-llm.mjs`, `.env.example`; create `src/agent/prompt-tool-stream.ts`, `tests/prompt-tool-stream.test.ts` and recorded fixtures.

**Interfaces:** `LLM_TOOL_MODE` selects `native|prompt`; `promptToolStream(model, context, options, upstream)` returns the current `StreamFunction` event stream, validating against registered tools. Native uses the existing upstream unchanged.

- [ ] Add recorded-fixture tests for one/multiple calls, split tags, surrounding text, JSON fallback, malformed call with one retry, unknown tool, and invalid arguments; assert prompt requests omit `tools`.
- [ ] Run the focused test and confirm failure.
- [ ] Implement the adapter and config selection; update smoke script to test the selected mode.
- [ ] Run focused tests, typecheck, and real-endpoint smoke when credentials are available.
- [ ] Commit the task.

### Task 2: Accounts and route authentication

**Files:** Create `src/server/accounts.ts`, `src/server/session-auth.ts`, `app/login/page.tsx`, `app/signup/page.tsx`, auth route handlers, `proxy.ts`, `tests/accounts.test.ts`; modify `app/layout.tsx` and protected routes.

**Interfaces:** `requireUser(request): UserIdentity` and `getUserSession(): Promise<UserIdentity|null>`; account store uses an atomic locked file, scrypt password hashes, rate-limited login/signup, signed HTTP-only SameSite=Lax cookies. Public paths are `/login`, `/signup`, `/source` and necessary auth endpoints.

- [ ] Test signup race, invalid credentials, rate limits, logout, deleted-account cookies, and direct API access without login.
- [ ] Confirm focused tests fail.
- [ ] Implement account store, sessions, page gate, route gate, and login/signup UI; detect signup language from `Accept-Language` with an override.
- [ ] Run focused tests and build.
- [ ] Commit the task.

### Task 3: Per-user data and background ownership

**Files:** Refactor `src/server/stores.ts`, `config.ts`, adapters in `src/store/`, `src/server/chat-handler.ts`, `src/server/jobs.ts`, `src/server/web-approvals.ts`, all data routes; create `scripts/migrate-office-data.ts`, `scripts/delete-user.ts`, isolation tests and constructor-ban test.

**Interfaces:** `storesForUser(userId): UserStores` is the only store factory; chat, graph, job, practice, setting, and upload paths derive from `data/users/<id>/`. `npm run user:delete <username>` deletes account and personal data; migration takes an explicit destination username and never runs at startup.

- [ ] Test all personal writes in distinct temp roots, cross-user CRUD denial, background wake and async graph extraction ownership (including a recheck before writes), approval ownership, and the old-constructor ban.
- [ ] Confirm focused tests fail.
- [ ] Refactor store construction and route/worker entry points to carry user ID; implement manual migration and deletion commands.
- [ ] Run focused isolation tests, typecheck, and build.
- [ ] Commit the task.

### Task 4: Languages and session controls

**Files:** Modify account preferences, chat contracts and creation routes, `components/new-session.tsx`, session header, `app/layout.tsx`, prompts; add locale dictionaries, `tests/locales.test.ts`, session-control tests.

**Interfaces:** Account `uiLanguage` and `teachingLanguage` are `en|ja`; chat `teachingLanguage` is immutable, while `knowledgeEnabled`, `webEnabled`, and sticky `knowledgeUsed` are persisted. Control changes append history entries and apply next turn.

- [ ] Test missing translation keys, signup language, independent UI/session language, immutable session language, control history, and sticky `knowledgeUsed`.
- [ ] Confirm focused tests fail.
- [ ] Add localized UI, local fonts, dynamic `<html lang>`, preferences and session controls; remove prompt overrides and model/provider setting surfaces.
- [ ] Run focused tests and build.
- [ ] Commit the task.

### Task 5: Office knowledge

**Files:** Create `src/knowledge/` parsers, chunker, BM25 `Retriever`, index reader/writer, upload API, `app/knowledge/page.tsx`, `scripts/index-shared.ts`; modify agent tool composition; add bilingual fixtures and extraction/retrieval tests.

**Interfaces:** `Retriever.search(queries: string[], userId: string)` merges/deduplicates up to four queries. Shared index writer runs only in `npm run index:shared`; web process opens it read-only. `search_knowledge` exists only with Knowledge ON.

- [ ] Test English/Japanese extraction and exact citation fields for PDF, PPTX, DOCX, MD, TXT; scanned PDF status; rejected Excel; bilingual matching and personal isolation.
- [ ] Confirm focused tests fail.
- [ ] Implement indexing, upload, retrieval, citations and Knowledge UI; set `knowledgeUsed` when a retrieved chunk enters context.
- [ ] Run focused tests and build.
- [ ] Commit the task.

### Task 6: Tool allowlist and background flow

**Files:** Modify `src/agent/tools.ts`, `src/server/chat-handler.ts`, `src/server/jobs.ts`, related UI/settings; remove prohibited tool paths/dependencies; add `tests/registered-tools.test.ts`.

**Interfaces:** Registered tool names are an exact allowlist for each Knowledge/Web/Search mode. Keep measure/plan/teach/practice foreground tools, extraction, owned research jobs, and visual maker with browser SVG only. Remove fs read/ls/find/grep, demo/Chromium, Jina, PDF download, Tavily/Brave, updater, dictation, `auth.json`.

- [ ] Test exact tool sets in every mode and owned researcher job lifecycle.
- [ ] Confirm focused tests fail.
- [ ] Remove unused paths and re-enable only the required owned research background flow.
- [ ] Run focused tests, lint, typecheck, build.
- [ ] Commit the task.

### Task 7: Proxy research and approval

**Files:** Modify `src/agent/tools/web.ts`, `restricted-web-fetch.ts`, `src/server/search.ts`, `src/server/web-approvals.ts`, approval APIs/UI; create SearXNG adapter and tests.

**Interfaces:** `SEARCH_PROVIDER=none|searxng`; none exposes fetch only, labeled “Read linked pages.” Fetch authorization is exact URL membership in user messages or returned search results for the session. Approval is required if Web ON and (Knowledge ON or `knowledgeUsed`). Repeated decision POST returns 409.

- [ ] Test user/search-result URL permission, fetched-page/document rejection, proxy-only fetch, private redirects, approval timeout/restart denial, repeated POST, edit revalidation, and cross-user denial.
- [ ] Confirm focused tests fail.
- [ ] Implement provider selection, URL provenance, proxy validation, approval policy and UI.
- [ ] Run focused tests and build.
- [ ] Commit the task.

### Task 8: Source archive and deployment

**Files:** Create archive build script and `/source` route, `DEPLOY.md`, systemd unit templates; modify `package.json` and `.env.example`; add archive inspection tests.

**Interfaces:** Archive contains source but excludes `.env`, mutable `data/`, knowledge, indexes, and secrets. System unit is used with sudo; user unit plus administrator-enabled linger without sudo.

- [ ] Test archive exclusions and `/source` unauthenticated download.
- [ ] Confirm focused tests fail.
- [ ] Implement archive generation and fresh-checkout deployment instructions for both systemd paths.
- [ ] Run tests, lint, typecheck, and build.
- [ ] Commit the task.

### Task 9: Host acceptance on `.126`

**Files:** Update `DEPLOY.md` with observed commands or corrections; record acceptance evidence in `docs/office-v1-acceptance.md`.

**Interfaces:** Uses actual SSH, model, proxy, and search configuration supplied by the operator; never commits secrets.

- [ ] Deploy and enable the non-root service; verify boot/restart behavior and HTTP login.
- [ ] Run `npm test`, `npm run build`, `smoke:llm`, isolation and archive checks on the host.
- [ ] Exercise English and Japanese full sessions, uploads and citations, URL-only or SearXNG research, three concurrent sessions, and observed outbound destinations.
- [ ] Record each of the ten checklist outcomes with evidence; mark search deferred if provider is none.
- [ ] Commit documentation corrections and report any unmet acceptance items.
