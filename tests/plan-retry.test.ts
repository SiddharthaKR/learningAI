/**
 * THE PLAN-RETRY NUDGE (owner, 2026-11-13): one nudge after the probe->plan
 * handoff when planning settles with no successful plan_init. These pins
 * cover the pure decision in planRetryOwed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planRetryId, planRetryOwed } from "../src/core/native-messages.ts";

const CHAT = "chat_pr";
const probe = { id: `steer_probe_${CHAT}`, role: "custom", customType: "probe-handoff" };
const planInitRejected = (error: string) => ({
	id: "tr_1",
	role: "toolResult",
	toolName: "plan_init",
	details: { ok: false, error },
});

describe("planRetryOwed", () => {
	it("is false before the probe handoff marker exists", () => {
		assert.equal(planRetryOwed(CHAT, [planInitRejected("bad")] as never), false);
	});

	it("returns the last plan_init rejection when no plan block exists", () => {
		const messages = [
			probe,
			planInitRejected("first problem"),
			planInitRejected("second problem"),
		];
		assert.equal(planRetryOwed(CHAT, messages as never), "second problem");
	});

	it("returns null when the handoff exists but plan_init was never called", () => {
		assert.equal(planRetryOwed(CHAT, [probe] as never), null);
	});

	it("is false once a plan-block marker exists", () => {
		const planBlock = { id: "plan_block_1", role: "custom", customType: "plan-block" };
		assert.equal(planRetryOwed(CHAT, [probe, planInitRejected("bad"), planBlock] as never), false);
	});

	it("is false once the plan-retry marker already exists", () => {
		const retry = { id: planRetryId(CHAT), role: "custom", customType: "plan-retry" };
		assert.equal(planRetryOwed(CHAT, [probe, planInitRejected("bad"), retry] as never), false);
	});
});
