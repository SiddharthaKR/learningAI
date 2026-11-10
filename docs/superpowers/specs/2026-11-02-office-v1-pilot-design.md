# Office v1 pilot design

## Intent and finish line

Run LearnHarness on Ubuntu 22.04 at `.126` as a non-root systemd service for about five colleagues over `http://<IP>.126:<port>/`. The pilot is complete only when the ten acceptance items supplied on 2026-11-02 pass on that host. Report each item's status after every implementation step.

HTTPS, an admin panel, roles, team-scoped knowledge, email, demo builder, and dictation are outside v1.

## Existing state

The current `office` branch has a Next.js Node server, fixed office model configuration, a concurrency limiter, restricted proxy fetch, and a web approval UI. It has no user login. Chat, graph, and job adapters still use one global `data/` root. Background jobs are disabled by the office chat handler. Search still exposes older Tavily/Brave behavior. Documentation still contains desktop-era architecture text. The current LLM adapter sends native OpenAI tools.

## Approaches chosen

- **Isolation:** use `storesForUser(userId)` with all personal writes under `data/users/<id>/`. The alternative, owner IDs in global files and filters at every operation, was rejected because missed filters would expose pilot data.
- **Prompt tool mode:** a dedicated stream adapter converts text tool calls into the existing agent events. Native mode bypasses it. Intercepting the current provider's responses was rejected because it couples parsing to provider internals.
- **Knowledge retrieval:** local BM25 using word tokens for Latin text and character bigrams for CJK. The alternative embedding index requires another model service and outbound path. A `Retriever` interface keeps future embedding or hybrid implementations separate from tools and citations.

## Accounts, authorization, and storage

- Open signup with username and password; login and logout. At signup, `Accept-Language: ja*` selects Japanese, otherwise English. The signup form can override this before account creation. It sets both UI language and initial teaching-language preference.
- Proposal for implementation approval: use a server-side account file with password hashes from Node `scrypt`, signed, HTTP-only, SameSite=Lax session cookies, and a finite session lifetime. Keep `SESSION_SECRET` in the environment. Authentication is enforced on every page and API except `/login`, `/signup`, and `/source`; the login/signup APIs are necessarily public. Each data API checks authorization at its server entry, including when a route is reached directly.
- The sole personal-store construction seam is `storesForUser(userId)`. No raw-path or global-root store construction remains available to production code. A static check bans old constructors, and temp-root tests verify every personal store write lands under `data/users/<id>/`.
- A user can access only their own chats, graph, documents, jobs, and approvals. Background continuations and asynchronous graph extraction carry explicit owner IDs, recheck ownership before writes, and use only `storesForUser(owner)`. Shared knowledge is in a separate index opened read-only at the file or DB level by the web server. The account file uses atomic writes protected by a lock. `/login` and `/signup` are rate limited. `npm run user:delete <username>` removes an account and its personal data.
- A manual one-time script moves existing `data/` records to a specified first pilot user's directory. Startup never migrates. The script must refuse ambiguous destination state and report exactly what it moved.

## LLM and teaching

- `LLM_TOOL_MODE=native|prompt` is required. Native sends OpenAI `tools` normally. Prompt never sends `tools`; it injects tool descriptions and schemas into the system prompt.
- The prompt adapter recognizes Gemma `<|tool_call>...<tool_call|>` blocks, multiple calls in a block, and JSON fallback. It buffers tag fragments across stream chunks while passing ordinary text through immediately. It emits the same tool-call events as the native adapter. Tool names and arguments are checked against the tools registered for the turn and their schemas before execution. One parse-failure retry adds a short format reminder; a second failure becomes a clear user-visible error.
- Recorded fixtures cover one call, multiple calls, split tags, surrounding text, malformed calls, and unknown tools. `smoke:llm` tests plain response and tool call in the configured mode against the real endpoint.
- Primary deployment target is the shared vLLM endpoint in native mode if its tool smoke test passes. Fallback is LM Studio on `.126` in prompt mode. The deployed choice is recorded in `.env`, not inferred at runtime. `MAX_CONCURRENT_LLM` bounds simultaneous model streams.
- A full real-model teaching session must measure, plan, teach, and lead to practice in English and Japanese.
- Measure, plan, teach, and practice use the foreground agent turns and their tools; they do not depend on a research job. Graph extraction runs asynchronously, and web research can use a background researcher job. Re-enable the latter with explicit owner IDs and the same store and approval rules. Demo-builder and Chromium jobs remain removed.

## Languages and session controls

- UI supports English and Japanese with complete key coverage. UI language can change at any time.
- `<html lang>` reflects the current UI language. Fonts are local assets. Set `NEXT_TELEMETRY_DISABLED=1` for the service. Prompt overrides and user model/provider settings are disabled for all users.
- `teachingLanguage: en|ja` is an account preference on Preferences. A new-session language selector is prefilled from it. The chosen language is stored on the session and remains fixed. All session agents, including background jobs, read that session value. The session header displays it. Changing the account preference never alters an existing session.
- Knowledge and Web Research switches are session controls, both OFF initially and changeable anytime. A change enters the session history and applies from the next agent turn.
- `knowledgeUsed` becomes permanently true once a knowledge chunk enters model context. Turning Knowledge OFF removes `search_knowledge` from later turns, while earlier content stays in history. The header shows “contains office documents” once `knowledgeUsed` is true.

## Knowledge

- `npm run index:shared` indexes the configured shared folder into a separate read-only shared index. A personal upload is stored and indexed only for its owner. Only shared plus owner-personal chunks can appear in that user's retrieval.
- Accept PDF, PPTX, DOCX, MD, TXT. PDF citations use page; PPTX citations use slide number and title and include speaker notes in indexed text; DOCX citations use nearest heading and paragraph index; MD/TXT use heading or line range. A scanned PDF with no text yields no chunks and appears as “no text layer (OCR not supported)” on Knowledge. Excel and other formats fail with a clear message.
- `search_knowledge` accepts up to four queries. Its prompt instructs the agent to include Japanese and English formulations plus key terms or acronyms. Retrieval merges and deduplicates by chunk. Tests cover bilingual matching and extraction/citation fields using one English and one Japanese fixture per format.

## Web research and outbound traffic

- Web Research OFF registers no web tools. `SEARCH_PROVIDER=none` registers `web_fetch` but no `web_search`; its toggle label is “Read linked pages.” A URL may be fetched only when it appears verbatim in that session's own user messages or in `web_search` results returned in that session. URLs in fetched pages, documents, or agent output do not authorize a fetch; rejection says “paste the link in chat to let me read it.”
- A SearXNG provider implements the search interface now, selected by configuration when available, so enabling it later needs configuration only. If Docker is unavailable, the pilot uses URL-only mode and reports web search as deferred.
- Every page fetch (`web_fetch`) goes through the configured corporate proxy; the SearXNG search call is the one exception and goes directly to the local SearXNG instance (`127.0.0.1`). Private/internal targets, including DNS results and redirects, are blocked; existing time and size limits remain. When Web is ON and (Knowledge is ON or `knowledgeUsed` is true), every web call pauses for Allow/Deny, with copied-text and sensitive-term warnings. Approval ownership is checked by user and chat, including across background jobs. Web results retain source URLs for citations.
- Approval expires after `APPROVAL_TIMEOUT_SECONDS` and auto-denies. In-memory pending requests also auto-deny on restart. Decision POST is idempotent and returns 409 for a repeated decision. Edited values are revalidated before dispatch.
- Remove the filesystem read/ls/find/grep tools, demo builder and headless Chromium, Jina, PDF download, Tavily/Brave, updater, dictation, and `auth.json` paths. Keep the visual maker only with browser-side SVG rendering. A test compares each mode's registered tool set to an explicit allowlist.
- The deployed service may contact only the chosen LLM endpoint, the corporate proxy when web research is enabled, and the configured search provider. Deployment verification observes outbound destinations during representative flows.

## Deployment and source

- `DEPLOY.md` provides fresh-checkout Ubuntu 22.04 steps: Node/npm prerequisites, environment file, storage ownership, build, non-root systemd service, boot enablement, restart behavior, logs, upgrade, and acceptance commands. With sudo it uses a system unit; without sudo it uses `systemctl --user`, with `loginctl enable-linger` as a one-time administrator action. Host-specific values remain supplied by the operator, never committed.
- `/source` serves an AGPL source archive from a release/build artifact. It excludes `.env`, mutable `data/`, knowledge files, indexes, and secrets. Archive inspection is part of acceptance.
- Run `npm test`, `npm run build`, the real LLM smoke test, browser/API account and isolation checks, a full bilingual session, the three-user concurrency exercise, and the network observation on `.126`.

## Open deployment inputs

The exact SSH user and IP, sudo/Docker status, deployment path, vLLM URL and model ID, LM Studio model ID, proxy URL, `NO_PROXY`, and final search choice are still placeholders in the handoff. They are required before host deployment and real-endpoint acceptance. The design does not substitute guessed values.
