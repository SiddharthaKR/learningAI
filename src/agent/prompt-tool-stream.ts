import { createAssistantMessageEventStream, type AssistantMessage, type JsonObject, type StreamFunction, type Tool } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { PromptToolParser, promptToolContext, type ParsedToolCall } from "./prompt-tool-parser.ts";

/** Convert prompt-formatted calls into the event protocol consumed by pi-agent. */
export function promptToolStream(upstream: StreamFunction): StreamFunction {
  return (model, context, options) => {
    const output = createAssistantMessageEventStream();
    const active = new Map<string, Tool>();
    for (const message of context.messages) if (message.role === "system") {
      for (const tool of message.toolsAdded ?? []) active.set(tool.name, tool);
      for (const tool of message.toolsRemoved ?? []) active.delete(tool.name);
    }
    const sourceContext = promptToolContext(context);
    void (async () => {
      let partial: AssistantMessage | undefined;
      let textIndex: number | undefined;
      let toolCount = 0;
      const closeText = () => {
        if (!partial || textIndex === undefined) return;
        const block = partial.content[textIndex];
        if (block?.type === "text") output.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial });
        textIndex = undefined;
      };
      const addText = (value: string) => {
        if (!partial || !value) return;
        if (textIndex === undefined) {
          textIndex = partial.content.length;
          partial.content.push({ type: "text", text: "" });
          output.push({ type: "text_start", contentIndex: textIndex, partial });
        }
        const block = partial.content[textIndex];
        if (block?.type !== "text") throw new Error("Prompt tool stream lost its text block");
        block.text += value;
        output.push({ type: "text_delta", contentIndex: textIndex, delta: value, partial });
      };
      const addCall = (call: ParsedToolCall) => {
        if (!partial) return;
        closeText();
        const tool = active.get(call.name);
        if (!tool) throw new Error(`Unknown tool: ${call.name}`);
        if (!Value.Check(tool.parameters, call.arguments)) throw new Error(`Invalid arguments for tool ${call.name}`);
        const index = partial.content.length;
        const item = { type: "toolCall" as const, id: `prompt_${crypto.randomUUID()}`, name: call.name, arguments: call.arguments as JsonObject };
        partial.content.push(item);
        output.push({ type: "toolcall_start", contentIndex: index, partial });
        output.push({ type: "toolcall_end", contentIndex: index, toolCall: item, partial });
        toolCount++;
      };
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const parser = new PromptToolParser([...active.keys()]);
          const pendingCalls: ParsedToolCall[] = [];
          const requestContext = attempt === 0 ? sourceContext : {
            ...sourceContext,
            messages: [...sourceContext.messages, { role: "user" as const, content: "Use the tool-call format exactly: <|tool_call>{\"name\":\"tool_name\",\"arguments\":{}}<|tool_call|>.", timestamp: Date.now() }],
          } as typeof sourceContext;
          try {
        for await (const event of upstream(model, requestContext, options)) {
          if (event.type === "start") {
            if (!partial) {
              partial = { ...event.partial, content: [] };
              output.push({ type: "start", partial });
            }
          } else if (event.type === "text_delta") {
            for (const part of parser.push(event.delta)) typeof part === "string" ? addText(part) : pendingCalls.push(part);
          } else if (event.type === "done") {
            for (const part of parser.finish()) typeof part === "string" ? addText(part) : pendingCalls.push(part);
            for (const call of pendingCalls) {
              const tool = active.get(call.name);
              if (!tool) throw new Error(`Unknown tool: ${call.name}`);
              if (!Value.Check(tool.parameters, call.arguments)) throw new Error(`Invalid arguments for tool ${call.name}`);
            }
            for (const call of pendingCalls) addCall(call);
            closeText();
            partial ??= { ...event.message, content: [] };
            partial.usage = event.message.usage;
            partial.stopReason = toolCount ? "toolUse" : event.message.stopReason;
            output.push({ type: "done", reason: toolCount ? "toolUse" : event.reason, message: partial });
            output.end(partial);
            return;
          } else if (event.type === "error") {
            output.push(event);
            output.end(event.error);
            return;
          }
        }
        throw new Error("Model stream ended without a final response");
          } catch (error) {
            if (attempt === 0 && error instanceof Error && /tool-call format/i.test(error.message)) continue;
            throw error;
          }
        }
      } catch (error) {
        const failed = partial ?? { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "error", timestamp: Date.now() } as AssistantMessage;
        failed.stopReason = "error";
        failed.errorMessage = error instanceof Error ? error.message : String(error);
        output.push({ type: "error", reason: "error", error: failed });
        output.end(failed);
      }
    })();
    return output;
  };
}
