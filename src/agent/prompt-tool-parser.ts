export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

import type { Tool, TranscriptContext } from "@earendil-works/pi-ai";

/** Rebuild active declarations as text and strip native tool metadata. */
export function promptToolContext(context: TranscriptContext): TranscriptContext {
  const active = new Map<string, Tool>();
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsAdded ?? []) active.set(tool.name, tool);
    for (const tool of message.toolsRemoved ?? []) active.delete(tool.name);
  }
  const instruction = active.size ? `\n\nAvailable tools (name, description, JSON argument schema):\n${[...active.values()].map((tool) => JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })).join("\n")}\nTo call a tool, output <|tool_call>{"name":"tool_name","arguments":{}}<|tool_call|>. You may put multiple JSON objects inside one block. Do not describe a tool call in prose.` : "";
  const messages = context.messages.map((message, index) => {
    if (message.role !== "system") return message;
    const { toolsAdded: _added, toolsRemoved: _removed, ...rest } = message;
    if (index !== 0) return rest;
    const base = typeof rest.content === "string" ? rest.content : rest.content.map((part) => part.text).join("\n");
    return { ...rest, content: base + instruction };
  });
  return { ...context, messages };
}

const TAG = "<|tool_call>";
const END_TAG = "<|tool_call|>";

function oneCall(value: unknown): ParsedToolCall {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool-call format");
  const record = value as Record<string, unknown>;
  const args = record.arguments ?? record.args ?? record.parameters;
  if (typeof record.name !== "string" || !record.name || !args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Invalid tool-call format");
  }
  return { name: record.name, arguments: args as Record<string, unknown> };
}

/** Parse one or more JSON objects, including a tool_calls array fallback. */
export function parseToolCalls(raw: string): ParsedToolCall[] {
  const values: unknown[] = [];
  let cursor = 0;
  try {
    while (cursor < raw.length) {
      while (/\s/u.test(raw[cursor] ?? "") && cursor < raw.length) cursor++;
      if (cursor === raw.length) break;
      if (raw[cursor] !== "{") throw new Error("expected object");
      const start = cursor;
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (; cursor < raw.length; cursor++) {
        const ch = raw[cursor]!;
        if (quoted) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) { cursor++; break; }
      }
      if (depth !== 0) throw new Error("unclosed object");
      values.push(JSON.parse(raw.slice(start, cursor)));
    }
    const calls = values.flatMap((value) => {
      if (value && typeof value === "object" && "tool_calls" in value) {
        const list = (value as { tool_calls: unknown }).tool_calls;
        if (!Array.isArray(list)) throw new Error("invalid tool_calls");
        return list.map((item) => {
          if (item && typeof item === "object" && "function" in item) {
            const fn = (item as { function: { name: string; arguments: unknown } }).function;
            return oneCall({ name: fn.name, arguments: typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments });
          }
          return oneCall(item);
        });
      }
      return [oneCall(value)];
    });
    if (!calls.length) throw new Error("empty");
    return calls;
  } catch {
    throw new Error("Invalid tool-call format");
  }
}

/** Streaming tag recognizer; withholds only a possible partial opening tag. */
export class PromptToolParser {
  private pending = "";
  private inCall = false;
  private readonly knownTools?: readonly string[];
  constructor(knownTools?: readonly string[]) { this.knownTools = knownTools; }

  push(chunk: string): Array<string | ParsedToolCall> {
    this.pending += chunk;
    const output: Array<string | ParsedToolCall> = [];
    while (this.pending) {
      const tag = this.inCall ? END_TAG : TAG;
      const index = this.pending.indexOf(tag);
      if (index >= 0) {
        const before = this.pending.slice(0, index);
        if (this.inCall) {
          for (const call of parseToolCalls(before)) {
            if (this.knownTools && !this.knownTools.includes(call.name)) throw new Error(`Unknown tool: ${call.name}`);
            output.push(call);
          }
        } else if (before) output.push(before);
        this.pending = this.pending.slice(index + tag.length);
        this.inCall = !this.inCall;
        continue;
      }
      if (this.inCall) break;
      if (this.pending.trimStart().startsWith("{")) break;
      let suffix = 0;
      for (let n = 1; n < tag.length; n++) if (this.pending.endsWith(tag.slice(0, n))) suffix = n;
      const text = this.pending.slice(0, this.pending.length - suffix);
      if (text) output.push(text);
      this.pending = suffix ? this.pending.slice(-suffix) : "";
      break;
    }
    return output;
  }

  finish(): Array<string | ParsedToolCall> {
    if (this.inCall) throw new Error("Invalid tool-call format: unclosed tag");
    const rest = this.pending;
    this.pending = "";
    if (rest.trimStart().startsWith("{")) {
      const calls = parseToolCalls(rest);
      for (const call of calls) if (this.knownTools && !this.knownTools.includes(call.name)) throw new Error(`Unknown tool: ${call.name}`);
      return calls;
    }
    return rest ? [rest] : [];
  }
}
