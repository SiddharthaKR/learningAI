/**
 * Extraction runs with thinking off (owner, 2026-11-24): with the 4,096-token
 * output cap enforced, Gemma spent it all thinking and never submitted its
 * findings, so every extraction batch failed.
 */
import assert from "node:assert/strict";
import { it } from "node:test";

process.env.LLM_REASONING = "true";
const { extractionEngine } = await import("../src/server/chat-handler.ts");

it("the extractor and auditor engines run with thinking off", () => {
	assert.equal(extractionEngine("extractor")?.level, "off");
	assert.equal(extractionEngine("auditor")?.level, "off");
});
