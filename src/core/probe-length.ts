/**
 * Short probing (owner, 2026-11-25). The Probing preference is Short by
 * default: once the learner has given PROBE_SHORT_ANSWER_LIMIT probing
 * answers and the probe has not concluded, the app ends it. Gemma 12B
 * probed an Ohm's law session for 10 turns with no tool call, never called
 * probe_done, and started teaching after the learner's first "don't know".
 *
 * Two ways to end it, both built here and compared in live tests:
 *   - "reminder": a hidden note rides with the 3rd answer, so the prober's
 *     very next reply concludes with its own probe_done (no extra turn).
 *   - "code": the app writes the probe_done itself from the actual answers
 *     and queues the handoff, so the teacher plans straight away (no prober
 *     turn at all).
 *
 * Counted answers: results of the probing question tools (not dismissals)
 * and typed learner messages after the first one (the topic request).
 * Pure: native messages in, native messages out.
 */

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { PROBE_DONE_ACK_TEXT } from "./contracts/probe.ts";
import { PROBE_WRAPUP_TEXT } from "./contracts/chat.ts";
import { QUESTION_TOOLS } from "./pending.ts";
import { hasProbeDone, newHandoffMessage, newMessageId, type LhMarkerMessage, type LhMessage } from "./native-messages.ts";

export const PROBE_SHORT_ANSWER_LIMIT = 3;

export type ProbeWrapupMode = "reminder" | "code";

/** One learner answer during probing, in the shape the code hand-off needs. */
export interface ProbingAnswer {
	question: string;
	/** A free-text answer (typed reply, recall, ask without options). */
	text?: string;
	/** Chosen option labels (quiz/ask with options). */
	chosen?: string[];
	/** Graded quizzes only. */
	correct?: boolean;
	dontKnow?: boolean;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => (part as { type?: string }).type === "text")
		.map((part) => (part as { text: string }).text)
		.join("\n");
}

/** The question a typed reply answers: the last line with a question mark
 *  in the preceding assistant text, else the end of that text. */
function questionBefore(messages: readonly LhMessage[], index: number): string {
	for (let i = index - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; content?: unknown };
		if (m.role !== "assistant") continue;
		const text = textOf(m.content).trim();
		if (!text) continue;
		const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
		const asked = [...lines].reverse().find((l) => /[?？]/.test(l));
		const line = asked ?? lines[lines.length - 1] ?? "";
		return line.length > 300 ? `${line.slice(0, 297)}...` : line;
	}
	return "";
}

/** Every learner probing answer so far (empty once the probe concluded). */
export function probingAnswers(messages: readonly LhMessage[]): ProbingAnswer[] {
	if (hasProbeDone(messages)) return [];
	const out: ProbingAnswer[] = [];
	let seenTopic = false;
	messages.forEach((m, index) => {
		const role = (m as { role?: string }).role;
		if (role === "user") {
			if (!seenTopic) { seenTopic = true; return; }
			const text = textOf((m as { content?: unknown }).content).trim();
			if (text) out.push({ question: questionBefore(messages, index), text });
			return;
		}
		if (role !== "toolResult") return;
		const result = m as ToolResultMessage;
		if (result.isError || !(QUESTION_TOOLS as readonly string[]).includes(result.toolName)) return;
		const d = (result.details ?? {}) as {
			questionText?: string; dismissed?: boolean; dontKnow?: boolean; correct?: boolean;
			answers?: Array<{ label?: string } | string>; text?: string; other?: string;
		};
		if (d.dismissed === true) return;
		const chosen = (Array.isArray(d.answers) ? d.answers : [])
			.map((a) => (typeof a === "string" ? a : a?.label))
			.filter((l): l is string => typeof l === "string" && l.trim().length > 0);
		const text = [d.text, d.other].filter((t): t is string => typeof t === "string" && t.trim().length > 0).join(" ").trim();
		out.push({
			question: d.questionText ?? "",
			...(text ? { text } : {}),
			...(chosen.length ? { chosen } : {}),
			...(typeof d.correct === "boolean" && !d.dontKnow ? { correct: d.correct } : {}),
			...(d.dontKnow ? { dontKnow: true } : {}),
		});
	});
	return out;
}

/** Has a wrap-up already been sent this session? */
function wrapupSent(messages: readonly LhMessage[]): boolean {
	return messages.some((m) => (m as { role?: string }).role === "custom" && (m as LhMarkerMessage).customType === "probe-wrapup");
}

/** Should Short probing end the probe now? Only while probing, at or past
 *  the limit, and once per session. */
export function shortProbeLimitReached(messages: readonly LhMessage[]): boolean {
	return !wrapupSent(messages) && probingAnswers(messages).length >= PROBE_SHORT_ANSWER_LIMIT;
}

/** The wrap-up marker: the quiet "Wrapping up the questions…" line. In
 *  reminder mode the model reads PROBE_WRAPUP_TEXT; in code mode it is
 *  UI-only (toLlmMessages skips it — the teacher must not read it). */
export function newProbeWrapupMessage(chatId: string, mode: ProbeWrapupMode): LhMarkerMessage {
	return {
		id: `steer_probewrapup_${chatId}`,
		role: "custom",
		customType: "probe-wrapup",
		content: mode === "reminder" ? PROBE_WRAPUP_TEXT : "",
		display: true,
		details: { chatId, mode },
		timestamp: Date.now(),
	};
}

function quote(text: string, language: "en" | "ja"): string {
	return language === "ja" ? `「${text}」` : `"${text}"`;
}

/** One answer as an assessment line (owner-approved format, 2026-11-25). */
function answerLine(answer: ProbingAnswer, language: "en" | "ja"): string {
	const verdict = answer.correct === undefined ? "" : language === "ja"
		? (answer.correct ? "— 正解" : "— 不正解")
		: (answer.correct ? " - correct." : " - incorrect.");
	if (answer.dontKnow) {
		return language === "ja" ? `学習者の回答: ${quote("わかりません", language)}` : `The learner answered: ${quote("I don't know", language)}.`;
	}
	if (answer.chosen?.length) {
		const chosen = quote(answer.chosen.join(", "), language);
		return language === "ja" ? `学習者の選択: ${chosen}${verdict}` : `The learner chose ${chosen}${verdict || "."}`;
	}
	const text = quote(answer.text ?? "", language);
	return language === "ja" ? `学習者の回答: ${text}` : `The learner answered: ${text}.`;
}

/** The code hand-off: a probe_done the app writes from the actual answers
 *  (owner-approved format), its ack, and the handoff marker that starts the
 *  teacher. Appended after the learner's answer in the same request, so the
 *  teacher plans in this turn. */
export function codeProbeHandoff(
	messages: readonly LhMessage[],
	chatId: string,
	language: "en" | "ja",
): LhMessage[] {
	const answers = probingAnswers(messages);
	const topicMessage = messages.find((m) => (m as { role?: string }).role === "user");
	const topic = textOf((topicMessage as { content?: unknown } | undefined)?.content).trim();
	const summary = language === "ja"
		? `事前チェックは${answers.length}回の回答で終了しました（短く）。学習者の目標: ${quote(topic, language)}。以下の回答をもとに作成し、講師が書いたものではありません。`
		: `Probing ended after ${answers.length} answers (Short). The learner's goal: ${quote(topic, language)}. Built from the answers below, not written by the tutor.`;
	const assessment = {
		strands: answers.map((answer) => ({
			strand: answer.question || (language === "ja" ? "（質問）" : "(question)"),
			assessment: answerLine(answer, language),
		})),
		summary,
	};
	const callId = `call_probe_short_${chatId}`;
	const now = Date.now();
	const call: LhMessage & AssistantMessage = {
		id: newMessageId(),
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "probe_done", arguments: { assessment } }],
		api: "faux",
		provider: "synthetic",
		model: "synthetic-probe-short",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: now,
	} as LhMessage & AssistantMessage;
	const result: LhMessage & ToolResultMessage = {
		id: newMessageId(),
		role: "toolResult",
		toolCallId: callId,
		toolName: "probe_done",
		content: [{ type: "text", text: PROBE_DONE_ACK_TEXT }],
		details: { ok: true },
		isError: false,
		timestamp: now,
	} as LhMessage & ToolResultMessage;
	return [newProbeWrapupMessage(chatId, "code"), call, result, newHandoffMessage(chatId)];
}
