import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { KnowledgePage } from "../components/knowledge-page.tsx";
import {
  ALL_SCOPES,
  countVisible,
  findSections,
  formatCitation,
  layoutKnowledgeMap,
  toggleScope,
} from "../components/knowledge-map-model.ts";
import { catalogFor } from "../src/i18n/catalog.ts";
import type { KnowledgeMapNode, KnowledgeMapResponse } from "../src/knowledge/map-contracts.ts";

const copy = catalogFor("en").knowledge;

function docNode(scope: "shared" | "personal", documentId: string, fileName: string, chunkCount = 4): KnowledgeMapNode {
  return { id: `${scope}:${documentId}`, kind: "document", scope, documentId, fileName, label: fileName, path: [], chunkCount };
}
function secNode(scope: "shared" | "personal", documentId: string, fileName: string, path: string[], chunkCount = 2): KnowledgeMapNode {
  return { id: `${scope}:${documentId}:${path.join("\u001f")}`, kind: "section", scope, documentId, fileName, label: path[path.length - 1]!, path, chunkCount };
}

const sharedDoc = docNode("shared", "s1", "handbook.pdf");
const sharedCh = secNode("shared", "s1", "handbook.pdf", ["Chapter 5"]);
const sharedSub = secNode("shared", "s1", "handbook.pdf", ["Chapter 5", "AXI Interface"]);
const mineDoc = docNode("personal", "p1", "notes.md");
const mineSec = secNode("personal", "p1", "notes.md", ["Intro"]);
const sample: KnowledgeMapResponse = {
  nodes: [sharedDoc, sharedCh, sharedSub, mineDoc, mineSec],
  edges: [
    { from: sharedDoc.id, to: sharedCh.id },
    { from: sharedCh.id, to: sharedSub.id },
    { from: mineDoc.id, to: mineSec.id },
  ],
};

it("layout is deterministic and places documents as roots at their tree origin", () => {
  const a = layoutKnowledgeMap(sample, ALL_SCOPES);
  const b = layoutKnowledgeMap(sample, ALL_SCOPES);
  assert.deepEqual(a, b);
  assert.equal(a.nodes.length, 5);
  assert.equal(a.edges.length, 3);
  const pos = new Map(a.nodes.map((l) => [l.node.id, l]));
  const d1 = pos.get(sharedDoc.id)!;
  const d2 = pos.get(mineDoc.id)!;
  assert.notDeepEqual([d1.x, d1.y], [d2.x, d2.y]);
  // Sections are farther from their own document than the document is from itself.
  const dist = (n: KnowledgeMapNode, root: { x: number; y: number }) => Math.hypot(pos.get(n.id)!.x - root.x, pos.get(n.id)!.y - root.y);
  assert.ok(dist(sharedCh, d1) > 0);
  assert.ok(dist(sharedSub, d1) > dist(sharedCh, d1));
  assert.ok(dist(mineSec, d2) > 0);
  // Documents are drawn larger than sections.
  assert.ok(d1.radius > pos.get(sharedCh.id)!.radius);
  assert.ok(a.nodes.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y)));
});

it("layout filter hides a scope's nodes and edges", () => {
  const onlyShared = layoutKnowledgeMap(sample, { shared: true, personal: false });
  assert.deepEqual(onlyShared.nodes.map((l) => l.node.scope), ["shared", "shared", "shared"]);
  assert.equal(onlyShared.edges.length, 2);
  const onlyMine = layoutKnowledgeMap(sample, { shared: false, personal: true });
  assert.deepEqual(onlyMine.nodes.map((l) => l.node.id), [mineDoc.id, mineSec.id]);
  assert.deepEqual(onlyMine.edges, [{ from: mineDoc.id, to: mineSec.id }]);
});

it("layout drops edges whose endpoint is not visible and handles empty input", () => {
  const dangling = layoutKnowledgeMap({ nodes: [mineDoc], edges: [{ from: mineDoc.id, to: "missing" }] }, ALL_SCOPES);
  assert.equal(dangling.edges.length, 0);
  assert.equal(dangling.nodes.length, 1);
  assert.deepEqual(layoutKnowledgeMap({ nodes: [], edges: [] }, ALL_SCOPES), { nodes: [], edges: [] });
});

it("filter reducer keeps the last active chip on", () => {
  const sharedOff = toggleScope(ALL_SCOPES, "shared");
  assert.deepEqual(sharedOff, { shared: false, personal: true });
  assert.equal(toggleScope(sharedOff, "personal"), sharedOff);
  assert.deepEqual(toggleScope(sharedOff, "shared"), ALL_SCOPES);
  const personalOff = toggleScope(ALL_SCOPES, "personal");
  assert.equal(toggleScope(personalOff, "shared"), personalOff);
});

it("counts documents and sections of the visible nodes", () => {
  assert.deepEqual(countVisible(sample.nodes), { documents: 2, sections: 3 });
  assert.deepEqual(countVisible(layoutKnowledgeMap(sample, { shared: false, personal: true }).nodes.map((l) => l.node)), { documents: 1, sections: 1 });
  assert.deepEqual(countVisible([]), { documents: 0, sections: 0 });
});

it("find matches label and path over the given nodes only", () => {
  assert.deepEqual(findSections(sample.nodes, "axi").map((n) => n.id), [sharedSub.id]);
  assert.deepEqual(findSections(sample.nodes, "chapter 5").map((n) => n.id).slice(0, 2), [sharedCh.id, sharedSub.id]);
  assert.deepEqual(findSections(sample.nodes, "   "), []);
  assert.deepEqual(findSections(sample.nodes, "zzz"), []);
  const visible = layoutKnowledgeMap(sample, { shared: false, personal: true }).nodes.map((l) => l.node);
  assert.deepEqual(findSections(visible, "axi"), []);
});

it("formats citations per format", () => {
  assert.equal(formatCitation({ format: "pdf", fileName: "a.pdf", page: 7 }, copy), "page 7");
  assert.equal(formatCitation({ format: "pptx", fileName: "a.pptx", slide: 3, title: "T" }, copy), "slide 3");
  assert.equal(formatCitation({ format: "docx", fileName: "a.docx", paragraph: 12 }, copy), "¶12");
  assert.equal(formatCitation({ format: "md", fileName: "a.md", lineStart: 10, lineEnd: 24 }, copy), "lines 10–24");
  assert.equal(formatCitation({ format: "txt", fileName: "a.txt", lineStart: 1, lineEnd: 2 }, catalogFor("ja").knowledge), "1–2 行");
});

type Ctx = { host: Element; calls: string[]; click: (el: Element) => Promise<void>; type: (el: Element, value: string) => Promise<void> };

async function withPage(respond: (url: string) => Response, run: (ctx: Ctx) => Promise<void>) {
  const dom = parseHTML("<html><body><div id='host'></div></body></html>");
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  const host = dom.document.querySelector("#host")!;
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<I18nProvider language="en"><KnowledgePage initialDocuments={[]} sharedDocuments={[]} /></I18nProvider>); });
    await run({
      host, calls,
      click: async (el) => { await act(async () => { (el as HTMLElement).click(); }); },
      type: async (el, value) => {
        // linkedom lacks oninput support, so React never wires text-input events;
        // invoke the element's React onChange prop directly with the new value.
        await act(async () => {
          const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))!;
          (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key]!.onChange({ target: { value } });
        });
      },
    });
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, saved);
  }
}

const button = (host: Element, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent!.trim() === label)!;
const mapCalls = (calls: string[]) => calls.filter((u) => u.startsWith("/api/knowledge/map"));

it("tabs switch and the Map requests /api/knowledge/map only when opened", async () => {
  await withPage(() => Response.json(sample), async ({ host, calls, click }) => {
    assert.equal(mapCalls(calls).length, 0);
    const docsTab = button(host, copy.tabDocuments);
    const mapTab = button(host, copy.tabMap);
    assert.equal(docsTab.getAttribute("aria-selected"), "true");
    assert.equal(mapTab.getAttribute("aria-selected"), "false");
    await click(mapTab);
    assert.equal(mapCalls(calls).length, 1);
    assert.equal(mapTab.getAttribute("aria-selected"), "true");
    assert.ok(host.textContent!.includes("2 documents · 3 sections"));
    // Back to Documents and to Map again: no refetch.
    await click(docsTab);
    await click(mapTab);
    assert.equal(mapCalls(calls).length, 1);
  });
});

it("chips filter counts and the last chip cannot be turned off", async () => {
  await withPage(() => Response.json(sample), async ({ host, click }) => {
    await click(button(host, copy.tabMap));
    const chips = () => ({ shared: button(host, copy.filterShared), mine: button(host, copy.filterPersonal) });
    assert.equal(chips().shared.getAttribute("aria-pressed"), "true");
    assert.equal(chips().mine.getAttribute("aria-pressed"), "true");
    await click(chips().shared);
    assert.equal(chips().shared.getAttribute("aria-pressed"), "false");
    assert.ok(host.textContent!.includes("1 documents · 1 sections"));
    await click(chips().mine);
    assert.equal(chips().mine.getAttribute("aria-pressed"), "true");
    assert.ok(host.textContent!.includes("1 documents · 1 sections"));
  });
});

it("empty map shows the empty state", async () => {
  await withPage(() => Response.json({ nodes: [], edges: [] }), async ({ host, click }) => {
    await click(button(host, copy.tabMap));
    assert.ok(host.textContent!.includes(copy.mapEmpty));
  });
});

it("find selects a section and the side panel shows its fetched text", async () => {
  const body: unknown = { scope: "shared", documentId: "s1", fileName: "handbook.pdf", path: ["Chapter 5", "AXI Interface"], text: "AXI handshake text", truncated: true, citation: { format: "pdf", fileName: "handbook.pdf", page: 9 } };
  await withPage((url) => (url.startsWith("/api/knowledge/section") ? Response.json(body) : Response.json(sample)), async ({ host, calls, click, type }) => {
    await click(button(host, copy.tabMap));
    await type(host.querySelector(`input[aria-label="${copy.findSection}"]`)!, "axi");
    await click(button(host, "AXI Interface"));
    const sectionCall = calls.find((u) => u.startsWith("/api/knowledge/section"))!;
    assert.ok(sectionCall.includes("scope=shared"));
    assert.ok(sectionCall.includes("doc=s1"));
    assert.ok(sectionCall.includes(`path=${encodeURIComponent(JSON.stringify(["Chapter 5", "AXI Interface"]))}`));
    const panel = host.querySelector("aside")!;
    assert.ok(panel.textContent!.includes("Chapter 5 › AXI Interface"));
    assert.ok(panel.textContent!.includes("handbook.pdf · page 9"));
    assert.ok(panel.textContent!.includes("AXI handshake text"));
    assert.ok(panel.textContent!.includes(copy.sectionTruncated));
    await click(button(host, "×"));
    assert.equal(host.querySelector("aside"), null);
  });
});

it("a 404 from the section endpoint shows the not-found message", async () => {
  await withPage((url) => (url.startsWith("/api/knowledge/section") ? Response.json({ error: "not_found" }, { status: 404 }) : Response.json(sample)), async ({ host, click, type }) => {
    await click(button(host, copy.tabMap));
    await type(host.querySelector(`input[aria-label="${copy.findSection}"]`)!, "intro");
    await click(button(host, "Intro"));
    assert.ok(host.querySelector("aside")!.textContent!.includes(copy.sectionNotFound));
  });
});
