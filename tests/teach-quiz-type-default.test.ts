/**
 * TEACH-01 (eval 2026-11-24): Gemma writes tool arguments alphabetically, so
 * `type` came last and was dropped twice; both quiz calls failed validation
 * and no question card appeared. A missing `type` now defaults to "check" (the
 * role the display already gives a typeless call); invalid values still fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import { explainInputObject, quizInputObject } from "../src/core/question-core.ts";
import { prepareTeachQuestionArguments, teachExplainToolFor, teachQuizToolFor } from "../src/agent/tools.ts";
import { withArgumentHeal } from "../src/agent/tools/heal.ts";

const ctx = { chatId: "c", chatStore: {} as never };
const quizArgs = {
	correctAnswer: "a",
	explanation: "8 is the piece size, 3 is the count.",
	nodeId: "truth",
	options: [{ label: "8 is the size, 3 the count" }, { label: "3 is the size, 8 the count" }],
	question: "In 3/8, what do the numbers mean?",
};

describe("teach question type default", () => {
	it("fills type: check when the model omits it, and the call validates", () => {
		const tool = withArgumentHeal(teachQuizToolFor(ctx));
		const prepared = tool.prepareArguments!(quizArgs) as Record<string, unknown>;
		assert.equal(prepared.type, "check");
		assert.ok(Value.Check(quizInputObject, prepared), JSON.stringify([...Value.Errors(quizInputObject, prepared)].slice(0, 3)));
	});

	it("keeps an explicit type, and leaves an invalid one for validation to reject", () => {
		assert.equal((prepareTeachQuestionArguments({ ...quizArgs, type: "predict" }) as { type: string }).type, "predict");
		const invalid = prepareTeachQuestionArguments({ ...quizArgs, type: "later" }) as Record<string, unknown>;
		assert.equal(invalid.type, "later");
		assert.equal(Value.Check(quizInputObject, invalid), false);
	});

	it("applies to the teach explain tool too", () => {
		const prepared = teachExplainToolFor(ctx).prepareArguments!({ nodeId: "truth", question: "q", answer: "a" }) as Record<string, unknown>;
		assert.equal(prepared.type, "check");
		assert.ok("type" in explainInputObject.properties);
	});
});
