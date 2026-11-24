/**
 * The researcher runs with thinking off (owner, 2026-11-25): it thought on
 * each of up to 12 search/fetch steps and research took minutes. Other jobs
 * keep the configured default.
 */
import assert from "node:assert/strict";
import { it } from "node:test";

process.env.LLM_REASONING = "true";
const { jobEngine } = await import("../src/server/chat-handler.ts");

it("the researcher job engine runs with thinking off; other jobs keep the default", () => {
	assert.equal(jobEngine("researcher")?.level, "off");
	assert.notEqual(jobEngine("teacher")?.level, "off");
});
