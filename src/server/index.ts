/**
 * THE SERVER-SIDE SURFACE — the only src module (besides the core barrel)
 * that app/ may import. Route handlers and server components come through
 * here; nothing under app/ touches src/store or src/agent directly.
 */

export * from "./chat-handler.ts";
export * from "./events-stream.ts";
export * from "./chats.ts";
export * from "./graph.ts";
export { NotesImportError } from "../agent/subagents/extraction.ts";
export * from "./commit-positions.ts";
export * from "./jobs.ts";
export * from "./stores.ts";
export { getSessionSources } from "./session-sources.ts";
export { runVerifierAgent, type VerifierClaim } from "../agent/subagents/verifier.ts";
export { indexKnowledgeDocument } from "../knowledge/service.ts";
export { readRenderSettings, writeRenderSettings } from "./stores.ts";
// The settings record + prompt overrides (settings-storage wave, 2026-09-19).
// The *Record aliases keep the app/api/settings routes explicit about which
// seam they touch (the raw record, not the chat-section convenience view).
export { promptOverrides } from "../store/prompt-overrides.ts";
export { isValidSegmentPath } from "../core/prompt-segments.ts";
// The canonical segment discovery/resolution lives in the agent layer
// (composition is an agent concern); the barrel re-exports it for the
// routes — server→agent is the lawful direction (chat-handler precedent).
export { effectivePromptSegments, allSegmentPaths, readPromptOverride } from "../agent/prompt-segments.ts";

// The auth/keys composition (auth-keys wave, 2026-09-19): the curated
// key catalog + the env-reflecting store behind GET/PUT/DELETE /api/keys.
// Importing this module runs the idempotent boot fill-gap — every consumer
// keeps its plain process.env reads (that seam is the point).
export * from "./keys.ts";
export * from "./search.ts";
export * from "./settings-body.ts";
export * from "./turn-liveness.ts";
export * from "./turn-runs.ts";
export * from "./dismissal-park.ts";
export * from "./compaction.ts";
export { runPiTurn, piTurnResponse, type PiTurnHandle, type PiTurnSpec } from "./pi/ui-stream.ts";
export * from "./observability.ts";
export * from "./model-catalog.ts";



export * from "./office-config.ts";

export * from "./web-approvals.ts";
export * from "./search.ts";

// Modules app/ routes and pages used to import directly (import-law cleanup).
export * from "./route-scope.ts";
export * from "./user-scope.ts";
export * from "./page-scope.ts";
export * from "./accounts.ts";
export * from "./office-auth.ts";
export * from "./session-auth.ts";
export * from "./source-archive.ts";
export * from "./knowledge-audit.ts";
export * from "./admin.ts";
