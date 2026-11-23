/**
 * PRACTICE-01 (eval 2026-11-24): after one wrong answer commit the model
 * called conclude(movedOn) although the learner never asked to stop. A
 * problem now ends unsolved (movedOn / surrendered) only after the learner
 * sent a message of their own since the pose; an answer commit is an attempt.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concludeTool, createPracticeGate } from "../src/agent/tools/practice.ts";

const pose = { id: "a1", role: "assistant", content: [{ type: "toolCall", id: "p1", name: "problem", arguments: { statement: "1/2 + 1/4 = ?" } }], stopReason: "toolUse", timestamp: 1 };
const poseAck = { id: "r1", role: "toolResult", toolCallId: "p1", toolName: "problem", content: [{ type: "text", text: "Problem posed" }], isError: false, timestamp: 2 };
const commit = { id: "t1", role: "custom", customType: "practice-thinking", content: "My final answer is 2/6.", display: true, timestamp: 3 };
const learner = (text: string) => ({ id: `u_${text.length}`, role: "user", content: text, timestamp: 4 });

async function conclude(messages: unknown[], outcome: string) {
	const gate = createPracticeGate({ chatId: "c", chatStore: { getChat: () => ({ messages: messages as never }) } });
	assert.equal(gate.problemActive, true);
	const result = await concludeTool(gate).execute("call", { outcome, verdict: "v", rung: null, missClass: null, retest: false } as never, undefined as never);
	return { isError: (result as { isError?: boolean }).isError === true, text: JSON.stringify(result.content), gate };
}

describe("the practice end-condition contract", () => {
	it("rejects movedOn / surrendered after only an answer commit, and keeps the problem active", async () => {
		for (const outcome of ["movedOn", "surrendered"]) {
			const { isError, text, gate } = await conclude([pose, poseAck, commit], outcome);
			assert.equal(isError, true, outcome);
			assert.match(text, /minimal nudge/);
			assert.equal(gate.problemActive, true);
		}
	});

	it("allows solved outcomes on an answer commit", async () => {
		assert.equal((await conclude([pose, poseAck, commit], "solved")).isError, false);
		assert.equal((await conclude([pose, poseAck, commit], "solvedWithHints")).isError, false);
	});

	it("allows movedOn once the learner has written to the tutor since the pose", async () => {
		assert.equal((await conclude([pose, poseAck, commit, learner("I want to stop this one")], "movedOn")).isError, false);
	});

	it("a learner message from before the pose does not count", async () => {
		assert.equal((await conclude([learner("practice fractions please"), pose, poseAck, commit], "movedOn")).isError, true);
	});
});
