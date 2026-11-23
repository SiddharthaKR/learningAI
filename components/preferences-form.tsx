"use client";

import { useState } from "react";
import { SidebarToggle } from "@/components/sidebar";
import { catalogFor, type UiLanguage } from "@/src/core";

type Language = UiLanguage;
export function PreferencesForm({ initial }: { initial: { uiLanguage: Language; teachingLanguage: Language; background: string; reasoning: boolean } }) {
  const [uiLanguage, setUiLanguage] = useState(initial.uiLanguage);
  const [teachingLanguage, setTeachingLanguage] = useState(initial.teachingLanguage);
  const [background, setBackground] = useState(initial.background);
  const [reasoning, setReasoning] = useState(initial.reasoning);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const copy = catalogFor(uiLanguage);
  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ uiLanguage, teachingLanguage, background, reasoning }) });
      if (!response.ok) throw new Error((await response.json()).error ?? copy.preferences.saveError);
      setMessage(copy.preferences.saved);
      document.documentElement.lang = uiLanguage;
    } catch (error) { setMessage(error instanceof Error ? error.message : copy.preferences.saveError); }
    finally { setSaving(false); }
  }
  return <main className="flex min-w-0 flex-1 flex-col overflow-auto">
    <header className="lh-drag flex items-center gap-3 border-b border-border px-6 py-4">
      <SidebarToggle />
      <div className="flex flex-col">
        <h1 className="text-lg font-semibold">{copy.preferences.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.preferences.subtitle}</p>
      </div>
    </header>
    <div className="mx-auto w-full max-w-xl flex-col gap-5 p-6">
    <label className="flex flex-col gap-1">{copy.preferences.uiLanguage}
      <select value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value as Language)} className="rounded border bg-background p-2"><option value="en">{copy.common.english}</option><option value="ja">{copy.common.japanese}</option></select>
    </label>
    <label className="flex flex-col gap-1">{copy.preferences.teachingLanguage}
      <select value={teachingLanguage} onChange={(event) => setTeachingLanguage(event.target.value as Language)} className="rounded border bg-background p-2"><option value="en">{copy.common.english}</option><option value="ja">{copy.common.japanese}</option></select>
    </label>
    <label className="flex flex-col gap-1">{copy.preferences.background}
      <textarea value={background} onChange={(event) => setBackground(event.target.value)} maxLength={2000} rows={4} className="rounded border bg-background p-2" placeholder={copy.preferences.backgroundPlaceholder} />
    </label>
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={reasoning} onChange={(event) => setReasoning(event.target.checked)} className="mt-1" />
      <span className="flex flex-col">{copy.preferences.reasoning}<span className="text-sm text-muted-foreground">{copy.preferences.reasoningHint}</span></span>
    </label>
    <button type="button" onClick={() => void save()} disabled={saving} className="self-start rounded bg-accent px-4 py-2 disabled:opacity-50">{copy.preferences.save}</button>
    {message && <p role="status">{message}</p>}
    </div>
  </main>;
}
