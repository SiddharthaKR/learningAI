import { randomUUID } from "node:crypto";
import { emit } from "../core/events.ts";
import { stores } from "./stores.ts";

export type WebTool = "web_search" | "web_fetch";
export type WarningMatch = { text: string; kind: "copied_text" | "sensitive_term" };
export interface PendingWebApproval {
  callId: string;
  tool: WebTool;
  value: string;
  reason: string;
  warningMatches: WarningMatch[];
  createdAt: string;
  expiresAt: string;
}
type Decision = "pending" | "allowed" | "denied" | "expired";
type ApprovalRecord = { chatId: string; item: PendingWebApproval; status: Decision; chunks: string[]; validate: (value: string) => Promise<void>; resolve: (value: string | null) => void; timer: ReturnType<typeof setTimeout> };
const KEY = Symbol.for("lh.webApprovals");
function approvals(): Map<string, ApprovalRecord> {
  const g = globalThis as Record<symbol, Map<string, ApprovalRecord> | undefined>;
  return (g[KEY] ??= new Map());
}
function timeoutSeconds(): number {
  const n = Number(process.env.APPROVAL_TIMEOUT_SECONDS ?? "300");
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("APPROVAL_TIMEOUT_SECONDS must be a positive integer");
  return n;
}
function domain(value: string, tool: WebTool): string {
  if (tool === "web_search") return "search";
  try { return new URL(value).hostname; } catch { return "invalid-url"; }
}
function logDecision(chatId: string, tool: WebTool, value: string, decision: string, userId?: string): void {
  console.info(`[web approval] user=${userId ?? "unavailable"} chat=${chatId} decision=${decision} domain=${domain(value, tool)}`);
}
export function warningMatches(value: string, chunks: readonly string[], sensitiveTerms = process.env.SENSITIVE_TERMS ?? ""): WarningMatch[] {
  const found: WarningMatch[] = [];
  const seen = new Set<string>();
  const chars = [...value];
  for (const chunk of chunks) {
    for (let i = 0; i + 8 <= chars.length; i++) {
      const text = chars.slice(i, i + 8).join("");
      if (!seen.has(`copy:${text}`) && chunk.includes(text)) { seen.add(`copy:${text}`); found.push({ text, kind: "copied_text" }); }
    }
  }
  for (const term of sensitiveTerms.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (value.toLocaleLowerCase().includes(term.toLocaleLowerCase()) && !seen.has(`term:${term}`)) {
      seen.add(`term:${term}`); found.push({ text: term, kind: "sensitive_term" });
    }
  }
  return found;
}
/** One access seam. Step 4 adds user ownership here; until then this is chat-scoped only. */
export function getApprovalForChat(ctx: { userId?: string }, chatId: string, callId: string): ApprovalRecord | null {
  if (!stores.chatStore.getChat(chatId)) return null;
  const entry = approvals().get(callId);
  if (!entry || entry.chatId !== chatId) return null;
  void ctx;
  return entry;
}
export function pendingApprovalsForChat(ctx: { userId?: string }, chatId: string): PendingWebApproval[] | null {
  if (!stores.chatStore.getChat(chatId)) return null;
  return [...approvals().values()].filter((entry) => getApprovalForChat(ctx, chatId, entry.item.callId)?.status === "pending").map((entry) => entry.item);
}
export function requestWebApproval(input: { chatId: string; tool: WebTool; value: string; reason: string; chunks: string[]; validate: (value: string) => Promise<void> }): Promise<string | null> {
  if (!stores.chatStore.getChat(input.chatId)) return Promise.resolve(null);
  const callId = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + timeoutSeconds() * 1000);
  const item: PendingWebApproval = { callId, tool: input.tool, value: input.value, reason: input.reason, warningMatches: warningMatches(input.value, input.chunks), createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const entry = approvals().get(callId);
      if (!entry || entry.status !== "pending") return;
      entry.status = "expired";
      logDecision(input.chatId, input.tool, entry.item.value, "timeout");
      resolve(null);
    }, timeoutSeconds() * 1000);
    approvals().set(callId, { chatId: input.chatId, item, status: "pending", chunks: input.chunks, validate: input.validate, resolve, timer });
    emit("web_approval_pending", { chatId: input.chatId });
  });
}
export async function decideWebApproval(ctx: { userId?: string }, chatId: string, callId: string, decision: "allow" | "deny", editedValue?: string): Promise<{ status: Decision; pending?: PendingWebApproval } | null> {
  const entry = getApprovalForChat(ctx, chatId, callId);
  if (!entry) return null;
  if (entry.status !== "pending") return { status: "expired" };
  if (decision === "deny") {
    entry.status = "denied"; clearTimeout(entry.timer); entry.resolve(null);
    logDecision(chatId, entry.item.tool, entry.item.value, "deny", ctx.userId);
    return { status: "denied" };
  }
  const value = editedValue ?? entry.item.value;
  try { await entry.validate(value); } catch (error) { throw error; }
  const matches = warningMatches(value, entry.chunks);
  if (matches.length && editedValue !== undefined && editedValue !== entry.item.value) {
    entry.item = { ...entry.item, value, warningMatches: matches };
    emit("web_approval_pending", { chatId });
    return { status: "pending", pending: entry.item };
  }
  entry.status = "allowed"; clearTimeout(entry.timer); entry.resolve(value);
  logDecision(chatId, entry.item.tool, value, "allow", ctx.userId);
  return { status: "allowed" };
}

