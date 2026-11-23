import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { AdminKnowledge } from "../components/admin-knowledge.tsx";
import { computeKnowledgeStats } from "../src/knowledge/stats.ts";
import { catalogFor } from "../src/i18n/catalog.ts";
import type { KnowledgeSnapshot } from "../src/knowledge/index-store.ts";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const citation = (fileName: string) => ({ format: "txt" as const, fileName, lineStart: 1, lineEnd: 1 });
const snapshot = {
  version: 1, generatedAt: "2026-11-01T00:00:00.000Z",
  documents: [
    { id: A, fileName: "a.txt", format: "txt", status: "ready" },
    { id: B, fileName: "b.txt", format: "txt", status: "ready" },
    { id: C, fileName: "c.txt", format: "txt", status: "ready" },
  ],
  chunks: [
    { id: "1".repeat(64), sourceId: A, text: "x", citation: citation("a.txt") },
    { id: "2".repeat(64), sourceId: A, text: "y", citation: citation("a.txt") },
    { id: "3".repeat(64), sourceId: B, text: "z", citation: citation("b.txt") },
  ],
} as unknown as KnowledgeSnapshot;
const audit = [
  // newest first, as readSharedKnowledgeAudit returns them
  { at: "2026-11-03T09:00:00.000Z", userId: "u2", username: "bob", action: "add" as const, fileName: "b.txt", documentId: B },
  { at: "2026-11-02T09:00:00.000Z", userId: "u1", username: "ann", action: "delete" as const, fileName: "a.txt", documentId: A },
  { at: "2026-11-01T09:00:00.000Z", userId: "u1", username: "ann", action: "add" as const, fileName: "a.txt", documentId: A },
  { at: "2026-11-01T10:00:00.000Z", userId: "u1", username: "ann", action: "add" as const, fileName: "gone.txt", documentId: "d".repeat(64) },
];

it("computes totals, per-item chunks and uploader/date from the latest add event", () => {
  const stats = computeKnowledgeStats(snapshot, audit);
  assert.equal(stats.totalItems, 3);
  assert.equal(stats.totalChunks, 3);
  assert.deepEqual(stats.items.map((i) => [i.fileName, i.chunkCount, i.uploadedBy, i.uploadedAt]), [
    ["a.txt", 2, "ann", "2026-11-01T09:00:00.000Z"],
    ["b.txt", 1, "bob", "2026-11-03T09:00:00.000Z"],
    ["c.txt", 0, undefined, undefined],
  ]);
  // Only documents still in the store count; items with no add event group as "unknown".
  assert.deepEqual(stats.uploadsByDay, [{ day: "2026-11-01", count: 1 }, { day: "2026-11-03", count: 1 }, { day: "unknown", count: 1 }]);
});

for (const language of ["en", "ja"] as const) {
  it(`renders the admin knowledge library in ${language}`, () => {
    const copy = catalogFor(language).knowledge;
    const html = renderToStaticMarkup(<I18nProvider language={language}><AdminKnowledge stats={computeKnowledgeStats(snapshot, audit)} /></I18nProvider>);
    for (const text of [copy.adminTitle, copy.adminTotalItems, copy.adminUploadsOverTime, "a.txt", "ann", "bob", "2026-11-03"]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`aria-label="${catalogFor(language).sidebar.open}"`), "header carries the sidebar toggle, like /admin");
    assert.ok(!html.includes("undefined"));
  });
}

it("the /admin/knowledge page is guarded by withOfficeAdminPage", () => {
  assert.match(readFileSync(new URL("../app/admin/knowledge/page.tsx", import.meta.url), "utf8"), /withOfficeAdminPage\(/u);
});
