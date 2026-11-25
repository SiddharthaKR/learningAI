/**
 * Short probing (owner, 2026-11-25): the learner's 3rd probing answer ends
 * the probe — by a reminder that rides with the answer, or by a probe_done
 * the app writes from the answers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	codeProbeHandoff,
	newProbeWrapupMessage,
	probingAnswers,
	shortProbeLimitReached,
} from "../src/core/probe-length.ts";
import { hasProbeDone, toLlmMessages } from "../src/core/native-messages.ts";
import { phaseAt3Lh } from "../src/core/phases.ts";
import { PROBE_WRAPUP_TEXT } from "../src/core/contracts/chat.ts";
import { projectView } from "../src/core/view.ts";

const CHAT = "chat_p";
const user = (id: string, text: string) => ({ id, role: "user", content: text, timestamp: 1 });
const say = (id: string, text: string) => ({ id, role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 2 });
const ask = (id: string) => ({ id, role: "assistant", content: [{ type: "toolCall", id: `c_${id}`, name: "probe", arguments: {} }], stopReason: "toolUse", timestamp: 2 });
const answered = (id: string, details: unknown) => ({ id: `r_${id}`, role: "toolResult", toolCallId: `c_${id}`, toolName: "probe", content: [], details, isError: false, timestamp: 3 });

// The owner's Ohm's law probe, shortened: topic, then three typed replies to prose questions.
const ohm = [
	user("u0", "teach me ohms law"),
	say("a1", "What is your goal?\nIs it the physics behind it?"),
	user("u1", "physics behind it"),
	say("a2", "Which analogy would you choose for voltage and current?"),
	user("u2", "like water in a pipe"),
	ask("q3"),
	answered("q3", { questionText: "Hotter wire: does resistance increase or decrease?", answers: [{ label: "Increase" }], correct: true }),
];

describe("probingAnswers", () => {
	it("counts typed replies after the topic and question-tool answers, with the question they answer", () => {
		const answers = probingAnswers(ohm as never);
		assert.equal(answers.length, 3);
		assert.deepEqual(answers[0], { question: "Is it the physics behind it?", text: "physics behind it" });
		assert.deepEqual(answers[2], { question: "Hotter wire: does resistance increase or decrease?", chosen: ["Increase"], correct: true });
	});

	it("skips dismissed questions and is empty once the probe concluded", () => {
		const dismissed = [...ohm.slice(0, 5), ask("q3"), answered("q3", { questionText: "Q", dismissed: true })];
		assert.equal(probingAnswers(dismissed as never).length, 2);
		const done = [...ohm, ...codeProbeHandoff(ohm as never, CHAT, "en")];
		assert.equal(probingAnswers(done as never).length, 0);
	});
});

describe("shortProbeLimitReached", () => {
	it("fires at the 3rd answer, once per session", () => {
		assert.equal(shortProbeLimitReached(ohm.slice(0, 5) as never), false, "2 answers");
		assert.equal(shortProbeLimitReached(ohm as never), true, "3 answers");
		assert.equal(shortProbeLimitReached([...ohm, newProbeWrapupMessage(CHAT, "reminder")] as never), false, "already sent");
	});
});

describe("the reminder mode", () => {
	it("sends the approved note to the model and shows the quiet line", () => {
		const record = [...ohm, newProbeWrapupMessage(CHAT, "reminder")];
		assert.ok(JSON.stringify(toLlmMessages(record as never)).includes(PROBE_WRAPUP_TEXT.slice(0, 60)));
		assert.ok(projectView(record as never).some((m) => m.parts.some((p) => p.type === "data-probe-wrapup")));
		assert.equal(
			PROBE_WRAPUP_TEXT,
			"That was the learner's last probing answer: probing is set to Short. Do not ask another question and do not teach. Conclude now with probe_done, reporting what the answers so far show; mark anything untested as still to check.",
		);
	});
});

describe("the code mode", () => {
	it("writes a concluded probe_done from the answers and hands off to the teacher", () => {
		const added = codeProbeHandoff(ohm as never, CHAT, "en");
		const record = [...ohm, ...added];
		assert.equal(hasProbeDone(record as never), true);
		assert.equal(phaseAt3Lh(record as never), "plan");
		assert.equal((added.at(-1) as { customType?: string }).customType, "probe-handoff");
		const call = (added[1] as unknown as { content: Array<{ arguments: { assessment: { summary: string; strands: Array<{ strand: string; assessment: string }> } } }> }).content[0]!;
		const { summary, strands } = call.arguments.assessment;
		assert.equal(summary, 'Probing ended after 3 answers (Short). The learner\'s goal: "teach me ohms law". Built from the answers below, not written by the tutor.');
		assert.deepEqual(strands[1], { strand: "Which analogy would you choose for voltage and current?", assessment: 'The learner answered: "like water in a pipe".' });
		assert.deepEqual(strands[2], { strand: "Hotter wire: does resistance increase or decrease?", assessment: 'The learner chose "Increase" - correct.' });
	});

	it("keeps its wrap-up line out of the teacher's context", () => {
		const record = [...ohm, ...codeProbeHandoff(ohm as never, CHAT, "en")];
		assert.ok(!JSON.stringify(toLlmMessages(record as never)).includes("Wrapping up"));
		assert.ok(!JSON.stringify(toLlmMessages(record as never)).includes(PROBE_WRAPUP_TEXT.slice(0, 40)));
		assert.ok(projectView(record as never).some((m) => m.parts.some((p) => p.type === "data-probe-wrapup")));
	});

	it("writes the approved Japanese wording for Japanese sessions", () => {
		const call = (codeProbeHandoff(ohm as never, CHAT, "ja")[1] as unknown as { content: Array<{ arguments: { assessment: { summary: string; strands: Array<{ assessment: string }> } } }> }).content[0]!;
		assert.equal(call.arguments.assessment.summary, "事前チェックは3回の回答で終了しました（短く）。学習者の目標: 「teach me ohms law」。以下の回答をもとに作成し、講師が書いたものではありません。");
		assert.equal(call.arguments.assessment.strands[2]!.assessment, "学習者の選択: 「Increase」— 正解");
	});
});
