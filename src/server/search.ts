/**
 * Office web search: the SearXNG provider behind the core search port
 * (core/search.ts). SearXNG runs on this host and is called directly, not
 * through the corporate proxy; selection is by SEARCH_PROVIDER / SEARXNG_URL.
 */

import type { SearchHit, SearchProvider, SearchStatus } from "../core/search.ts";

/** The wire-callable shape the provider closes over (tests inject a stub). */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** SearXNG runs on the same host (127.0.0.1) and is called directly: it must
 *  NOT go through the corporate proxy. Only web_fetch uses the proxy. */
function directFetch(input: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}
function selectedSearchProvider(): "none" | "searxng" {
  const choice = process.env.SEARCH_PROVIDER?.trim().toLowerCase() || "none";
  if (choice !== "searxng" && choice !== "none") throw new Error("SEARCH_PROVIDER must be none or searxng");
  return choice;
}
export function searxngProvider(baseUrl: string, fetchFn: FetchLike = directFetch): SearchProvider {
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("SEARXNG_URL must be HTTP(S)");
  return { id: "searxng", async search(query: string, count: number): Promise<SearchHit[]> {
    const url = new URL("search", base.toString().endsWith("/") ? base : `${base}/`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    const response = await fetchFn(url.toString(), { method: "GET", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
    const body = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (body.results ?? []).slice(0, count).filter((hit) => typeof hit.url === "string").map((hit) => ({ title: hit.title ?? hit.url!, url: hit.url!, snippet: (hit.content ?? "").slice(0, 500) }));
  } };
}
export function searchStatus(): SearchStatus {
  try {
    const selected = selectedSearchProvider();
    if (selected === "none") return { available: false, engine: null, reason: "URL-only mode; paste a link in chat" };
    if (selected === "searxng" && !process.env.SEARXNG_URL) return { available: false, engine: null, reason: "SEARXNG_URL is required" };
    return { available: true, engine: selected, reason: `office search: ${selected}` };
  } catch (error) {
    return { available: false, engine: null, reason: error instanceof Error ? error.message : "invalid search configuration" };
  }
}
export function searchAvailable(): boolean { return searchStatus().available; }
export function searchProvider(): SearchProvider | null {
  if (!searchAvailable()) return null;
  const selected = selectedSearchProvider();
  if (selected === "searxng") return searxngProvider(process.env.SEARXNG_URL!);
  return null;
}
