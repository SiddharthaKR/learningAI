"use client";

import { useI18n } from "@/components/i18n-provider";
import type { KnowledgeStats } from "@/src/core";

export function AdminKnowledge({ stats }: { stats: KnowledgeStats }) {
  const copy = useI18n().knowledge;
  const dayLabel = (day: string) => (day === "unknown" ? copy.adminUnknown : day);
  const th = "px-3 py-2 text-left font-medium text-muted-foreground";
  const td = "px-3 py-2";
  return <main className="flex min-w-0 flex-1 flex-col overflow-auto">
    <header className="border-b border-border px-6 py-4"><h1 className="text-lg font-semibold">{copy.adminTitle}</h1></header>
    <div className="mx-auto w-full max-w-4xl space-y-8 p-6 pb-16">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{copy.adminTotalItems}</p><p data-testid="total-items" className="text-2xl font-semibold">{stats.totalItems}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{copy.adminTotalChunks}</p><p data-testid="total-chunks" className="text-2xl font-semibold">{stats.totalChunks}</p></div>
      </div>

      <section aria-label={copy.adminUploadsOverTime}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{copy.adminUploadsOverTime}</h2>
        <table className="w-full text-sm"><thead><tr className="border-b border-border"><th className={th}>{copy.adminDay}</th><th className={th}>{copy.adminCount}</th></tr></thead>
          <tbody>{stats.uploadsByDay.map((row) => <tr key={row.day} className="border-b border-border/50"><td className={td}>{dayLabel(row.day)}</td><td className={td}>{row.count}</td></tr>)}</tbody></table>
      </section>

      <section aria-label={copy.adminSharedItems}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{copy.adminSharedItems}</h2>
        {stats.items.length === 0 ? <p className="text-sm text-muted-foreground">{copy.adminEmpty}</p> :
          <table className="w-full text-sm"><thead><tr className="border-b border-border">
            {[copy.adminFileName, copy.adminFormat, copy.adminStatus, copy.adminChunks, copy.adminUploadedBy, copy.adminUploadedAt].map((label) => <th key={label} className={th}>{label}</th>)}
          </tr></thead><tbody>{stats.items.map((item) => <tr key={item.id} className="border-b border-border/50">
            <td className={td}>{item.fileName}</td>
            <td className={td}>{item.format ? item.format.toUpperCase() : ""}</td>
            <td className={td}>{item.status === "ready" ? copy.ready : item.status === "no_text_layer" ? copy.noTextLayer : copy.rejected}</td>
            <td className={td}>{item.chunkCount}</td>
            <td className={td}>{item.uploadedBy ?? copy.adminUnknown}</td>
            <td className={td}>{item.uploadedAt ? item.uploadedAt.slice(0, 10) : copy.adminUnknown}</td>
          </tr>)}</tbody></table>}
      </section>
    </div>
  </main>;
}
