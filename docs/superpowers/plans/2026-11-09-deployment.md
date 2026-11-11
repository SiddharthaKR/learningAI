# Office v1 deployment plan

Date: 2026-11-09. Status: Phase 1 code, `DEPLOY.md` and the unit file are implemented; the .126 host run and acceptance checks are pending. Shared knowledge (`KNOWLEDGE_SHARED_DIR` / `KNOWLEDGE_INDEX_FILE`): decided 2026-11-11 to leave the paths in `.env` for the operator to configure on the host.
Scope: acceptance item 1 (Deployment) on `172.20.1.126`, preceded by Phase 1 (SearXNG web search, see the section below). Order decided 2026-11-09: SearXNG first, then deployment.

## Decisions made

- Host: `172.20.1.126`, sudo available, so a system-level systemd unit runs as a non-root user.
- Service user: the operator's existing SSH account. `DEPLOY.md` uses the placeholder `<USER>`; app path is `/home/<USER>/app`.
- LLM: LM Studio via the Gemma 4 proxy at `http://127.0.0.1:8088/v1`, `LLM_TOOL_MODE=native`. The proxy is already managed on the host; `DEPLOY.md` only documents that it must be running.
- Code delivery: `git clone` on the host, checkout the `office` branch. Upgrade = `git pull`, `npm ci`, `npm run build`, restart service.

## Deliverables

1. `DEPLOY.md` (Ubuntu 22.04): Node/npm prerequisites; clone and checkout; production `.env` from `.env.example` (`LLM_*` to the proxy, generated `SESSION_SECRET`, `VISION_*`, `SEARCH_PROVIDER` unset, proxy vars empty); `data/` ownership and permissions; systemd unit (enable at boot, restart behavior, logs); upgrade steps; acceptance commands (`npm run smoke:llm`, signup/login curl checks, no secrets or user data in `.next`).
2. `deploy/learnharness.service`: committed unit template with `<USER>` and path placeholders.
3. `.env.example` cleanup: drop unused search entries, align shared-knowledge defaults with the pilot.

## Open questions (must be answered before implementing)

- Build `/source` (AGPL archive route, acceptance item 9) as part of deployment, or later?
- Wire `KNOWLEDGE_SHARED_DIR` / `KNOWLEDGE_INDEX_FILE`, or leave empty (personal uploads only)?
- Is `VISION_BASE_URL` the same LM Studio server? Which `VISION_MODEL` ID?
- `MAX_CONCURRENT_LLM`: `.env.example` says 4, progress doc says 2. Which value?
- Still unknown: LLM model ID, `LLM_CONTEXT_WINDOW`, `LLM_MAX_TOKENS`, `LLM_VISION`, `LLM_REASONING` values.

## Phase 1 (before deployment): SearXNG web search

Decision 2026-11-09: do this BEFORE the DEPLOY.md/systemd work, so deployment docs and acceptance cover search from the start. Steps 1 and 5 run on `.126`; steps 3 and 4 are local code changes. `DEPLOY.md` deliverable 1 then sets `SEARCH_PROVIDER=searxng` instead of leaving it unset, and deliverable 3 keeps the SearXNG entries in `.env.example`.

### Answers so far

1. Docker is available on `.126`.
2. SearXNG is called directly (not through the corporate proxy). Recommended; needs a small code change in `src/server/search.ts` (`proxyFetch` currently forces every request through `HTTPS_PROXY` and ignores `NO_PROXY`) plus a spec edit exempting the local SearXNG call. `web_fetch` stays proxied.
3. `.126` can reach Google; the corporate proxy blocks some sites. The proxy URL contains personal credentials: it goes only into `.env` on the host (`chmod 600`, URL-encode special characters, never committed, never sent to Claude). `DEPLOY.md` uses a placeholder. Ask IT for a service account or credential-free proxy for the pilot.
4. Blocked sites only limit reach: blocked engines return nothing, blocked pages fail on `web_fetch`. Enable only engines confirmed working from `.126`.

### Steps

1. Run SearXNG in Docker bound to `127.0.0.1:8080`, restart on boot. `settings.yml`: add `json` to `search.formats`, random `server.secret_key`, `server.limiter: false`, only confirmed-working engines.
2. App `.env`: `SEARCH_PROVIDER=searxng`, `SEARXNG_URL=http://127.0.0.1:8080`, `HTTPS_PROXY=<placeholder, set on host>`.
3. Code: make the SearXNG call direct; keep `web_fetch` proxied; add a test; update the spec line.
4. Cleanup: remove the unreachable `SEARCH_API_KEY` branch and leftover Tavily/Brave resolver code; trim `.env.example`.
5. Verify: `curl 'http://127.0.0.1:8080/search?q=test&format=json'`; UI toggle changes from "Read linked pages"; live search returns cited URLs; approval flow (Web + Knowledge ON pauses for Allow/Deny); acceptance item 8 outbound observation.
6. Document a SearXNG section and `settings.yml` template in `DEPLOY.md`.
