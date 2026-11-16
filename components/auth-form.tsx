"use client";

import { useState, type FormEvent } from "react";
import { catalogFor } from "@/src/core";

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
  return <main className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden p-6">
    <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_14%,transparent),transparent_70%)]" />
    <div className="relative w-full max-w-md space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">{signup ? copy.auth.signupTitle : copy.auth.loginTitle}</h1>
        <p className="mt-2 text-sm font-medium text-muted-foreground">Learning Harness</p>
        <p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">{copy.auth.tagline}</p>
      </div>
      <div className="rounded-2xl border border-border bg-card/80 p-8 shadow-lg backdrop-blur">
        {signup && <label className="mb-4 flex flex-col gap-1.5 text-sm font-medium">{copy.auth.language}<select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "ja")} className="h-11 rounded-lg border border-input bg-background px-3.5 text-sm transition-[border-color,box-shadow] focus:border-ring focus:outline-none">{<><option value="en">{copy.common.english}</option><option value="ja">{copy.common.japanese}</option></>}</select></label>}
        <form onSubmit={submit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-sm font-medium">{copy.auth.username}<input name="username" autoComplete="username" required minLength={3} maxLength={32} className="h-11 rounded-lg border border-input bg-background px-3.5 text-sm transition-[border-color,box-shadow] focus:border-ring focus:outline-none" /></label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">{copy.auth.password}<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} className="h-11 rounded-lg border border-input bg-background px-3.5 text-sm transition-[border-color,box-shadow] focus:border-ring focus:outline-none" /></label>
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={pending} className="mt-1 h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">{pending ? copy.auth.pending : signup ? copy.auth.signup : copy.auth.login}</button>
        </form>
        {!signup && <p className="mt-4 text-center text-xs text-muted-foreground">{copy.auth.forgotPassword}</p>}
      </div>
      <p className="text-center text-sm text-muted-foreground"><a href={signup ? "/login" : "/signup"} className="font-medium text-foreground underline underline-offset-2 hover:no-underline">{signup ? copy.auth.toLogin : copy.auth.toSignup}</a></p>
    </div>
  </main>;
}
