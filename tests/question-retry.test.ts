/**
 * THE PROBE TOOL GUARD (owner, 2026-11-23): while probing, a prober reply
 * that asks in prose (stops normally with no tool call) re-runs once per
 * learner input with the question-tool instruction. These pins cover the
 * pure decision, the marker, its model face and its quiet view line.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	newQuestionRetryMessage,
	questionRetryId,
	questionRetryOwed,
	toLlmMessages,
} from "../src/core/native-messages.ts";
import { QUESTION_RETRY_TEXT } from "../src/core/contracts/chat.ts";
import { projectView } from "../src/core/view.ts";

const learner = (id: string) => ({ id, role: "user", content: "2", timestamp: 1 });
const prose = (id: string, stopReason = "stop") => ({
	id,
	role: "assistant",
	content: [{ type: "text", text: "What is U|psi>? (Select the correct option)" }],
	stopReason,
	timestamp: 1,
});
const withCall = (id: string, name: string) => ({
	id,
	role: "assistant",
	content: [{ type: "text", text: "Here it is." }, { type: "toolCall", id: `c_${id}`, name, arguments: {} }],
	stopReason: "toolUse",
	timestamp: 1,
});

describe("questionRetryOwed", () => {
	it("is owed for a prose reply while probing, keyed by the learner input", () => {
		assert.equal(questionRetryOwed([learner("u1"), prose("a1")] as never), "u1");
	});

	it("looks past several trailing assistant replies to the input", () => {
		assert.equal(questionRetryOwed([learner("u1"), withCall("a0", "research"), prose("a1")] as never), "u1");
	});

	it("is false when the last reply called a tool", () => {
		assert.equal(questionRetryOwed([learner("u1"), withCall("a1", "probe")] as never), false);
		assert.equal(questionRetryOwed([learner("u1"), withCall("a1", "ask_user_question")] as never), false);
	});

	it("is false once probing is done (teach phase)", () => {
		const messages = [learner("u1"), withCall("a0", "probe_done"), learner("u2"), prose("a1")];
		assert.equal(questionRetryOwed(messages as never), false);
	});

	it("is false for replies that did not stop normally", () => {
		for (const stop of ["error", "aborted", "length"]) {
			assert.equal(questionRetryOwed([learner("u1"), prose("a1", stop)] as never), false, stop);
		}
	});

	it("never nudges twice: a prose reply to the nudge itself is left alone", () => {
		const nudge = newQuestionRetryMessage("chat_q", "u1");
		assert.equal(questionRetryOwed([learner("u1"), prose("a1"), nudge, prose("a2")] as never), false);
	});

	it("is false when the nudge for this input already exists", () => {
		const nudge = { ...newQuestionRetryMessage("chat_q", "u1"), id: questionRetryId("u1") };
		const messages = [learner("u1"), nudge, learner("u1b"), prose("a1")];
		assert.equal(questionRetryOwed(messages as never), "u1b", "a newer input gets its own nudge");
		assert.equal(questionRetryOwed([nudge, learner("u1"), prose("a1")] as never), false);
	});

	it("is false for an empty record or a non-assistant tail", () => {
		assert.equal(questionRetryOwed([]), false);
		assert.equal(questionRetryOwed([learner("u1")] as never), false);
	});
});

describe("the question-retry marker", () => {
	it("carries the instruction to the model as user text", () => {
		const nudge = newQuestionRetryMessage("chat_q", "u1");
		assert.equal(nudge.id, "steer_qretry_u1");
		const wire = toLlmMessages([learner("u1"), prose("a1"), nudge] as never);
		const last = wire.at(-1) as { role: string; content: Array<{ text: string }> };
		assert.equal(last.role, "user");
		assert.equal(last.content[0]!.text, QUESTION_RETRY_TEXT);
	});

	it("renders as a quiet system line, never the instruction text", () => {
		const nudge = newQuestionRetryMessage("chat_q", "u1");
		const view = projectView([learner("u1"), prose("a1"), nudge] as never);
		const line = view.at(-1)!;
		assert.deepEqual(line.parts.map((p) => p.type), ["data-question-retry"]);
		assert.ok(!JSON.stringify(line).includes("plain text"));
	});
});
