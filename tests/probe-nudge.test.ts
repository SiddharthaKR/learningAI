/**
 * The probe-nudge (owner, 2026-11-19): Gemma 4 26B ended 1 of 6 probing turns
 * with no question at all (it only planned), leaving the learner nothing to
 * answer. When a probing turn ends with no tool call, the app sends the model
 * one reminder — at most once per learner input, never after probe_done.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newProbeNudgeMessage, probeNudgeOwed, toLlmMessages } from "../src/core/native-messages.ts";
import { PROBE_QUESTION_NUDGE_TEXT } from "../src/core/contracts/chat.ts";
import { projectView } from "../src/core/view.ts";

const CHAT = "chat_x";
const user = { id: "u1", role: "user", content: "teach me black holes", timestamp: 1 };
// A turn that showed the learner nothing: only thinking (the measured failure).
const textOnly = (id = "a1", stopReason = "stop") => ({ id, role: "assistant", content: [{ type: "thinking", thinking: "Let me plan the strands…" }, { type: "text", text: "  " }], stopReason, timestamp: 2 });
const withCall = (name: string) => ({ id: "a2", role: "assistant", content: [{ type: "toolCall", id: "c1", name, arguments: {} }], stopReason: "toolUse", timestamp: 2 });

describe("probeNudgeOwed", () => {
	it("is owed when a probing turn ended with only text", () => {
		assert.equal(probeNudgeOwed([user, textOnly()] as never), true);
	});

	it("is not owed when the turn wrote its question as text (owner report, 2026-11-19)", () => {
		// The 26B asked "Which of these sounds most like your goal?" as a numbered
		// list; the reminder fired, and the model apologised and asked again.
		const written = { id: "a1", role: "assistant", content: [{ type: "text", text: "Which of these sounds most like your goal?\n1. Overview\n2. Ethics" }], stopReason: "stop", timestamp: 2 };
		assert.equal(probeNudgeOwed([user, written] as never), false);
	});

	it("is not owed when the turn asked something or called any tool (e.g. research)", () => {
		assert.equal(probeNudgeOwed([user, withCall("probe")] as never), false);
		assert.equal(probeNudgeOwed([user, withCall("research")] as never), false);
	});

	it("is not owed after probe_done, after an error, or after a stop", () => {
		const done = [user, withCall("probe_done"), { id: "r", role: "toolResult", toolCallId: "c1", toolName: "probe_done", content: [], isError: false, timestamp: 3 }, textOnly("a3")];
		assert.equal(probeNudgeOwed(done as never), false);
		assert.equal(probeNudgeOwed([user, textOnly("a1", "error")] as never), false);
		assert.equal(probeNudgeOwed([user, textOnly("a1", "aborted")] as never), false);
	});

	it("fires at most once per learner input", () => {
		const nudge = newProbeNudgeMessage(CHAT, 2);
		assert.equal(probeNudgeOwed([user, textOnly(), nudge, textOnly("a3")] as never), false);
		// A new learner answer resets it.
		const answer = { id: "r2", role: "toolResult", toolCallId: "q1", toolName: "probe", content: [], isError: false, timestamp: 5 };
		assert.equal(probeNudgeOwed([user, textOnly(), nudge, withCall("probe"), answer, textOnly("a4")] as never), true);
	});
});

describe("the nudge message", () => {
	it("carries the approved text to the model and renders as a quiet line", () => {
		const nudge = newProbeNudgeMessage(CHAT, 2);
		assert.equal(nudge.customType, "probe-nudge");
		assert.equal(nudge.content, PROBE_QUESTION_NUDGE_TEXT);
		assert.equal(PROBE_QUESTION_NUDGE_TEXT, "Your turn ended without a question. While probing, every turn ends with one question (the quiz tool or ask_user_question) or with probe_done. Ask your next question now.");
		assert.deepEqual((nudge.details as { chatId: string }).chatId, CHAT);
		const llm = toLlmMessages([user, textOnly(), nudge] as never);
		assert.ok(JSON.stringify(llm).includes("Your turn ended without a question."));
		const view = projectView([user, textOnly(), nudge] as never);
		assert.ok(view.some((m) => m.parts.some((p) => p.type === "data-probe-nudge")));
	});
});
