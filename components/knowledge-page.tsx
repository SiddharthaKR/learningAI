"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n-provider";
import { SidebarToggle } from "@/components/sidebar";
import type { KnowledgeDocumentRecord } from "@/src/knowledge/index-store";
import { validateKnowledgeUpload } from "@/src/knowledge/upload";

export function KnowledgePage({ initialDocuments }: { initialDocuments: KnowledgeDocumentRecord[] }) {
  const copy = useI18n().knowledge;
  const [documents, setDocuments] = useState(initialDocuments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function message(code: string): string {
    const errors: Record<string, string> = { unsupported_format: copy.unsupported_format, too_large: copy.too_large, invalid_upload: copy.invalid_upload, invalid_file_name: copy.invalid_file_name, upload_failed: copy.upload_failed, delete_failed: copy.delete_failed };
    return errors[code] ?? copy.upload_failed;
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("file");
    setError("");
    if (!(file instanceof File) || !file.name) { setError(copy.invalid_upload); return; }
    try { validateKnowledgeUpload(file.name, file.size, file.type); }
    catch (failure) { setError(message(failure instanceof Error ? failure.message : "invalid_upload")); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge/documents", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDocuments((previous) => previous.some((document) => document.id === result.document.id) ? previous : [...previous, result.document]);
      formElement.reset();
    } catch (failure) { setError(message(failure instanceof Error ? failure.message : "upload_failed")); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete_failed");
      setDocuments((previous) => previous.filter((document) => document.id !== id));
    } catch { setError(copy.delete_failed); }
    finally { setBusy(false); }
  }
  return <main className="flex min-w-0 flex-1 flex-col overflow-auto">
    <header className="lh-drag flex items-center gap-3 border-b px-6 py-3"><SidebarToggle /><h1>{copy.title}</h1></header>
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <p>{copy.description}</p>
      <form onSubmit={upload} className="space-y-3">
        <label className="block" htmlFor="knowledge-file">{copy.chooseFile}</label>
        <input id="knowledge-file" name="file" type="file" accept=".pdf,.pptx,.docx,.md,.txt" disabled={busy} aria-describedby="knowledge-formats" />
        <p id="knowledge-formats" className="text-sm text-muted-foreground">{copy.acceptedFormats}</p>
        <button type="submit" disabled={busy} className="rounded-md border px-3 py-2 disabled:opacity-50">{busy ? copy.working : copy.upload}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <section aria-label={copy.documents}>
        <h2 className="mb-3">{copy.documents}</h2>
        {documents.length === 0 ? <p>{copy.empty}</p> : <ul className="space-y-3">{documents.map((document) => <li key={document.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0"><p className="break-all">{document.fileName}</p><p className="text-sm text-muted-foreground">{document.status === "ready" ? copy.ready : document.status === "no_text_layer" ? copy.noTextLayer : copy.rejected}</p></div>
          <button type="button" disabled={busy} onClick={() => void remove(document.id)} className="rounded-md border px-3 py-1 disabled:opacity-50" aria-label={`${copy.delete}: ${document.fileName}`}>{copy.delete}</button>
        </li>)}</ul>}
      </section>
    </div>
  </main>;
}
