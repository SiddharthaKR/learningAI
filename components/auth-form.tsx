"use client";

import { useState, type FormEvent } from "react";
import { catalogFor } from "@/src/i18n/catalog";

export function AuthForm({ mode, initialLanguage }: { mode: "login" | "signup"; initialLanguage: "en" | "ja" }) {
  const [language, setLanguage] = useState(initialLanguage);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";
  const copy = catalogFor(language);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password"), ...(signup ? { language } : {}) }) });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? copy.auth.requestFailed);
      }
      window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.auth.requestFailed); setPending(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center p-6">
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">{signup ? copy.auth.signupTitle : copy.auth.loginTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Learning Harness</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {signup && <label className="mb-4 flex flex-col gap-1.5 text-sm font-medium">{copy.auth.language}<select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "ja")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus:border-ring">{<><option value="en">{copy.common.english}</option><option value="ja">{copy.common.japanese}</option></>}</select></label>}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">{copy.auth.username}<input name="username" autoComplete="username" required minLength={3} maxLength={32} className="rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus:border-ring" /></label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">{copy.auth.password}<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} className="rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus:border-ring" /></label>
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={pending} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">{pending ? copy.auth.pending : signup ? copy.auth.signup : copy.auth.login}</button>
        </form>
      </div>
      <p className="text-center text-sm text-muted-foreground"><a href={signup ? "/login" : "/signup"} className="font-medium text-foreground underline underline-offset-2 hover:no-underline">{signup ? copy.auth.toLogin : copy.auth.toSignup}</a></p>
    </div>
  </main>;
}
