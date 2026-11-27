import { normalizeContext } from "@earendil-works/pi-ai";
import { piEngineForSpec } from "../agent/models.ts";
import type { AnswerKeyCheck } from "../agent/tools.ts";
import { ANSWER_KEY_CHECK_SYSTEM, answerKeyCheckPrompt, answerKeyMismatch } from "../core/question-core.ts";
import { officeConfig } from "../core/office-config.ts";
import { fixedOfficeModelSpec } from "./office-config.ts";

/** How long the check may take before the quiz goes through unchecked. */
export const ANSWER_KEY_CHECK_TIMEOUT_MS = 10_000;
export const ANSWER_KEY_CHECK_MAX_TOKENS = 1024;

/**
 * The quiz answer-key check (owner, 2026-11-19): one small call to the same
 * model — no tools, thinking off, a few output tokens — asking which option
 * the explanation supports. Built only when QUIZ_ANSWER_CHECK is on (the
 * default). Fail-open: a timeout, an error or an unclear reply lets the quiz
 * through, so the check can never stall a lesson.
 */
export function answerKeyCheck(spec: { provider: string; id: string } = fixedOfficeModelSpec()): AnswerKeyCheck | undefined {
	if (!officeConfig().quizAnswerCheck) return undefined;
	return async (input, signal) => {
		const engine = piEngineForSpec({ ...spec, thinkingLevel: "off" });
		const timeout = AbortSignal.timeout(ANSWER_KEY_CHECK_TIMEOUT_MS);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const stream = engine.streamFn(
			engine.model,
			normalizeContext({
				systemPrompt: ANSWER_KEY_CHECK_SYSTEM,
				messages: [{ role: "user", content: answerKeyCheckPrompt(input), timestamp: Date.now() }],
				tools: [],
			}),
			// Room for models that always think first (Gemma 4 on Google AI
			// Studio used ~400–900 thinking tokens; 200 left no answer). A model
			// that does not think stops after its one-word reply, so this costs
			// nothing there.
			{ maxTokens: ANSWER_KEY_CHECK_MAX_TOKENS, signal: combined } as never,
		);
		for await (const event of stream) {
			if (event.type === "done") {
				const reply = event.message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
				return answerKeyMismatch(input, reply);
			}
			if (event.type === "error") return null;
		}
		return null;
	};
}
