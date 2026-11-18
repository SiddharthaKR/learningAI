import assert from "node:assert/strict";
import { it } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessageEvent, type StreamFunction } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { toolSalvageStream } from "../src/agent/tool-salvage-stream.ts";

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** A native upstream that streams the given text in small pieces, then optional real tool calls. */
function upstreamOf(text: string, opts: { chunk?: number; calls?: Array<{ name: string; arguments: Record<string, unknown> }> } = {}): StreamFunction {
	return () => {
		const stream = createAssistantMessageEventStream();
		const message: any = { role: "assistant", api: "openai-completions", provider: "office", model: "x", timestamp: Date.now(), content: [], usage, stopReason: "stop" };
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			if (text) {
				message.content.push({ type: "text", text: "" });
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				const size = opts.chunk ?? 7;
				for (let i = 0; i < text.length; i += size) {
					const delta = text.slice(i, i + size);
					message.content[0].text += delta;
					stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
				}
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
			}
			for (const call of opts.calls ?? []) {
				const index = message.content.length;
				const toolCall: any = { type: "toolCall", id: `real_${index}`, name: call.name, arguments: call.arguments };
				message.content.push(toolCall);
				stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
				stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: message });
			}
			const reason = opts.calls?.length ? "toolUse" : "stop";
			message.stopReason = reason;
			stream.push({ type: "done", reason, message });
			stream.end(message);
		});
		return stream;
	};
}

const quizParams = Type.Object({
	type: Type.Union([Type.Literal("predict"), Type.Literal("check")]),
	nodeId: Type.String(),
	question: Type.String(),
	options: Type.Array(Type.Object({ label: Type.String(), value: Type.String() })),
	explanation: Type.String(),
	correctAnswer: Type.String(),
});
const tools = [
	{ name: "quiz", description: "Ask a graded question", parameters: quizParams },
	{ name: "ask_user_question", description: "Ask", parameters: Type.Object({ question: Type.String(), options: Type.Optional(Type.Array(Type.Object({ label: Type.String() }))) }) },
	{ name: "plan_init", description: "Write the plan", parameters: Type.Object({ mermaid: Type.String({ minLength: 1 }) }) },
	{ name: "research", description: "Research", parameters: Type.Object({ question: Type.String(), context: Type.Optional(Type.String()) }) },
];
function contextWith(extra: any[] = []): any {
	return { messages: [{ role: "system", content: "Teach.", timestamp: 1, toolsAdded: tools }, { role: "user", content: "teach me", timestamp: 2 }, ...extra] };
}
async function run(text: string, context = contextWith(), opts: Parameters<typeof upstreamOf>[1] = {}) {
	const events: AssistantMessageEvent[] = [];
	for await (const event of toolSalvageStream(upstreamOf(text, opts))({} as any, context)) events.push(event);
	const done = events.at(-1) as Extract<AssistantMessageEvent, { type: "done" }>;
	assert.equal(done.type, "done");
	const shown = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");
	const finalText = done.message.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
	const calls = done.message.content.filter((c) => c.type === "toolCall") as Array<{ name: string; arguments: any }>;
	return { events, done, shown, finalText, calls };
}

const QUIZ = { type: "check", nodeId: "spacetime-curvature", question: "What is gravity?", options: [{ label: "A force", value: "a" }, { label: "Curved spacetime", value: "c" }], explanation: "Geometry.", correctAnswer: "c" };

it("a quiz typed as a JSON block becomes the real quiz call, and the answer is never shown", async () => {
	const text = `Gravity is geometry.\n\nCheck your understanding\n\n\`\`\`json\n${JSON.stringify(QUIZ, null, 2)}\n\`\`\`\n`;
	const { shown, finalText, calls, done } = await run(text);
	assert.deepEqual(calls.map((c) => c.name), ["quiz"]);
	assert.deepEqual(calls[0]!.arguments, QUIZ);
	assert.equal(done.reason, "toolUse");
	assert.equal(done.message.stopReason, "toolUse");
	for (const t of [shown, finalText]) {
		assert.ok(!t.includes("correctAnswer"), "the answer never reaches the learner");
		assert.ok(t.includes("Gravity is geometry."), "the teaching text stays");
	}
});

it("the {name, arguments} shape is accepted too", async () => {
	const text = "Let me check.\n```json\n" + JSON.stringify({ name: "research", arguments: { question: "Latest Vivado version?" } }) + "\n```";
	const { calls, shown } = await run(text);
	assert.deepEqual(calls.map((c) => [c.name, c.arguments.question]), [["research", "Latest Vivado version?"]]);
	assert.ok(!shown.includes("```"));
});

it("JSON that is not a tool call stays as text, unchanged", async () => {
	const text = "A config looks like this:\n```json\n{\"port\": 3000, \"debug\": true}\n```\nDone.";
	const { calls, shown, finalText, done } = await run(text);
	assert.equal(calls.length, 0);
	assert.equal(shown, text);
	assert.equal(finalText, text);
	assert.equal(done.reason, "stop");
});

it("JSON matching two tools is ambiguous and stays as text", async () => {
	// Only `question`: fits ask_user_question and research equally.
	const text = "```json\n{\"question\": \"Which goal?\"}\n```";
	const { calls, finalText } = await run(text);
	assert.equal(calls.length, 0);
	assert.equal(finalText, text);
});

it("a plan drawn in the message becomes plan_init while no plan exists", async () => {
	const mermaid = "graph TD\n  gravity[Gravity as geometry] --> horizon[Event horizon]";
	const text = "Here is the approach.\n\n```mermaid\n" + mermaid + "\n```\n\nDoes this work for you?";
	const { calls, shown, finalText } = await run(text);
	assert.deepEqual(calls.map((c) => [c.name, c.arguments.mermaid]), [["plan_init", mermaid]]);
	assert.ok(!shown.includes("graph TD") && !finalText.includes("graph TD"), "the map is not drawn twice");
	assert.ok(finalText.includes("Here is the approach.") && finalText.includes("Does this work for you?"));
});

it("once a plan exists, a mermaid diagram is an ordinary lesson diagram", async () => {
	const planned = contextWith([
		{ role: "assistant", content: [{ type: "toolCall", id: "p1", name: "plan_init", arguments: { mermaid: "graph TD\n a[A]" } }], timestamp: 3 },
		{ role: "toolResult", toolCallId: "p1", toolName: "plan_init", content: [{ type: "text", text: "{\"ok\":true,\"nodeIds\":[\"a\"]}" }], isError: false, timestamp: 4 },
	]);
	const text = "Picture it:\n```mermaid\ngraph LR\n  mass --> curve\n```";
	const { calls, finalText } = await run(text, planned);
	assert.equal(calls.length, 0);
	assert.equal(finalText, text);
});

it("a rejected plan does not count as an existing plan", async () => {
	const rejected = contextWith([
		{ role: "assistant", content: [{ type: "toolCall", id: "p1", name: "plan_init", arguments: { mermaid: "x" } }], timestamp: 3 },
		{ role: "toolResult", toolCallId: "p1", toolName: "plan_init", content: [{ type: "text", text: "{\"ok\":false,\"error\":\"bad\"}" }], isError: false, timestamp: 4 },
	]);
	const { calls } = await run("```mermaid\ngraph TD\n  a[A] --> b[B]\n```", rejected);
	assert.deepEqual(calls.map((c) => c.name), ["plan_init"]);
});

it("when the model also made a real call, nothing is converted and the block text is kept", async () => {
	const text = "```json\n" + JSON.stringify(QUIZ) + "\n```";
	const { calls, finalText } = await run(text, contextWith(), { calls: [{ name: "research", arguments: { question: "q" } }] });
	assert.deepEqual(calls.map((c) => c.name), ["research"]);
	assert.ok(finalText.includes("correctAnswer"), "kept as the model wrote it");
});

it("ordinary code blocks stream through as they arrive", async () => {
	const text = "Example:\n```python\nprint('hi')\n```\nThat prints hi.";
	const { events, shown, finalText } = await run(text, contextWith(), { chunk: 3 });
	assert.equal(shown, text);
	assert.equal(finalText, text);
	let soFar = "";
	const firstDelta = events.findIndex((e) => e.type === "text_delta" && (soFar += (e as { delta: string }).delta).includes("print('hi')"));
	const closeDelta = events.findIndex((e, i) => i > firstDelta && e.type === "text_delta" && (e as { delta: string }).delta.includes("`"));
	assert.ok(firstDelta > 0 && closeDelta > firstDelta, "the python block streams before its closing fence arrives");
});

it("a real call with a namespaced tool name (default:probe) is renamed to the tool it means", async () => {
	// Gemma 4 26B, 2026-11-19: called `default:probe`; the app answered
	// "Tool default:probe not found", costing a whole extra model call.
	for (const name of ["default:quiz", "functions.quiz", "default_api:quiz"]) {
		const { calls } = await run("", contextWith(), { calls: [{ name, arguments: QUIZ }] });
		assert.deepEqual(calls.map((c) => c.name), ["quiz"], name);
	}
	const unknown = await run("", contextWith(), { calls: [{ name: "default:nothing", arguments: {} }] });
	assert.deepEqual(unknown.calls.map((c) => c.name), ["default:nothing"], "no guess when the bare name is not a tool either");
});

it("an unclosed held block is shown as written at the end", async () => {
	const text = "Look:\n```json\n{\"type\": \"check\"";
	const { finalText, calls } = await run(text, contextWith(), { chunk: 2 });
	assert.equal(calls.length, 0);
	assert.equal(finalText, text);
});
