import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type JsonObject,
	type StreamFunction,
	type Tool,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { Value } from "typebox/value";

/**
 * Tool-call salvage for native tool mode (owner, 2026-11-19).
 *
 * Local models sometimes TYPE a tool call into their reply instead of making
 * it: a quiz as a ```json block (the learner then saw the correct answer), or
 * the plan map as a ```mermaid block (no plan was created, so the retry drew
 * it a second time). This wrapper holds back ```json / ```mermaid / bare ```
 * blocks while the reply streams. When the reply ends with NO real tool call,
 * a held block becomes the call it unambiguously is:
 *
 *   - JSON `{name, arguments}` naming an available tool, or a JSON object that
 *     fits exactly ONE available tool's schema (its required fields present,
 *     no unknown keys, schema check passes);
 *   - a mermaid `graph`/`flowchart` block while plan_init is available and no
 *     plan has been created yet in this conversation.
 *
 * The converted call runs through the normal tool path — the same validation
 * as a real call. Anything else is shown exactly as written. Ordinary code
 * blocks (```python, …) are never held, so they stream as before.
 */

const HELD_LANGS = new Set(["", "json", "jsonc", "mermaid"]);
const FENCE = "```";

interface HeldBlock {
	raw: string;
	call: { name: string; arguments: JsonObject };
}

function activeTools(context: Parameters<StreamFunction>[1]): Map<string, Tool> {
	const active = new Map<string, Tool>();
	for (const message of context.messages) {
		if (message.role !== "system") continue;
		for (const tool of message.toolsAdded ?? []) active.set(tool.name, tool);
		for (const tool of message.toolsRemoved ?? []) active.delete(tool.name);
	}
	return active;
}

/** True when some earlier plan_init call succeeded (its result says ok:true). */
function planExists(context: Parameters<StreamFunction>[1]): boolean {
	return context.messages.some((message) => {
		const m = message as { role?: string; toolName?: string; content?: unknown };
		if (m.role !== "toolResult" || m.toolName !== "plan_init") return false;
		const text = Array.isArray(m.content)
			? m.content.map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : "")).join("")
			: String(m.content ?? "");
		return /"ok"\s*:\s*true/u.test(text);
	});
}

function schemaKeys(tool: Tool): { properties: Set<string>; required: string[] } {
	const schema = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
	return { properties: new Set(Object.keys(schema.properties ?? {})), required: schema.required ?? [] };
}

function isObject(value: unknown): value is JsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Decide whether a finished fenced block is a typed-out tool call. */
function callFromBlock(
	lang: string,
	body: string,
	tools: Map<string, Tool>,
	planPending: boolean,
): HeldBlock["call"] | null {
	if (lang === "mermaid" || (lang === "" && /^\s*(graph|flowchart)\b/u.test(body))) {
		if (!planPending || !tools.has("plan_init")) return null;
		if (!/^\s*(graph|flowchart)\b/u.test(body)) return null;
		const mermaid = body.trim();
		return Value.Check(tools.get("plan_init")!.parameters, { mermaid }) ? { name: "plan_init", arguments: { mermaid } } : null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	if (!isObject(parsed)) return null;
	const named = parsed.arguments ?? parsed.parameters ?? parsed.args;
	if (typeof parsed.name === "string" && isObject(named)) {
		const tool = tools.get(parsed.name);
		return tool && Value.Check(tool.parameters, named) ? { name: tool.name, arguments: named } : null;
	}
	const keys = Object.keys(parsed);
	const fits = [...tools.values()].filter((tool) => {
		const { properties, required } = schemaKeys(tool);
		return required.length > 0
			&& required.every((key) => key in parsed)
			&& keys.every((key) => properties.has(key))
			&& Value.Check(tool.parameters, parsed);
	});
	return fits.length === 1 ? { name: fits[0]!.name, arguments: parsed } : null;
}

/**
 * Splits one text block's stream into "show now" text and held fenced
 * blocks. Only ```json / ```mermaid / bare ``` blocks are held; other fences
 * pass through (their closing fence is still tracked so it is never mistaken
 * for an opening one).
 */
class BlockHolder {
	private pending = "";
	private mode: "text" | "header" | "held" | "passthrough" = "text";
	private header = "";
	constructor(private readonly decide: (lang: string, body: string) => HeldBlock["call"] | null, private readonly held: HeldBlock[]) {}

	push(delta: string): string {
		this.pending += delta;
		let out = "";
		for (;;) {
			if (this.mode === "text") {
				const at = this.pending.indexOf(FENCE);
				if (at === -1) {
					// Hold a trailing "`" or "``" — it may be the start of a fence.
					const tail = /`{1,2}$/u.exec(this.pending)?.[0].length ?? 0;
					out += this.pending.slice(0, this.pending.length - tail);
					this.pending = this.pending.slice(this.pending.length - tail);
					return out;
				}
				out += this.pending.slice(0, at);
				this.pending = this.pending.slice(at);
				this.mode = "header";
			}
			if (this.mode === "header") {
				const newline = this.pending.indexOf("\n");
				if (newline === -1) return out;
				this.header = this.pending.slice(FENCE.length, newline).trim().toLowerCase();
				if (HELD_LANGS.has(this.header)) {
					this.mode = "held";
				} else {
					out += this.pending.slice(0, newline + 1);
					this.pending = this.pending.slice(newline + 1);
					this.mode = "passthrough";
				}
			}
			if (this.mode === "passthrough") {
				const close = this.pending.indexOf(FENCE);
				if (close === -1) {
					const tail = /`{1,2}$/u.exec(this.pending)?.[0].length ?? 0;
					out += this.pending.slice(0, this.pending.length - tail);
					this.pending = this.pending.slice(this.pending.length - tail);
					return out;
				}
				out += this.pending.slice(0, close + FENCE.length);
				this.pending = this.pending.slice(close + FENCE.length);
				this.mode = "text";
				continue;
			}
			if (this.mode === "held") {
				const bodyStart = this.pending.indexOf("\n") + 1;
				const close = this.pending.indexOf(FENCE, bodyStart);
				if (close === -1) return out;
				const raw = this.pending.slice(0, close + FENCE.length);
				const body = this.pending.slice(bodyStart, close);
				this.pending = this.pending.slice(close + FENCE.length);
				this.mode = "text";
				const call = this.decide(this.header, body);
				if (call) this.held.push({ raw, call });
				else out += raw;
			}
		}
	}

	/** End of the block: whatever is still pending is shown as written. */
	finish(): string {
		const rest = this.pending;
		this.pending = "";
		this.mode = "text";
		return rest;
	}
}

export function toolSalvageStream(upstream: StreamFunction): StreamFunction {
	return (model, context, options) => {
		const output = createAssistantMessageEventStream();
		const tools = activeTools(context);
		const planPending = tools.has("plan_init") && !planExists(context);
		const decide = (lang: string, body: string) => callFromBlock(lang, body, tools, planPending);
		const held: HeldBlock[] = [];
		void (async () => {
			let partial: AssistantMessage | undefined;
			const index = new Map<number, number>(); // upstream content index → ours
			const holders = new Map<number, BlockHolder>();
			const appendText = (ours: number, value: string) => {
				if (!partial || !value) return;
				const block = partial.content[ours];
				if (block?.type !== "text") return;
				block.text += value;
				output.push({ type: "text_delta", contentIndex: ours, delta: value, partial });
			};
			try {
				for await (const event of upstream(model, context, options)) {
					switch (event.type) {
						case "start":
							partial = { ...event.partial, content: [] };
							output.push({ type: "start", partial });
							break;
						case "text_start": {
							if (!partial) break;
							const ours = partial.content.length;
							index.set(event.contentIndex, ours);
							holders.set(event.contentIndex, new BlockHolder(decide, held));
							partial.content.push({ type: "text", text: "" });
							output.push({ type: "text_start", contentIndex: ours, partial });
							break;
						}
						case "text_delta": {
							const ours = index.get(event.contentIndex);
							const holder = holders.get(event.contentIndex);
							if (ours === undefined || !holder) break;
							appendText(ours, holder.push(event.delta));
							break;
						}
						case "text_end": {
							const ours = index.get(event.contentIndex);
							const holder = holders.get(event.contentIndex);
							if (ours === undefined || !holder || !partial) break;
							appendText(ours, holder.finish());
							const block = partial.content[ours];
							output.push({ type: "text_end", contentIndex: ours, content: block?.type === "text" ? block.text : "", partial });
							break;
						}
						case "thinking_start":
						case "toolcall_start": {
							if (!partial) break;
							const ours = partial.content.length;
							index.set(event.contentIndex, ours);
							const source = event.partial.content[event.contentIndex];
							partial.content.push(event.type === "thinking_start"
								? { type: "thinking", thinking: "" }
								: { ...(source as ToolCall) });
							output.push({ type: event.type, contentIndex: ours, partial });
							break;
						}
						case "thinking_delta": {
							const ours = index.get(event.contentIndex);
							const block = ours === undefined ? undefined : partial?.content[ours];
							if (ours === undefined || block?.type !== "thinking" || !partial) break;
							block.thinking += event.delta;
							output.push({ type: "thinking_delta", contentIndex: ours, delta: event.delta, partial });
							break;
						}
						case "thinking_end": {
							const ours = index.get(event.contentIndex);
							const block = ours === undefined ? undefined : partial?.content[ours];
							if (ours === undefined || block?.type !== "thinking" || !partial) break;
							const source = event.partial.content[event.contentIndex];
							if (source?.type === "thinking") Object.assign(block, source);
							output.push({ type: "thinking_end", contentIndex: ours, content: event.content, partial });
							break;
						}
						case "toolcall_delta": {
							const ours = index.get(event.contentIndex);
							if (ours === undefined || !partial) break;
							const source = event.partial.content[event.contentIndex];
							if (source?.type === "toolCall") partial.content[ours] = { ...source };
							output.push({ type: "toolcall_delta", contentIndex: ours, delta: event.delta, partial });
							break;
						}
						case "toolcall_end": {
							const ours = index.get(event.contentIndex);
							if (ours === undefined || !partial) break;
							partial.content[ours] = event.toolCall;
							output.push({ type: "toolcall_end", contentIndex: ours, toolCall: event.toolCall, partial });
							break;
						}
						case "done": {
							const message: AssistantMessage = partial
								? { ...event.message, content: partial.content }
								: { ...event.message };
							partial = message;
							// Any text block the provider never closed: show what it held.
							for (const [upstreamIndex, holder] of holders) {
								const ours = index.get(upstreamIndex)!;
								appendText(ours, holder.finish());
							}
							const realCall = message.content.some((part) => part.type === "toolCall");
							let reason = event.reason;
							if (held.length && realCall) {
								// The model also made a real call: convert nothing, keep its text.
								const ours = message.content.length;
								message.content.push({ type: "text", text: "" });
								output.push({ type: "text_start", contentIndex: ours, partial: message });
								appendText(ours, held.map((block) => block.raw).join("\n"));
								output.push({ type: "text_end", contentIndex: ours, content: (message.content[ours] as { text: string }).text, partial: message });
							} else if (held.length) {
								for (const block of held) {
									const ours = message.content.length;
									const toolCall: ToolCall = { type: "toolCall", id: `salvaged_${crypto.randomUUID()}`, name: block.call.name, arguments: block.call.arguments };
									message.content.push(toolCall);
									output.push({ type: "toolcall_start", contentIndex: ours, partial: message });
									output.push({ type: "toolcall_end", contentIndex: ours, toolCall, partial: message });
								}
								reason = "toolUse";
								message.stopReason = "toolUse";
							}
							output.push({ type: "done", reason, message });
							output.end(message);
							return;
						}
						case "error":
							output.push(event);
							output.end(event.error);
							return;
					}
				}
				throw new Error("Model stream ended without a final response");
			} catch (error) {
				const failed = partial ?? ({ role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "error", timestamp: Date.now() } as AssistantMessage);
				failed.stopReason = "error";
				failed.errorMessage = error instanceof Error ? error.message : String(error);
				output.push({ type: "error", reason: "error", error: failed });
				output.end(failed);
			}
		})();
		return output;
	};
}
