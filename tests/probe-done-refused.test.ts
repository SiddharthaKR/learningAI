/**
 * A REFUSED probe_done does not conclude the probe (2026-11-25). Refusals
 * return { ok: false, error } as a normal (non-error) result; before, routing
 * (hasProbeDone: any call) and the phase fold (any non-error result) both
 * treated them as concluded.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasProbeDone } from "../src/core/native-messages.ts";
import { phaseAt3Lh, probeDoneConcluded } from "../src/core/phases.ts";

const user = { id: "u1", role: "user", content: "teach me ohms law", timestamp: 1 };
const call = { id: "a1", role: "assistant", content: [{ type: "toolCall", id: "c1", name: "probe_done", arguments: {} }], stopReason: "toolUse", timestamp: 2 };
const result = (details: unknown, isError = false) => ({ id: "r1", role: "toolResult", toolCallId: "c1", toolName: "probe_done", content: [], details, isError, timestamp: 3 });

describe("probe_done conclusion", () => {
	it("a successful result concludes: teacher routing and the plan phase agree", () => {
		const record = [user, call, result({ ok: true })] as never;
		assert.equal(hasProbeDone(record), true);
		assert.equal(phaseAt3Lh(record), "plan");
	});

	it("a refused result (ok: false) does not conclude", () => {
		const record = [user, call, result({ ok: false, error: "A question is still open" })] as never;
		assert.equal(hasProbeDone(record), false);
		assert.equal(phaseAt3Lh(record), "probe");
	});

	it("an errored result or a call with no result does not conclude", () => {
		assert.equal(hasProbeDone([user, call, result(null, true)] as never), false);
		assert.equal(hasProbeDone([user, call] as never), false);
	});

	it("older records without the ok flag still count as concluded", () => {
		assert.equal(probeDoneConcluded({ assessment: {} }), true);
		assert.equal(probeDoneConcluded(null), true);
		assert.equal(probeDoneConcluded({ ok: false }), false);
	});
});
