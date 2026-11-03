import assert from "node:assert/strict";
import { it } from "node:test";
import { PromptToolParser, parseToolCalls, promptToolContext } from "../src/agent/prompt-tool-parser.ts";

it("parses one Gemma tool call and JSON fallback", () => {
  assert.deepEqual(parseToolCalls('{"name":"plan_init","arguments":{"plan":"A"}}'), [
    { name: "plan_init", arguments: { plan: "A" } },
  ]);
  assert.deepEqual(parseToolCalls('{"tool_calls":[{"name":"plan_init","arguments":{"plan":"A"}}]}'), [
    { name: "plan_init", arguments: { plan: "A" } },
  ]);
});

it("parses multiple calls in one Gemma block", () => {
  assert.deepEqual(parseToolCalls('{"name":"a","arguments":{}}\n{"name":"b","arguments":{"x":1}}'), [
    { name: "a", arguments: {} }, { name: "b", arguments: { x: 1 } },
  ]);
});

it("recognizes untagged JSON fallback across chunks", () => {
  const parser = new PromptToolParser(["ping"]);
  assert.deepEqual(parser.push('{"name":"ping",'), []);
  assert.deepEqual(parser.push('"arguments":{"value":"ready"}}'), []);
  assert.deepEqual(parser.finish(), [{ name: "ping", arguments: { value: "ready" } }]);
});

it("buffers a split tag and passes plain text before and after", () => {
  const parser = new PromptToolParser();
  assert.deepEqual(parser.push("Hello <|tool_ca"), ["Hello "]);
  assert.deepEqual(parser.push('ll>{"name":"a","arguments":{}}<|tool_call|> Done'), [
    { name: "a", arguments: {} }, " Done",
  ]);
  assert.deepEqual(parser.finish(), []);
});

it("rejects malformed and unknown calls before execution", () => {
  assert.throws(() => parseToolCalls('{"name":'), /tool.call format/i);
  const parser = new PromptToolParser(["known"]);
  assert.throws(() => parser.push('<|tool_call>{"name":"other","arguments":{}}<|tool_call|>'), /unknown tool/i);
});

it("puts tools in the prompt and removes native tool declarations", () => {
  const context = { messages: [{ role: "system", content: "Teach.", timestamp: 1, toolsAdded: [
    { name: "plan_init", description: "Create a plan", parameters: { type: "object", properties: {} } },
  ] }, { role: "user", content: "Plan it", timestamp: 2 }] };
  const transformed = promptToolContext(context as any);
  const first = transformed.messages[0];
  assert.equal(first?.role, "system");
  if (first?.role !== "system") return;
  assert.equal(first.toolsAdded, undefined);
  assert.match(first.content as string, /plan_init/);
  assert.match(first.content as string, /<\|tool_call>/);
});
