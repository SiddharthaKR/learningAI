import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { KnowledgePage } from "../components/knowledge-page.tsx";
import { KnowledgeNavigationLink } from "../components/knowledge-navigation-link.tsx";
import { catalogFor } from "../src/i18n/catalog.ts";

for (const language of ["en", "ja"] as const) {
  it(`renders the Knowledge page and navigation in ${language} with all statuses and localized errors`, () => {
    const copy = catalogFor(language).knowledge;
    assert.ok(copy, "Knowledge locale exists");
    const html = renderToStaticMarkup(<I18nProvider language={language}><KnowledgePage initialDocuments={[
      { id: "a".repeat(64), fileName: "guide.txt", format: "txt", status: "ready" },
      { id: "b".repeat(64), fileName: "scan.pdf", format: "pdf", status: "no_text_layer" },
      { id: "c".repeat(64), fileName: "bad.docx", format: "docx", status: "rejected" },
    ]} /><KnowledgeNavigationLink /></I18nProvider>);
    for (const text of [copy.title, copy.upload, copy.acceptedFormats, copy.ready, copy.noTextLayer, copy.rejected, copy.delete]) assert.ok(html.includes(text), text);
    assert.ok(html.includes('href="/knowledge"'));
    assert.ok(html.includes('accept=".pdf,.pptx,.docx,.md,.txt"'));
    assert.ok(!html.includes("undefined"));
    assert.ok(copy.unsupported_format.length > 0);
    assert.ok(copy.too_large.includes("25"));
    if (language === "en") assert.equal(copy.noTextLayer, "no text layer (OCR not supported)");
    else assert.equal(copy.noTextLayer, "テキストレイヤーがありません（OCRはサポートされていません）");
  });
}

it("shows localized upload errors and updates the list after upload and deletion", async () => {
  const dom = parseHTML("<html><body><div id='host'></div></body></html>");
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, FormData: globalThis.FormData };
  Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
  let selected = new File(["sheet"], "sheet.xlsx");
  // linkedom supplies events/elements but not browser FormData(form). Keep native entries.
  globalThis.FormData = class extends saved.FormData {
    constructor() { super(); this.set("file", selected); }
  };
  const host = dom.document.querySelector("#host")!;
  const root = createRoot(host);
  let transportError: string | undefined;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "DELETE") return Response.json({ deleted: true });
    if (transportError) return Response.json({ error: transportError }, { status: 413 });
    return Response.json({ document: { id: "d".repeat(64), fileName: selected.name, format: "txt", status: "ready" } });
  };
  try {
    for (const language of ["en", "ja"] as const) {
      await act(async () => { root.render(<I18nProvider language={language}><KnowledgePage key={language} initialDocuments={[]} /></I18nProvider>); });
      // The page reads the chosen file from its hidden file input (not FormData(form)),
      // so expose the current selection on that input before submitting.
      const submit = async () => { await act(async () => { Object.defineProperty(host.querySelector('input[type="file"]')!, "files", { configurable: true, get: () => [selected] }); host.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); };
      selected = new File(["sheet"], "sheet.xlsx");
      await submit();
      assert.equal(host.querySelector('[role="alert"]')?.textContent, catalogFor(language).knowledge.unsupported_format);
      selected = new File(["Guide text"], "uploaded.txt");
      transportError = "too_large";
      await submit();
      assert.equal(host.querySelector('[role="alert"]')?.textContent, catalogFor(language).knowledge.too_large);
      transportError = undefined;
      // linkedom does not implement native form.reset().
      (host.querySelector("form")! as HTMLFormElement).reset = () => {};
      await submit();
      assert.ok(host.querySelector("li")?.textContent?.includes("uploaded.txt"));
      await act(async () => { (host.querySelector("li button") as HTMLButtonElement).click(); });
      assert.equal(host.querySelector("li"), null);
      assert.ok(host.textContent?.includes(catalogFor(language).knowledge.empty));
    }
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, saved);
  }
});
