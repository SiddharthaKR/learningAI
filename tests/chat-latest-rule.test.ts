/**
 * The chat's rule for "latest" questions (owner, 2026-11-25): the chat
 * answered "2024.2" from memory in the message that dispatched research.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

it("the chat instructions carry the approved latest-questions rule", () => {
	const chat = composeInstructions("chat");
	assert.ok(chat.includes("When web research is on, dispatch research and answer only from the brief"));
	assert.ok(chat.includes("When web research is off, answer from what you know and add one sentence that it may be out of date"));
	assert.ok(!composeInstructions("teacher").includes("answer only from the brief"), "teach mode keeps its own research doctrine");
});
