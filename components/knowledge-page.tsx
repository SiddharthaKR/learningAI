"use client";

import { useState, useRef, useCallback, type FormEvent, type DragEvent } from "react";
import { useI18n } from "@/components/i18n-provider";
import { SidebarToggle } from "@/components/sidebar";
import type { KnowledgeDocumentRecord } from "@/src/core";
import { validateKnowledgeUpload } from "@/src/core";

const FORMAT_LABELS: Record<string, string> = { pdf: "PDF", pptx: "PPTX", docx: "DOCX", md: "MD", txt: "TXT" };

function FormatBadge({ format }: { format?: string }) {
  if (!format) return null;
  return <span className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-xs font-medium tracking-wide text-accent-foreground">{FORMAT_LABELS[format] ?? format.toUpperCase()}</span>;
}

function StatusBadge({ status, copy }: { status: string; copy: { ready: string; noTextLayer: string; rejected: string } }) {
  if (status === "ready") return <span className="text-xs text-emerald-600 dark:text-emerald-400">{copy.ready}</span>;
  if (status === "no_text_layer") return <span className="text-xs text-amber-600 dark:text-amber-400">{copy.noTextLayer}</span>;
  return <span className="text-xs text-red-500">{copy.rejected}</span>;
}

export function KnowledgePage({ initialDocuments, sharedDocuments = [] }: { initialDocuments: KnowledgeDocumentRecord[]; sharedDocuments?: KnowledgeDocumentRecord[] }) {
  const copy = useI18n().knowledge;
  const [documents, setDocuments] = useState(initialDocuments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function message(code: string): string {
    const errors: Record<string, string> = { unsupported_format: copy.unsupported_format, too_large: copy.too_large, invalid_upload: copy.invalid_upload, invalid_file_name: copy.invalid_file_name, upload_failed: copy.upload_failed, delete_failed: copy.delete_failed };
    return errors[code] ?? copy.upload_failed;
  }

  const uploadFile = useCallback(async (file: File) => {
    setError("");
    try { validateKnowledgeUpload(file.name, file.size, file.type); }
    catch (failure) { setError(message(failure instanceof Error ? failure.message : "invalid_upload")); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/knowledge/documents", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDocuments((prev) => prev.some((d) => d.id === result.document.id) ? prev : [...prev, result.document]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (failure) { setError(message(failure instanceof Error ? failure.message : "upload_failed")); }
    finally { setBusy(false); }
  }, [copy]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError(copy.invalid_upload); return; }
    void uploadFile(file);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadFile(file);
  }

  function handleDragOver(event: DragEvent) { event.preventDefault(); setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }

  async function remove(id: string) {
    setDeletingId(id);
    setError("");
    try {
      const response = await fetch(`/api/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete_failed");
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch { setError(copy.delete_failed); }
    finally { setDeletingId(null); }
  }

  return <main className="flex min-w-0 flex-1 flex-col overflow-auto">
    <header className="lh-drag flex items-center gap-3 border-b border-border px-6 py-4">
      <SidebarToggle />
      <h1 className="text-lg font-semibold">{copy.title}</h1>
    </header>

    <div className="mx-auto w-full max-w-2xl space-y-8 p-6 pb-16">
      <p className="text-muted-foreground">{copy.description}</p>

      {/* Upload zone */}
      <form onSubmit={handleSubmit}>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !busy && fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors ${dragOver ? "border-blue-500 bg-blue-500/10" : "border-border hover:border-muted-foreground hover:bg-accent/50"} ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <svg className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <div className="text-center">
            <p className="font-medium">{busy ? copy.working : copy.chooseFile}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy.acceptedFormats}</p>
          </div>
        </div>
        <input ref={fileInputRef} name="file" type="file" accept=".pdf,.pptx,.docx,.md,.txt" disabled={busy} className="hidden" onChange={(e) => { if (e.target.files?.[0]) void uploadFile(e.target.files[0]); }} />
      </form>

      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>}

      {/* Documents list */}
      <section aria-label={copy.documents}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{copy.documents}</h2>
        {documents.length === 0
          ? <div className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">{copy.empty}</div>
          : <ul className="space-y-2">{documents.map((doc) => (
              <li key={doc.id} className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FormatBadge format={doc.format} />
                    <p className="truncate font-medium">{doc.fileName}</p>
                  </div>
                  <div className="mt-1"><StatusBadge status={doc.status} copy={copy} /></div>
                </div>
                <button
                  type="button"
                  disabled={deletingId === doc.id}
                  onClick={() => void remove(doc.id)}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                  aria-label={`${copy.delete}: ${doc.fileName}`}
                >{deletingId === doc.id ? "…" : copy.delete}</button>
              </li>
            ))}</ul>}
      </section>
      {sharedDocuments.length > 0 && (
        <section aria-label={copy.sharedDocuments}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{copy.sharedDocuments}</h2>
          <ul className="space-y-2">{sharedDocuments.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <FormatBadge format={doc.format} />
              <span className="min-w-0 flex-1 truncate">{doc.fileName}</span>
              <StatusBadge status={doc.status} copy={copy} />
            </li>
          ))}</ul>
        </section>
      )}
    </div>
  </main>;
}
