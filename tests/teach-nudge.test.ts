/**
 * The teach-nudge (owner, 2026-11-24): Gemma 12B asked every teaching question
 * in prose (no answer box) and E4B ended turns with "let's test it" and no
 * question. When a teaching turn ends with no tool call, the app sends the
 * model one reminder — at most once per learner input.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newTeachNudgeMessage, probeNudgeOwed, teachNudgeOwed, toLlmMessages } from "../src/core/native-messages.ts";
import { TEACH_QUESTION_NUDGE_TEXT } from "../src/core/contracts/chat.ts";
import { projectView } from "../src/core/view.ts";

const CHAT = "chat_t";
const user = (id = "u1", text = "Yes, the plan looks good.") => ({ id, role: "user", content: text, timestamp: 1 });
const call = (id: string, name: string, args: unknown = {}) => ({ id, role: "assistant", content: [{ type: "toolCall", id: `c_${id}`, name, arguments: args }], stopReason: "toolUse", timestamp: 2 });
const result = (id: string, callId: string, name: string) => ({ id, role: "toolResult", toolCallId: callId, toolName: name, content: [], isError: false, timestamp: 3 });
const planBlock = { id: "pb1", role: "custom", customType: "plan-block", content: "", display: true, details: {}, timestamp: 4 };
const prose = (id = "a9", stopReason = "stop", text = "Imagine a narrower pipe. What happens to the flow rate?") =>
	({ id, role: "assistant", content: [{ type: "text", text }], stopReason, timestamp: 5 });
// Probe concluded, plan presented: the teaching phase.
const planned = [
	user("u0", "teach me Ohm's law"),
	call("p1", "probe_done"), result("r1", "c_p1", "probe_done"),
	call("p2", "plan_init"), result("r2", "c_p2", "plan_init"), planBlock,
];

describe("teachNudgeOwed", () => {
	it("is owed when a teaching turn asked its question in prose", () => {
		assert.equal(teachNudgeOwed([...planned, user(), prose()] as never), true);
	});

	it("is owed when the turn showed nothing (thinking only)", () => {
		assert.equal(teachNudgeOwed([...planned, user(), prose("a9", "stop", "  ")] as never), true);
	});

	it("is not owed for a goodbye or explanation with no question (owner, 2026-11-24)", () => {
		// 12B said goodbye after "That's all for now"; the nudge made it re-ask "what next?".
		const bye = prose("a9", "stop", "You're very welcome. Have a great rest of your day!");
		assert.equal(teachNudgeOwed([...planned, user("u2", "That's all for now, thanks."), bye] as never), false);
	});

	it("counts a Japanese full-width question mark", () => {
		assert.equal(teachNudgeOwed([...planned, user(), prose("a9", "stop", "電圧はどうなりますか？")] as never), true);
	});

	it("is not owed when the turn ended on a question tool", () => {
		assert.equal(teachNudgeOwed([...planned, user(), call("q1", "quiz", { nodeId: "a" })] as never), false);
		assert.equal(teachNudgeOwed([...planned, user(), call("q2", "ask_user_question")] as never), false);
	});

	it("is not owed before a plan exists, while probing, or after an error or stop", () => {
		const noPlan = [user("u0"), call("p1", "probe_done"), result("r1", "c_p1", "probe_done"), prose()];
		assert.equal(teachNudgeOwed(noPlan as never), false, "the plan-retry nudge owns the no-plan case");
		assert.equal(teachNudgeOwed([user(), prose()] as never), false, "probing belongs to the probe-nudge");
		assert.equal(teachNudgeOwed([...planned, user(), prose("a9", "error")] as never), false);
		assert.equal(teachNudgeOwed([...planned, user(), prose("a9", "aborted")] as never), false);
	});

	it("is not owed on the presenting turn (it ends on plan_init and its plan block)", () => {
		assert.equal(teachNudgeOwed(planned as never), false);
	});

	it("fires at most once per learner input", () => {
		const nudge = newTeachNudgeMessage(CHAT, 9);
		assert.equal(teachNudgeOwed([...planned, user(), prose(), nudge, prose("a10")] as never), false);
		assert.equal(teachNudgeOwed([...planned, user(), prose(), nudge, prose("a10"), user("u2", "ok"), prose("a11")] as never), true);
	});

	it("never overlaps the probe-nudge", () => {
		assert.equal(probeNudgeOwed([...planned, user(), prose("a9", "stop", " ")] as never), false);
	});
});

describe("the teach-nudge message", () => {
	it("carries the approved text to the model and renders as a quiet line", () => {
		const nudge = newTeachNudgeMessage(CHAT, 9);
		assert.equal(nudge.customType, "teach-nudge");
		assert.equal(nudge.id, `steer_teachnudge_${CHAT}_9`);
		assert.equal(
			TEACH_QUESTION_NUDGE_TEXT,
			"Your turn ended without a question. While teaching, every turn ends with a question tool: the quiz tool (a prediction or a check) or ask_user_question. A question written in your message gets no answer box, so the learner cannot answer it. Ask your next question now with a tool. If the lesson is complete, ask with ask_user_question what the learner wants to do next.",
		);
		const llm = toLlmMessages([...planned, user(), prose(), nudge] as never);
		assert.ok(JSON.stringify(llm).includes("While teaching, every turn ends with a question tool"));
		const view = projectView([...planned, user(), prose(), nudge] as never);
		assert.ok(view.some((m) => m.parts.some((p) => p.type === "data-teach-nudge")));
	});
});
