# Office v1 deployment plan (DRAFT, not yet approved)

Date: 2026-11-09. Status: stored for later; no implementation started.
Scope: acceptance item 1 (Deployment) on `172.20.1.126`. Web search is out of scope: `SEARCH_PROVIDER` stays `none` (URL-only mode).

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
