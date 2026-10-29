"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useServerEvent, useServerResync } from "@/components/server-events";

type PendingItem = {
 callId: string;
 tool: "web_search" | "web_fetch";
 value: string;
 reason: string;
 warningMatches: { text: string; kind: "copied_text" | "sensitive_term" }[];
 createdAt: string;
 expiresAt: string;
};

/** One approval at a time. The server's pending list is the source of truth. */
export function WebApprovalDialog({ chatId }: { chatId: string }) {
 const [pending, setPending] = useState<PendingItem[]>([]);
 const [editedValue, setEditedValue] = useState("");
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const active = pending[0];

 const refresh = useCallback(() => {
  void fetch(`/api/chats/${encodeURIComponent(chatId)}/web-approvals`)
   .then((response) => response.ok ? response.json() : Promise.reject())
   .then((body: { pending?: PendingItem[] }) => setPending(body.pending ?? []))
   .catch(() => {});
 }, [chatId]);

 useEffect(() => {
  refresh();
  const poll = window.setInterval(refresh, 5000);
  return () => window.clearInterval(poll);
 }, [refresh]);
 useServerEvent("web_approval_pending", (event) => {
  if (event.chatId === chatId) refresh();
 });
 useServerResync(refresh);
 useEffect(() => {
  setEditedValue(active?.value ?? "");
  setError(null);
 }, [active?.callId, active?.value]);

 const decide = async (decision: "allow" | "deny") => {
  if (!active || submitting) return;
  setSubmitting(true);
  setError(null);
  try {
   const response = await fetch(
    `/api/chats/${encodeURIComponent(chatId)}/web-approvals/${encodeURIComponent(active.callId)}`,
    {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
      decision,
      ...(decision === "allow" && editedValue !== active.value ? { editedValue } : {}),
     }),
    },
   );
   if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.status !== 409) setError(body.error ?? "Could not submit this decision.");
   } else {
    const body = await response.json() as { status: "allowed" | "denied" | "pending" | "expired" };
    if (body.status === "pending") setError("The edited request has new warning matches. Review them, then choose Allow again.");
   }
   refresh();
  } catch {
   setError("Could not reach the server. Please try again.");
  } finally {
   setSubmitting(false);
  }
 };

 if (!active) return null;
 return createPortal(
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4">
   <div
    role="dialog"
    aria-modal="true"
    aria-label="Approve web access"
    data-testid="web-approval-dialog"
    className="w-full max-w-xl rounded-md border border-border bg-card p-6 shadow-xl"
   >
    <h2 className="font-title text-2xl">Approve web access</h2>
    <p className="mt-3 text-sm text-foreground">{active.reason}</p>
    <label className="mt-4 block text-xs text-muted-foreground" htmlFor="web-approval-value">
     {active.tool === "web_search" ? "Exact search query" : "Full URL"}
    </label>
    <textarea
     id="web-approval-value"
     data-testid="web-approval-value"
     value={editedValue}
     onChange={(event) => setEditedValue(event.target.value)}
     rows={active.tool === "web_fetch" ? 2 : 3}
     className="mt-1 w-full resize-y rounded-sm border border-border bg-background p-2 text-sm text-foreground"
    />
    {active.warningMatches.length > 0 && (
     <div role="alert" className="mt-3 rounded-sm border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-400">
      <p className="font-medium">This request may include office knowledge.</p>
      <ul className="mt-1 list-inside list-disc">
       {active.warningMatches.map((match, index) => (
        <li key={index}>
         {match.kind === "sensitive_term" ? "Sensitive term" : "Copied text"}: {match.text}
        </li>
       ))}
      </ul>
     </div>
    )}
    {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
     <button type="button" data-testid="web-approval-deny" disabled={submitting}
      onClick={() => void decide("deny")}
      className="rounded-sm border border-border px-3 py-1.5 text-sm text-foreground disabled:opacity-50">
      Deny
     </button>
     <button type="button" data-testid="web-approval-allow" disabled={submitting || !editedValue.trim()}
      onClick={() => void decide("allow")}
      className="rounded-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
      Allow
     </button>
    </div>
   </div>
  </div>,
  document.body,
 );
}
