/**
 * Today's date and the source-date rule for the researcher (owner,
 * 2026-11-25): without a date, a 2024 Vivado release read as "the latest".
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { researchDate } from "../src/agent/subagents/runner.ts";
import { RESEARCHER_INSTRUCTIONS } from "../src/agent/subagents/researcher.ts";

it("formats today's date like the teacher's, in UTC", () => {
	assert.equal(researchDate(new Date("2026-11-25T03:00:00Z")), "Wednesday, November 25, 2026");
});

it("carries the approved source-date rule", () => {
	assert.ok(RESEARCHER_INSTRUCTIONS.includes(
		"Your background knowledge has a cutoff and may be out of date. For questions about\n" +
		"the latest or current version, release, price or news, rely on what your searches\n" +
		"find, not on memory: check each source's date, prefer the newest, and if every\n" +
		"source you found is old, say so in Gaps.",
	));
});
