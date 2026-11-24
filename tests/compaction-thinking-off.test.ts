/**
 * The compaction summary runs with thinking off (owner, 2026-11-24): it is a
 * text job, and thinking under the 4,096-token output cap made it slow and
 * could use the whole cap before any summary was written.
 */
import assert from "node:assert/strict";
import { it } from "node:test";

process.env.LLM_REASONING = "true";
const { compactionEngine } = await import("../src/server/chat-handler.ts");

it("the compaction summary engine runs with thinking off", () => {
	assert.equal(compactionEngine()?.level, "off");
});
