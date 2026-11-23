import assert from "node:assert/strict";
import { it } from "node:test";
import { Value } from "typebox/value";
import { teachExplainToolFor, teachQuizToolFor } from "../src/agent/tools.ts";

// Owner, 2026-11-19: a teaching quiz/explain call that leaves out `type` is
// treated as a "check" — the same reading the UI already gives a question with
// no type (normalizeQuizType). Before, the call was rejected and the model
// spent a whole extra call (and apologised to the learner for a "system problem").
const ctx = { chatId: "c", chatStore: {} as never };
const QUIZ = {
	nodeId: "mass-gravity",
	question: "What is gravity in general relativity?",
	options: [{ label: "A pull between masses", value: "pull" }, { label: "Curved spacetime", value: "curvature" }],
	explanation: "Mass curves spacetime; objects follow the curve.",
	correctAnswer: "curvature",
};

it("a teaching quiz without `type` becomes a check and passes the schema", () => {
	const tool = teachQuizToolFor(ctx);
	assert.equal(Value.Check(tool.parameters, QUIZ), false, "without the default it is rejected");
	const prepared = tool.prepareArguments!(QUIZ) as Record<string, unknown>;
	assert.equal(prepared.type, "check");
	assert.ok(Value.Check(tool.parameters, prepared));
});

it("a given type is kept as written", () => {
	const prepared = teachQuizToolFor(ctx).prepareArguments!({ ...QUIZ, type: "predict" }) as Record<string, unknown>;
	assert.equal(prepared.type, "predict");
});

it("explain gets the same default", () => {
	const prepared = teachExplainToolFor(ctx).prepareArguments!({ nodeId: "n", question: "Why?", correctAnswer: "Because." }) as Record<string, unknown>;
	assert.equal(prepared.type, "check");
});

it("other missing fields are still rejected", () => {
	const tool = teachQuizToolFor(ctx);
	const { nodeId: _drop, ...noNode } = QUIZ;
	assert.equal(Value.Check(tool.parameters, tool.prepareArguments!(noNode)), false);
});
