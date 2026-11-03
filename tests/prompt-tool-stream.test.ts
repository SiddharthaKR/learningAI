import assert from "node:assert/strict";
import { it } from "node:test";
import { createAssistantMessageEventStream, type StreamFunction } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { promptToolStream } from "../src/agent/prompt-tool-stream.ts";

it("converts text tool calls to native events without sending tools upstream", async () => {
  let sawNativeTools = true;
  const upstream: StreamFunction = (_model, context) => {
    const system = context.messages[0];
    sawNativeTools = system?.role === "system" && !!system.toolsAdded?.length;
    const stream = createAssistantMessageEventStream();
    const message: any = { role: "assistant", api: "openai-completions", provider: "office", model: "x", timestamp: Date.now(), content: [{ type: "text", text: '<|tool_call>{"name":"ping","arguments":{"value":"ready"}}<|tool_call|>' }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" };
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({ type: "text_start", contentIndex: 0, partial: message });
      stream.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
      stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    });
    return stream;
  };
  const context: any = { messages: [{ role: "system", content: "Use tools", timestamp: 1, toolsAdded: [
    { name: "ping", description: "Ping", parameters: Type.Object({ value: Type.String() }) },
  ] }] };
  const stream = promptToolStream(upstream)({} as any, context);
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(sawNativeTools, false);
  assert.equal(events.find((event) => event.type === "toolcall_end")?.toolCall.name, "ping");
  assert.equal(events.at(-1)?.type, "done");
  assert.equal((events.at(-1) as any).reason, "toolUse");
});

it("retries malformed tool text once with a format reminder", async () => {
  let attempts = 0;
  const upstream: StreamFunction = (_model, context) => {
    attempts++;
    if (attempts === 2) assert.match(JSON.stringify(context.messages.at(-1)), /tool-call format/);
    const text = attempts === 1 ? '<|tool_call>{"name":<|tool_call|>' : '<|tool_call>{"name":"ping","arguments":{}}<|tool_call|>';
    const stream = createAssistantMessageEventStream();
    const message: any = { role: "assistant", api: "openai-completions", provider: "office", model: "x", timestamp: Date.now(), content: [{ type: "text", text }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" };
    queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message }); stream.push({ type: "done", reason: "stop", message }); stream.end(message); });
    return stream;
  };
  const context: any = { messages: [{ role: "system", content: "", timestamp: 1, toolsAdded: [{ name: "ping", description: "", parameters: Type.Object({}) }] }] };
  const events = [];
  for await (const event of promptToolStream(upstream)({} as any, context)) events.push(event);
  assert.equal(attempts, 2);
  assert.equal(events.find((event) => event.type === "toolcall_end")?.toolCall.name, "ping");
});
