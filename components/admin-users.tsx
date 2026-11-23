"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { SidebarToggle } from "@/components/sidebar";

export interface AdminUser { id: string; username: string; createdAt: string }

/** `adminUsername` is LH_ADMIN_USERNAME, resolved on the server; that account cannot be deleted here. */
export function AdminUsers({ initialUsers, adminUsername }: { initialUsers: AdminUser[]; adminUsername: string }) {
  const copy = useI18n().admin;
  const [users, setUsers] = useState(initialUsers);
  const [resetting, setResetting] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setMessage(""); setError("");
    try {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error((await response.json()).error ?? copy.failed);
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : copy.failed); return false; }
  }
  const endpoint = (username: string) => `/api/admin/users/${encodeURIComponent(username)}`;

  async function reset(username: string) {
    if (await call(`${endpoint(username)}/password`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) })) {
      setMessage(copy.passwordReset.replace("{name}", username)); setResetting(null); setPassword("");
    }
  }
  async function remove(username: string) {
    if (!window.confirm(copy.confirmDelete.replace("{name}", username))) return;
    if (await call(endpoint(username), { method: "DELETE" })) setUsers((prev) => prev.filter((u) => u.username !== username));
  }

  return <main className="flex min-w-0 flex-1 flex-col overflow-auto">
    <header className="lh-drag flex items-center gap-3 border-b border-border px-6 py-4">
      <SidebarToggle />
      <h1 className="text-lg font-semibold">{copy.title}</h1>
      <Link href="/admin/knowledge" className="ml-auto text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">{copy.knowledge}</Link>
    </header>
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6 pb-16">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{copy.users}</h2>
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</div>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="py-2">{copy.username}</th><th>{copy.role}</th><th>{copy.created}</th><th className="text-right">{copy.actions}</th></tr></thead>
        <tbody>{users.map((u) => <tr key={u.id} className="border-t border-border">
          <td className="py-3 font-medium">{u.username}</td>
          <td>{u.username === adminUsername ? copy.admin : copy.user}</td>
          <td>{u.createdAt.slice(0, 10)}</td>
          <td className="text-right">
            {resetting === u.username
              ? <form className="inline-flex gap-2" onSubmit={(event) => { event.preventDefault(); void reset(u.username); }}>
                  <input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={copy.newPassword} aria-label={copy.newPassword} className="h-8 rounded-md border border-input bg-background px-2 text-sm" />
                  <button type="submit" className="rounded-md px-2 text-sm hover:bg-accent">{copy.save}</button>
                  <button type="button" onClick={() => { setResetting(null); setPassword(""); }} className="rounded-md px-2 text-sm text-muted-foreground hover:bg-accent">{copy.cancel}</button>
                </form>
              : <>
                  <button type="button" onClick={() => { setResetting(u.username); setPassword(""); }} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">{copy.resetPassword}</button>
                  {u.username !== adminUsername && <button type="button" onClick={() => void remove(u.username)} aria-label={`${copy.delete}: ${u.username}`} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-red-500/10 hover:text-red-500">{copy.delete}</button>}
                </>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </main>;
}
