import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { searchProvider, searchStatus } from "../src/server/search.ts";

const saved = { ...process.env };
const realFetch = globalThis.fetch;
afterEach(() => {
  for (const k of ["SEARCH_PROVIDER", "SEARXNG_URL", "HTTPS_PROXY", "HTTP_PROXY", "SEARCH_API_KEY"]) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
});

describe("SearXNG is called directly, not through the corporate proxy", () => {
  it("is available without any proxy configured", () => {
    process.env.SEARCH_PROVIDER = "searxng";
    process.env.SEARXNG_URL = "http://127.0.0.1:8080";
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    assert.equal(searchStatus().available, true);
  });

  it("searches via direct fetch even when HTTPS_PROXY is set", async () => {
    process.env.SEARCH_PROVIDER = "searxng";
    process.env.SEARXNG_URL = "http://127.0.0.1:8080";
    process.env.HTTPS_PROXY = "http://unreachable-proxy.invalid:3128";
    let called = "";
    globalThis.fetch = (async (url: string) => {
      called = String(url);
      return new Response(JSON.stringify({ results: [{ title: "T", url: "https://e.com/", content: "c" }] }), { status: 200 });
    }) as typeof fetch;
    const hits = await searchProvider()!.search("test", 5);
    assert.equal(called, "http://127.0.0.1:8080/search?q=test&format=json");
    assert.deepEqual(hits, [{ title: "T", url: "https://e.com/", snippet: "c" }]);
  });
});
