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
  return <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 p-6">
    <h1 className="text-2xl font-semibold">{signup ? copy.auth.signupTitle : copy.auth.loginTitle}</h1>
    {signup && <label className="flex flex-col gap-1">{copy.auth.language}<select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "ja")} className="rounded border p-2"><option value="en">{copy.common.english}</option><option value="ja">{copy.common.japanese}</option></select></label>}
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">{copy.auth.username}<input name="username" autoComplete="username" required minLength={3} maxLength={32} className="rounded border p-2" /></label>
      <label className="flex flex-col gap-1">{copy.auth.password}<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} className="rounded border p-2" /></label>
      {error && <p role="alert" className="text-red-500">{error}</p>}
      <button type="submit" disabled={pending} className="rounded bg-blue-600 p-2 text-white disabled:opacity-50">{pending ? copy.auth.pending : signup ? copy.auth.signup : copy.auth.login}</button>
    </form>
    <a href={signup ? "/login" : "/signup"} className="underline">{signup ? copy.auth.toLogin : copy.auth.toSignup}</a>
  </main>;
}
