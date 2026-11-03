"use client";

import { useState, type FormEvent } from "react";

export function AuthForm({ mode, initialLanguage }: { mode: "login" | "signup"; initialLanguage: "en" | "ja" }) {
  const [language, setLanguage] = useState(initialLanguage);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password"), ...(signup ? { language } : {}) }) });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Request failed");
      }
      window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); setPending(false); }
  }
  return <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 p-6">
    <h1 className="text-2xl font-semibold">{signup ? language === "ja" ? "アカウント作成" : "Create account" : language === "ja" ? "ログイン" : "Log in"}</h1>
    {signup && <label className="flex flex-col gap-1">{language === "ja" ? "表示言語" : "Language"}<select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "ja")} className="rounded border p-2"><option value="en">English</option><option value="ja">日本語</option></select></label>}
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">{language === "ja" ? "ユーザー名" : "Username"}<input name="username" autoComplete="username" required minLength={3} maxLength={32} className="rounded border p-2" /></label>
      <label className="flex flex-col gap-1">{language === "ja" ? "パスワード" : "Password"}<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} className="rounded border p-2" /></label>
      {error && <p role="alert" className="text-red-500">{error}</p>}
      <button type="submit" disabled={pending} className="rounded bg-blue-600 p-2 text-white disabled:opacity-50">{pending ? "…" : signup ? language === "ja" ? "登録" : "Sign up" : language === "ja" ? "ログイン" : "Log in"}</button>
    </form>
    <a href={signup ? "/login" : "/signup"} className="underline">{signup ? language === "ja" ? "ログインへ" : "Have an account? Log in" : language === "ja" ? "アカウント作成" : "Create an account"}</a>
  </main>;
}
