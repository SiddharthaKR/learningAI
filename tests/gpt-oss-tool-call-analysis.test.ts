/**
 * gpt-oss on LM Studio (owner, 2026-11-27): earlier tool calls carry their
 * analysis as `content`, or the parser rejects the next reply as "does not
 * match the expected peg-native format". Detected from the model name.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GPT_OSS_TOOL_CALL_FILLER, isGptOssModel, withGptOssToolCallAnalysis } from "../src/agent/models.ts";

const call = (id: string) => [{ id, type: "function", function: { name: "probe", arguments: "{}" } }];

describe("isGptOssModel", () => {
	it("matches gpt-oss ids from LM Studio, Ollama and hosted catalogs only", () => {
		for (const id of ["openai/gpt-oss-20b", "gpt-oss:120b", "GPT-OSS-20B-MXFP4"]) assert.equal(isGptOssModel(id), true, id);
		for (const id of ["qwen/qwen3-8b", "glm-4-9b-0414", "gemma4-12b-ctx32768"]) assert.equal(isGptOssModel(id), false, id);
	});
});

describe("withGptOssToolCallAnalysis", () => {
	it("moves each earlier tool call's own thinking into content and drops the reasoning fields", () => {
		const out = withGptOssToolCallAnalysis({
			model: "openai/gpt-oss-20b",
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: "teach me ohms law" },
				{ role: "assistant", content: null, reasoning: "Ask about voltage.", tool_calls: call("a") },
				{ role: "tool", tool_call_id: "a", content: "{}" },
				{ role: "assistant", content: null, reasoning_content: "Now current.", tool_calls: call("b") },
				{ role: "tool", tool_call_id: "b", content: "{}" },
			],
		}) as { model: string; messages: Array<Record<string, unknown>> };
		assert.equal(out.model, "openai/gpt-oss-20b");
		assert.deepEqual(out.messages[2], { role: "assistant", content: "Ask about voltage.", tool_calls: call("a") });
		assert.deepEqual(out.messages[4], { role: "assistant", content: "Now current.", tool_calls: call("b") });
		assert.deepEqual(out.messages.slice(0, 2), [{ role: "system", content: "sys" }, { role: "user", content: "teach me ohms law" }]);
	});

	it("uses the approved filler when a call has no thinking (the app's own probe_done, thinking off)", () => {
		assert.equal(GPT_OSS_TOOL_CALL_FILLER, "Proceeding with the next tool call.");
		const out = withGptOssToolCallAnalysis({ messages: [{ role: "assistant", content: "", tool_calls: call("c") }] }) as { messages: Array<Record<string, unknown>> };
		assert.equal(out.messages[0]!.content, GPT_OSS_TOOL_CALL_FILLER);
	});

	it("leaves visible text, plain replies and non-payloads untouched", () => {
		const withText = { role: "assistant", content: "Here is a question.", reasoning: "r", tool_calls: call("d") };
		const plain = { role: "assistant", content: "Hello", reasoning: "r" };
		const out = withGptOssToolCallAnalysis({ messages: [withText, plain] }) as { messages: unknown[] };
		assert.deepEqual(out.messages, [withText, plain]);
		assert.equal(withGptOssToolCallAnalysis(null), null);
		assert.deepEqual(withGptOssToolCallAnalysis({ prompt: "x" }), { prompt: "x" });
	});
});
