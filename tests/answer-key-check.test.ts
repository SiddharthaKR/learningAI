/**
 * The quiz answer-key check (owner, 2026-11-19): before a quiz reaches the
 * learner, one small model call reads the explanation and names the option it
 * supports; if that is not correctAnswer, the quiz goes back to the model.
 * Fail-open everywhere: an unclear reply never blocks a quiz.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANSWER_KEY_CHECK_SYSTEM, answerKeyCheckPrompt, answerKeyMismatch } from "../src/core/question-core.ts";
import { probeQuizToolFor, teachQuizToolFor, type AnswerKeyCheck } from "../src/agent/tools.ts";
import { officeConfig } from "../src/core/office-config.ts";
import { answerKeyCheck } from "../src/server/answer-key-check.ts";

const QUIZ = {
	question: "Which mechanism slows the sender when the receiver's buffer is full?",
	options: [
		{ label: "Congestion control", value: "congestion-control" },
		{ label: "Flow control", value: "flow-control" },
	],
	explanation: "Flow control protects the receiver's buffer; congestion control protects the network.",
	correctAnswer: "flow-control",
};

describe("answerKeyCheckPrompt", () => {
	it("shows the question, every option value and label, and the explanation — never the key", () => {
		const prompt = answerKeyCheckPrompt(QUIZ);
		for (const part of [QUIZ.question, "congestion-control", "Congestion control", "flow-control", "Flow control", QUIZ.explanation]) {
			assert.ok(prompt.includes(part), part);
		}
		assert.ok(!/correct/i.test(prompt.replace(QUIZ.question, "").replace(QUIZ.explanation, "")), "the key is not revealed to the checker");
		assert.match(ANSWER_KEY_CHECK_SYSTEM, /only the value/i);
	});
});

describe("answerKeyMismatch", () => {
	it("agrees: no problem", () => {
		assert.equal(answerKeyMismatch(QUIZ, "flow-control"), null);
		assert.equal(answerKeyMismatch(QUIZ, " `flow-control`. "), null);
		assert.equal(answerKeyMismatch(QUIZ, "Flow-Control"), null);
	});

	it("disagrees: one problem naming both options", () => {
		const problem = answerKeyMismatch({ ...QUIZ, correctAnswer: "congestion-control" }, "flow-control");
		assert.ok(problem);
		assert.match(problem!, /"flow-control"/);
		assert.match(problem!, /"congestion-control"/);
	});

	it("a sentence that names exactly one option is read; anything unclear passes (fail-open)", () => {
		assert.equal(answerKeyMismatch(QUIZ, "The explanation supports flow-control."), null);
		assert.equal(answerKeyMismatch(QUIZ, "I am not sure."), null);
		assert.equal(answerKeyMismatch(QUIZ, "flow-control or congestion-control"), null);
		assert.equal(answerKeyMismatch(QUIZ, ""), null);
	});

	it("multi-select quizzes are not checked", () => {
		assert.equal(answerKeyMismatch({ ...QUIZ, multiSelect: true, correctAnswer: ["congestion-control"] }, "flow-control"), null);
	});
});

describe("QUIZ_ANSWER_CHECK", () => {
	it("is on when unset, off when false, and rejects anything else", () => {
		const saved = process.env.QUIZ_ANSWER_CHECK;
		try {
			delete process.env.QUIZ_ANSWER_CHECK;
			assert.equal(officeConfig().quizAnswerCheck, true);
			process.env.QUIZ_ANSWER_CHECK = "false";
			assert.equal(officeConfig().quizAnswerCheck, false);
			assert.equal(answerKeyCheck(), undefined, "off = no check built");
			process.env.QUIZ_ANSWER_CHECK = "maybe";
			assert.throws(() => officeConfig(), /QUIZ_ANSWER_CHECK/);
		} finally {
			if (saved === undefined) delete process.env.QUIZ_ANSWER_CHECK; else process.env.QUIZ_ANSWER_CHECK = saved;
		}
	});
});

describe("the quiz tools run the check", () => {
	const wrong = { ...QUIZ, correctAnswer: "congestion-control" };
	const checker = (reply: string): AnswerKeyCheck => async (input) => answerKeyMismatch(input, reply);

	it("a mismatch sends the quiz back to the model", async () => {
		const result = await probeQuizToolFor(checker("flow-control")).execute("t", wrong as never);
		assert.equal(result.isError, true);
		assert.match(JSON.stringify(result.content), /Answer-key check/);
	});

	it("an agreeing check, no check, or a failing check lets the quiz through", async () => {
		const ok = await probeQuizToolFor(checker("flow-control")).execute("t", QUIZ as never);
		assert.notEqual(ok.isError, true);
		assert.notEqual((await probeQuizToolFor().execute("t", wrong as never)).isError, true);
		const broken: AnswerKeyCheck = async () => { throw new Error("model down"); };
		assert.notEqual((await probeQuizToolFor(broken).execute("t", wrong as never)).isError, true);
	});

	it("the teaching quiz runs it too", async () => {
		const tree = { nodes: [{ id: "flow", title: "Flow control" }], edges: [] };
		const chatStore = { getChat: () => ({ messages: [], tree }), loadTree: () => tree, getTree: () => tree } as never;
		const tool = teachQuizToolFor({ chatId: "c", chatStore, checkAnswerKey: checker("flow-control") });
		const result = await tool.execute("t", { ...wrong, type: "check", nodeId: "flow" } as never);
		assert.equal(result.isError, true);
		assert.match(JSON.stringify(result.content), /Answer-key check/);
	});
});
