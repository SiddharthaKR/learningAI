/**
 * Repeated tool-call guard (owner, 2026-11-27 — all models): GLM-4.6V-Flash
 * on LM Studio repeated one tool call 64 times until the output cap. The
 * reply ends at the first identical repeat, and the request is aborted.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessageEvent, type StreamFunction } from "@earendil-works/pi-ai";
import { repeatGuardStream } from "../src/agent/repeat-guard-stream.ts";

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
type Call = { name: string; arguments: Record<string, unknown> };

/** An upstream that streams text, then the given calls; records whether it was aborted. */
function upstreamOf(text: string, calls: Call[], seen: { aborted: boolean; emitted: number }): StreamFunction {
	return (_model, _context, options) => {
		const stream = createAssistantMessageEventStream();
		const message: any = { role: "assistant", api: "openai-completions", provider: "office", model: "x", timestamp: 1, content: [], usage, stopReason: "stop" };
		options?.signal?.addEventListener("abort", () => { seen.aborted = true; });
		void (async () => {
			stream.push({ type: "start", partial: message });
			if (text) {
				message.content.push({ type: "text", text });
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
			}
			for (const call of calls) {
				if (options?.signal?.aborted) return; // a real server stops sending
				await new Promise((r) => setTimeout(r, 1));
				const index = message.content.length;
				const toolCall: any = { type: "toolCall", id: `c${index}`, name: call.name, arguments: call.arguments };
				message.content.push(toolCall);
				seen.emitted++;
				stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
				stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: message });
			}
			message.stopReason = calls.length ? "toolUse" : "stop";
			stream.push({ type: "done", reason: message.stopReason, message });
			stream.end(message);
		})();
		return stream;
	};
}

async function run(text: string, calls: Call[]) {
	const seen = { aborted: false, emitted: 0 };
	const events: AssistantMessageEvent[] = [];
	for await (const event of repeatGuardStream(upstreamOf(text, calls, seen))({} as any, { messages: [] } as any)) events.push(event);
	const done = events.at(-1) as Extract<AssistantMessageEvent, { type: "done" }>;
	return { done, seen, events };
}

const calc = (expr: string): Call => ({ name: "calc", arguments: { expr } });

describe("repeatGuardStream", () => {
	it("ends the reply at the first identical repeat, keeps the calls before it, and aborts the request", async () => {
		const { done, seen } = await run("I will now call calc.", Array.from({ length: 64 }, () => calc("7*6")));
		assert.equal(done.type, "done");
		assert.equal(done.reason, "toolUse");
		assert.equal(done.message.stopReason, "toolUse");
		const calls = done.message.content.filter((c) => c.type === "toolCall");
		assert.equal(calls.length, 1);
		assert.equal(done.message.content[0]!.type, "text", "the text before the calls stays");
		assert.equal(seen.aborted, true);
		assert.ok(seen.emitted < 64, "the server stopped sending");
	});

	it("keeps different calls and drops only from the first repeat on", async () => {
		const { done } = await run("", [calc("1"), { name: "note", arguments: { text: "hi" } }, calc("1"), calc("2")]);
		const calls = done.message.content.filter((c) => c.type === "toolCall") as Array<{ name: string }>;
		assert.deepEqual(calls.map((c) => c.name), ["calc", "note"]);
	});

	it("passes a reply with no repeats through unchanged", async () => {
		const { done, seen, events } = await run("Hello", [calc("1"), calc("2")]);
		assert.equal(seen.aborted, false);
		assert.equal(done.message.content.length, 3);
		assert.equal(events.filter((e) => e.type === "toolcall_end").length, 2);
	});
});
