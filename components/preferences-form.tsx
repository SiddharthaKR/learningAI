"use client";

import { useState } from "react";

type Language = "en" | "ja";
export function PreferencesForm({ initial }: { initial: { uiLanguage: Language; teachingLanguage: Language; background: string } }) {
  const [uiLanguage, setUiLanguage] = useState(initial.uiLanguage);
  const [teachingLanguage, setTeachingLanguage] = useState(initial.teachingLanguage);
  const [background, setBackground] = useState(initial.background);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const japanese = uiLanguage === "ja";
  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ uiLanguage, teachingLanguage, background }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not save preferences");
      setMessage(japanese ? "保存しました" : "Saved");
      document.documentElement.lang = uiLanguage;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save preferences"); }
    finally { setSaving(false); }
  }
  return <main className="mx-auto flex max-w-xl flex-col gap-5 p-6">
    <h1 className="text-2xl font-semibold">{japanese ? "設定" : "Preferences"}</h1>
    <label className="flex flex-col gap-1">{japanese ? "表示言語" : "UI language"}
      <select value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value as Language)} className="rounded border bg-background p-2"><option value="en">English</option><option value="ja">日本語</option></select>
    </label>
    <label className="flex flex-col gap-1">{japanese ? "授業の言語（新しいセッション用）" : "Teaching language for new sessions"}
      <select value={teachingLanguage} onChange={(event) => setTeachingLanguage(event.target.value as Language)} className="rounded border bg-background p-2"><option value="en">English</option><option value="ja">日本語</option></select>
    </label>
    <label className="flex flex-col gap-1">{japanese ? "私の専門分野" : "My background"}
      <textarea value={background} onChange={(event) => setBackground(event.target.value)} maxLength={2000} rows={4} className="rounded border bg-background p-2" placeholder={japanese ? "例：FPGA/DSP エンジニア。固定小数点とリアルタイム制御が得意。量子光学は初学者。" : "For example: FPGA/DSP engineer, strong in fixed-point and real-time control, new to quantum optics."} />
    </label>
    <button type="button" onClick={() => void save()} disabled={saving} className="self-start rounded bg-accent px-4 py-2 disabled:opacity-50">{japanese ? "保存" : "Save"}</button>
    {message && <p role="status">{message}</p>}
  </main>;
}
