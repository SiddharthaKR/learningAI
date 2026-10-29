# Local and Custom AI Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local Ollama and one configurable OpenAI-compatible endpoint to every model-driven LearnHarness feature.

**Architecture:** Register Ollama and the custom endpoint in the existing pi-ai model collection and project their refreshed models through the existing catalog. Persist one custom endpoint URL and optional manually entered model IDs in the models settings section. Route every feature through the existing provider-qualified model slots and role overrides.

**Tech Stack:** TypeScript, Next.js App Router route handlers (installed Next.js docs under `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`), pi-ai `createProvider` / `openai-completions`, existing settings and model catalog.

**Spec:** `docs/superpowers/specs/2026-10-29-ollama-local-provider-design.md`

## Global Constraints

- Ollama uses `http://localhost:11434` and has no API key.
- There is one custom OpenAI-compatible endpoint URL, entered as the API base including `/v1` (for example, `http://host:8000/v1`), and no API-key field.
- Custom endpoint model IDs are discovered from `/v1/models`; manually entered IDs remain available when discovery is unavailable.
- Ollama is discovered from its local API and model details; catalog refreshes make model changes visible without restarting the app.
- Models flow through the existing Strong, Cheap, and Vision slots and background-agent settings.
- Custom manually entered models can be marked vision-capable; unsupported capabilities are never advertised.
- Endpoint failures remain actionable and do not switch providers silently.
- Existing settings records and cloud provider behavior remain backward-compatible.
- Gemma 4 is the primary compatibility case and must be discovered and expose its supported capabilities from provider metadata, without hard-coding a default model.

## Review Focus

- Ollama is stopped or unreachable: report local unavailability and leave other configured providers usable.
- The custom endpoint URL is malformed or unreachable: reject invalid configuration or show a useful connection status without losing other models.
- `/v1/models` is unsupported or empty: retain manually entered model IDs.
- A manually entered custom model is marked vision-capable: include it in the Vision slot; an unmarked model stays text-only.
- Ollama reports no vision capability for a model: do not include it in the Vision slot.
- An installed Gemma 4 Ollama variant: discover it by its installed ID and preserve reported image, tool, and thinking capabilities.

---

### Task 1: Persist custom endpoint settings and expose configuration

**Files:**
- Modify: `src/core/settings.ts`
- Modify: `src/server/settings-body.ts`
- Modify: `components/settings/agent-section.tsx`
- Modify: `components/settings/settings-dialog.tsx` only if needed to pass endpoint settings into the existing Agent/Models section

**Interfaces:**
- Add `CustomEndpointSettings` with optional `baseUrl` and `manualModels: { id: string; vision?: boolean }[]`.
- Extend `ModelsSettings` with optional `customEndpoint`.
- The Settings → Models controls write the complete models section through the existing `PUT /api/settings/models` contract.

- [ ] Add the optional custom endpoint shape to `ModelsSettings` and preserve old records when sanitizing.
- [ ] Validate an HTTP/HTTPS endpoint URL ending in `/v1` and the manual model entries in the models-section request parser; reject malformed URLs and empty IDs with a user-facing 400.
- [ ] Add endpoint URL, model-ID add/remove, and vision-capability controls in the existing Models group under Settings → Agent → Models.
- [ ] Save through the existing models section and display the server's validation/connection error inline.
- [ ] Run `npm run typecheck` and `npm run lint`.

### Task 2: Implement Ollama and custom OpenAI-compatible providers

**Files:**
- Create: `src/agent/local-providers.ts`
- Modify: `src/agent/models.ts`
- Modify: `src/server/stores.ts` or the existing settings composition seam used to pass the current models settings to provider registration

**Interfaces:**
- `configureLocalProviders(settings: ModelsSettings | undefined, fetchFn?: typeof fetch): void` registers or updates provider IDs `ollama` and `custom-openai` in the shared pi-ai model collection.
- Ollama uses `/api/tags` and `/api/show` for model discovery/details, with OpenAI-compatible streaming at its `/v1` endpoint.
- The custom provider uses the configured API base ending in `/v1`; discovery calls its `/models` route and streaming uses that base directly. Manually listed IDs are unioned with discovered IDs; manual `vision` flags override missing endpoint metadata.
- Gemma 4 must remain discovered by its returned Ollama model ID and receive capability flags from Ollama's model details, not from model-name matching.
- Both providers advertise tool, image, context, and thinking support only when their source metadata provides it; unsupported optional features default to text-only and no reasoning.

- [ ] Add focused provider construction and model conversion helpers in `src/agent/local-providers.ts`.
- [ ] Build pi-ai chat models using `openai-completions`, zero token cost, Ollama/custom provider IDs, and model capability metadata from discovery or explicit manual flags.
- [ ] Register providers in `piModels()` without changing existing builtin provider registration.
- [ ] Ensure updated settings replace the custom provider configuration and remove its provider when the URL is cleared.
- [ ] Run `npm run typecheck` and `npm run lint`.

### Task 3: Refresh model discovery and integrate the shared catalog

**Files:**
- Modify: `src/server/model-catalog.ts`
- Modify: `src/core/contracts/models.ts`
- Modify: `app/api/models/route.ts`
- Modify: `app/api/settings/[section]/route.ts`

**Interfaces:**
- Extend `CatalogProvider` with optional `envVar`, `available`, and `error` fields so keyless providers can report readiness without pretending to have a key.
- `refreshLocalProviders(settings: ModelsSettings | undefined, fetchFn?: typeof fetch): Promise<{ ollamaAvailable: boolean; customEndpointAvailable: boolean; errors: Partial<Record<"ollama" | "custom-openai", string>> }>` configures providers and refreshes their catalogs without making one endpoint's failure fail the whole catalog.
- Make the model-catalog route await provider refresh before returning catalog entries and local/custom availability status.
- Keep model validation and context-limit lookup against the same provider-qualified catalog the engine uses.

- [ ] Add local and custom provider rows to the catalog response without requiring API keys.
- [ ] Refresh Ollama and custom endpoint models on catalog requests; retain manual IDs and return endpoint availability/errors separately.
- [ ] Keep setup gating compatible with existing `keyPresent` entries by allowing `available === true` for Ollama and configured custom providers.
- [ ] Ensure the validated settings write reconfigures provider entries before checking saved local/custom model references.
- [ ] Run `npm run typecheck` and `npm run lint`.

### Task 4: Keep all model-driven paths and setup behavior provider-neutral

**Files:**
- Modify: `components/setup-dialog.tsx`
- Modify: `components/model-picker.tsx`
- Modify: `components/settings/agent-section.tsx`
- Modify: `src/server/model-catalog.ts` if needed for slot capability filtering
- Modify: `README.md`

**Interfaces:**
- Setup and settings pickers continue to consume `ModelCatalogResponse`; local provider status is represented in its `providers` array.
- The Vision slot only receives image-input models; all other model slots can select supported text models from Ollama and the custom endpoint.
- Keyless provider auth resolves with an empty auth object; do not create or send a fake API key.

- [ ] Allow no-key local providers to satisfy first-run setup gating while still requiring all three model slots as today.
- [ ] Update the no-provider-key and strong-keyless pre-send guards to recognize a ready keyless Ollama/custom provider; retain the key screen when none is ready.
- [ ] Filter Ollama/custom catalog entries into Vision only when marked image-capable.
- [ ] Confirm provider-qualified selections resolve identically for session chat, background role overrides, jobs, practice, and graph work through the existing slot engine.
- [ ] Document Ollama prerequisites, custom endpoint URL setup, model discovery/manual IDs, and the no-API-key behavior in the README.
- [ ] Run `npm run typecheck` and `npm run lint`.

## Self-review

- Spec coverage: local Ollama, custom URL, optional discovery/manual fallback, no-key behavior, vision-capability marking, all model slots and background agents, error handling, settings compatibility, and user documentation are assigned above.
- Gemma 4 compatibility is metadata-driven: no Gemma-specific default or model ID is pinned in settings.
- Provider IDs are consistently `ollama` and `custom-openai` throughout registration, catalog, and saved model pins.
- Work is split by data/configuration, provider engine, catalog/refresh, and setup/documentation so each stage has a clear deliverable.
