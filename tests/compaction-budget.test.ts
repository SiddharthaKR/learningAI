/**
 * MEMORY-02 (eval 2026-11-24): with a 32k window the trigger is 16,384 tokens,
 * but compaction always kept 20k of recent history, so the compacted context
 * stayed over the trigger and later compactions were skipped. The kept tail is
 * now at most half of what the threshold leaves after the system prompt.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEEP_RECENT_TOKENS } from "../src/core/compaction.ts";
import { effectiveThresholdTokens, keptTailBudget } from "../src/server/compaction.ts";

describe("keptTailBudget", () => {
	it("keeps the full 20k tail on large windows", () => {
		assert.equal(keptTailBudget(150_000, 10_000), KEEP_RECENT_TOKENS);
	});

	it("fits a 32k window: tail + system prompt stay well under the trigger", () => {
		const threshold = effectiveThresholdTokens(undefined, 32_768);
		assert.equal(threshold, 16_384);
		const tail = keptTailBudget(threshold, 9_901);
		assert.equal(tail, 3_241);
		assert.ok(9_901 + tail < threshold);
	});

	it("never goes below one token", () => {
		assert.equal(keptTailBudget(8_000, 12_000), 1);
	});
});
