import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { KnowledgePage } from "../components/knowledge-page.tsx";
import { catalogFor } from "../src/i18n/catalog.ts";

const copy = catalogFor("en").knowledge;
type Doc = { id: string; fileName: string; format: string; status: string };
type Call = { url: string; method: string; destination: FormDataEntryValue | null; hasDestination: boolean };

async function withPage(
  props: { initialDocuments?: Doc[]; sharedDocuments?: Doc[]; isAdmin?: boolean },
  respond: (url: string, init: RequestInit | undefined, file: File) => Response,
  run: (ctx: { host: Element; calls: Call[]; pick: (file: File) => void; submit: () => Promise<void>; click: (el: Element) => Promise<void>; flush: () => Promise<void> }) => Promise<void>,
) {
  const dom = parseHTML("<html><body><div id='host'></div></body></html>");
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, FormData: globalThis.FormData };
  Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
  let selected = new File(["x"], "none.txt");
  globalThis.FormData = class extends saved.FormData {
    constructor() { super(); this.set("file", selected); }
  };
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof saved.FormData ? init.body : undefined;
    calls.push({ url, method: init?.method ?? "GET", destination: body?.get("destination") ?? null, hasDestination: body?.has("destination") ?? false });
    return respond(url, init, selected);
  }) as typeof fetch;
  const host = dom.document.querySelector("#host")!;
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<I18nProvider language="en"><KnowledgePage initialDocuments={props.initialDocuments ?? []} sharedDocuments={props.sharedDocuments} isAdmin={props.isAdmin} /></I18nProvider>); });
    (host.querySelector("form") as HTMLFormElement).reset = () => {};
    await run({
      host, calls,
      pick: (file) => { selected = file; },
      submit: async () => { await act(async () => { Object.defineProperty(host.querySelector('input[type="file"]')!, "files", { configurable: true, get: () => [selected] }); host.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); },
      click: async (el) => { await act(async () => { (el as HTMLElement).click(); }); },
      flush: async () => { await act(async () => {}); },
    });
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, saved);
  }
}

const toggle = (host: Element, label: string) => [...host.querySelectorAll('[role="group"] button')].find((b) => b.textContent === label)!;
const section = (host: Element, label: string) => host.querySelector(`section[aria-label="${label}"]`);
const doc = (id: string, fileName: string): Doc => ({ id: id.repeat(64), fileName, format: "txt", status: "ready" });
const uploaded = (url: string, init: RequestInit | undefined, file: File) =>
  Response.json({ document: doc("d", file.name) });

it("defaults to Personal: upload sends no destination and lands in the personal list", async () => {
  await withPage({}, uploaded, async ({ host, calls, pick, submit }) => {
    assert.equal(toggle(host, copy.personal).getAttribute("aria-pressed"), "true");
    assert.equal(toggle(host, copy.shared).getAttribute("aria-pressed"), "false");
    pick(new File(["hello"], "mine.txt"));
    await submit();
    const post = calls.find((c) => c.method === "POST")!;
    assert.equal(post.hasDestination, false);
    assert.ok(section(host, copy.documents)!.textContent!.includes("mine.txt"));
    assert.equal(section(host, copy.sharedDocuments), null);
  });
});

it("selecting Shared sends destination=shared and shows the doc in the shared section", async () => {
  await withPage({}, uploaded, async ({ host, calls, pick, submit, click }) => {
    await click(toggle(host, copy.shared));
    assert.equal(toggle(host, copy.shared).getAttribute("aria-pressed"), "true");
    assert.equal(toggle(host, copy.personal).getAttribute("aria-pressed"), "false");
    pick(new File(["hello"], "team.txt"));
    await submit();
    assert.equal(calls.find((c) => c.method === "POST")!.destination, "shared");
    assert.ok(section(host, copy.sharedDocuments)!.textContent!.includes("team.txt"));
    assert.ok(!section(host, copy.documents)!.textContent!.includes("team.txt"));
  });
});

it("deleting a shared doc calls the ?scope=shared URL and removes the row", async () => {
  const id = "s".repeat(64);
  await withPage({ initialDocuments: [doc("p", "personal.txt")], sharedDocuments: [doc("s", "shared.txt")] },
    () => Response.json({ deleted: true }), async ({ host, calls, click }) => {
      await click(section(host, copy.sharedDocuments)!.querySelector("li button")!);
      const del = calls.find((c) => c.method === "DELETE")!;
      assert.equal(del.url, `/api/knowledge/documents/${id}?scope=shared`);
      assert.equal(section(host, copy.sharedDocuments), null);
      assert.ok(section(host, copy.documents)!.textContent!.includes("personal.txt"));
    });
});

it("non-admin never renders Shared activity or fetches the audit endpoint", async () => {
  await withPage({ isAdmin: false, sharedDocuments: [doc("s", "shared.txt")] }, () => Response.json({ deleted: true }), async ({ host, calls, click, flush }) => {
    await flush();
    assert.equal(section(host, copy.sharedActivity), null);
    await click(section(host, copy.sharedDocuments)!.querySelector("li button")!);
    assert.equal(calls.some((c) => c.url.includes("/api/knowledge/audit")), false);
  });
});

it("admin sees fetched Shared activity events, and the empty state when none", async () => {
  const events = [
    { at: "2026-01-02T00:00:00.000Z", userId: "u2", username: "bob", action: "delete", fileName: "old.pdf", documentId: "x".repeat(64) },
    { at: "2026-01-01T00:00:00.000Z", userId: "u1", username: "alice", action: "add", fileName: "new.docx", documentId: "y".repeat(64) },
  ];
  await withPage({ isAdmin: true }, (url) => Response.json({ events }), async ({ host, calls }) => {
    assert.ok(calls.some((c) => c.url === "/api/knowledge/audit"));
    const text = section(host, copy.sharedActivity)!.textContent!;
    for (const part of ["bob", copy.deleted, "old.pdf", "alice", copy.added, "new.docx"]) assert.ok(text.includes(part), part);
    assert.equal(section(host, copy.sharedActivity)!.querySelectorAll("li").length, 2);
  });
  await withPage({ isAdmin: true }, () => Response.json({ events: [] }), async ({ host }) => {
    assert.ok(section(host, copy.sharedActivity)!.textContent!.includes(copy.noActivity));
  });
});

it("shows the no_readable_text message when the server rejects the upload", async () => {
  await withPage({}, () => Response.json({ error: "no_readable_text" }, { status: 422 }), async ({ host, pick, submit }) => {
    pick(new File(["   "], "blank.txt"));
    await submit();
    assert.equal(host.querySelector('[role="alert"]')?.textContent, "This file has no readable text.");
  });
});
