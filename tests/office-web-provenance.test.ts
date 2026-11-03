import assert from "node:assert/strict";
import { it } from "node:test";
import { createWebTools } from "../src/agent/tools/web.ts";
import { userMessageUrls } from "../src/server/web-provenance.ts";
import { webNeedsApproval } from "../src/server/web-policy.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

it("authorizes only URLs written by the learner, never links from fetched pages or documents", async () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Please read https://example.com/allowed." }] },
    { role: "toolResult", content: [{ type: "text", text: "https://example.com/from-page" }] },
    { role: "assistant", content: [{ type: "text", text: "Document: https://example.com/from-document" }] },
  ] as unknown as LhMessage[];
  const urls = userMessageUrls(messages);
  assert.deepEqual([...urls], ["https://example.com/allowed"]);
  let fetched = 0;
  const tools = createWebTools(() => null, {
    fetch: (async () => { fetched++; return new Response("A readable plain text page", { headers: { "content-type": "text/plain" } }); }) as typeof fetch,
    lookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
    env: { HTTPS_PROXY: "http://proxy.example:8080" },
  }, undefined, { canFetch: (url) => urls.has(url) });
  assert.deepEqual(Object.keys(tools), ["web_fetch"]);
  for (const url of ["https://example.com/from-page", "https://example.com/from-document"]) {
    const result = await tools.web_fetch!.execute!("call", { url, reason: "read" });
    assert.match(String(result.details), /paste the link in chat to let me read it/);
  }
  assert.equal(fetched, 0);
  const result = await tools.web_fetch!.execute!("call", { url: "https://example.com/allowed", reason: "read" });
  assert.match(String(result.details), /readable plain text/);
  assert.equal(fetched, 1);
});

it("keeps the approval gate after knowledge is turned back off", () => {
  assert.equal(webNeedsApproval({ settings: { webResearchEnabled: true, officeKnowledgeEnabled: false }, knowledgeUsed: true }), true);
  assert.equal(webNeedsApproval({ settings: { webResearchEnabled: true, officeKnowledgeEnabled: false }, knowledgeUsed: false }), false);
  assert.equal(webNeedsApproval({ settings: { webResearchEnabled: false, officeKnowledgeEnabled: true }, knowledgeUsed: true }), false);
});

it("search results authorize a URL, while a URL inside a fetched page does not", async () => {
  const searchUrls = new Set<string>();
  const fetched: string[] = [];
  const tools = createWebTools(() => ({
    id: "searxng",
    search: async () => [{ title: "Result", url: "https://example.com/result", snippet: "source" }],
  }), {
    fetch: (async (url: string) => {
      fetched.push(url);
      return new Response("See also https://example.com/inside-page", { headers: { "content-type": "text/plain" } });
    }) as typeof fetch,
    lookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
    env: { HTTPS_PROXY: "http://proxy.example:8080" },
  }, undefined, {
    canFetch: (url) => searchUrls.has(url),
    onSearchResults: (hits) => { for (const hit of hits) searchUrls.add(hit.url); },
  });
  await tools.web_search!.execute!("search", { query: "topic", reason: "research" });
  const fromSearch = await tools.web_fetch!.execute!("fetch", { url: "https://example.com/result", reason: "read" });
  assert.match(String(fromSearch.details), /inside-page/);
  const fromPage = await tools.web_fetch!.execute!("fetch2", { url: "https://example.com/inside-page", reason: "read" });
  assert.match(String(fromPage.details), /paste the link in chat to let me read it/);
  assert.deepEqual(fetched, ["https://example.com/result"]);
});
