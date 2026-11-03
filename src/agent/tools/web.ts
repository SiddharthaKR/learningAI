import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
// The search-hit shape lives in the core port since the search wave
// (2026-09-20); this alias keeps callers churn-free.
import type { SearchHit as WebSearchResult, SearchProvider } from "../../core/search.ts";
export type { WebSearchResult };
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { restrictedWebGet, type RestrictedFetchDeps } from "./restricted-web-fetch.ts";

/**
 * Server-side web tools for the researcher sub-agent — a minimal port of the
 * pi extensions (~/.pi/agent/extensions/web-search + web-fetch):
 *
 *   web_search(query, count?) → {title, url, snippet}[]   (injected search port)
 *   web_fetch(url)            ? readable markdown text via a validated proxy fetch
 *
 * SEARCH REWIRING (search port wave, 2026-09-20): the Google CSE backend is
 * retired — web_search now runs on the injected search port (core/search.ts).
 * The live adapter (Tavily/Brave — server/search.ts) arrives as a DEPENDENCY
 * (import law: this tool depends on the core port, never server code). NO
 * silent fallback (owner decision): provider absent → search is honestly
 * unavailable, and the composition root drops the research dispatch tool on
 * the same signal (the jobTools seam, src/agent/tools/jobs.ts).
 *
 * Tool contract: NEVER throw into the agent loop — missing provider and
 * every failure path return a clear error STRING as the tool output, so the
 * researcher can adapt (or report) instead of crashing.
 */

// ── web_search ───────────────────────────────────────────────────────────────
// (WebSearchResult is the core SearchHit, re-exported above.)

// ── web_fetch ────────────────────────────────────────────────────────────────

/** Keep the researcher's context sane — long pages truncate with a marker. */
const MAX_CONTENT_CHARS = 40_000;
const MIN_USEFUL_CONTENT = 200;

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function truncate(text: string): string {
	if (text.length <= MAX_CONTENT_CHARS) return text;
	return `${text.slice(0, MAX_CONTENT_CHARS)}\n\n[Truncated at ${MAX_CONTENT_CHARS} characters]`;
}

function htmlToMarkdown(html: string): { title: string; content: string } | null {
	const { document } = parseHTML(html);
	const article = new Readability(document as unknown as Document).parse();
	if (!article?.content) return null;
	const markdown = turndown.turndown(article.content);
	if (markdown.trim().length < MIN_USEFUL_CONTENT) return null;
	return { title: article.title ?? "", content: markdown };
}

async function fetchAndExtract(url: string, deps: RestrictedFetchDeps): Promise<string> {
	const resp = await restrictedWebGet(url, deps);
	const sourceLine = `Source: ${resp.url} (HTTP ${resp.status})`;
	if (resp.contentType === "application/pdf") {
		return "web_fetch: this URL is a PDF document; PDF downloads are unavailable.";
	}
	const text = new TextDecoder().decode(resp.bytes);
	if (resp.contentType === "text/plain") return `${sourceLine}\n\n${truncate(text)}`;
	const extracted = htmlToMarkdown(text);
	if (extracted) {
		const header = extracted.title ? `# ${extracted.title}\n\n${sourceLine}\n\n---\n\n` : `${sourceLine}\n\n---\n\n`;
		return header + truncate(extracted.content);
	}
	throw new Error("Could not extract readable HTML content");
}

const webSearchInput = Type.Object({
	query: Type.String({ description: "The search query (a normal search string, phrases included)" }),
	reason: Type.String({ description: "Why this search is needed for the current task" }),
	count: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 10, description: "Number of results (default 5, max 10)" }),
	),
});

const webFetchInput = Type.Object({
	url: Type.String({ description: "The URL to fetch" }),
	reason: Type.String({ description: "Why this page is needed for the current task" }),
});

export type WebApproval = (tool: "web_search" | "web_fetch", value: string, reason: string) => Promise<string | null>;

export interface WebToolPolicy {
	/** Checked again at execution so turning Web off stops an in-flight researcher. */
	enabled?: () => boolean;
	/** Only URLs supplied by the learner or a search result in this session qualify. */
	canFetch?: (url: string) => boolean;
	/** Search results are authorization sources; fetched-page links never are. */
	onSearchResults?: (results: readonly WebSearchResult[]) => void;
}

export function createWebTools(search: () => SearchProvider | null, fetchDeps: RestrictedFetchDeps = {}, approve?: WebApproval, policy: WebToolPolicy = {}): Record<string, AgentTool<any>> {
	return {
		...(search() ? { web_search: {
			name: "web_search",
			label: "web_search",
			description: "Search the web. One search per call — use one call per search angle. " +
				"Returns an array of results with title, url, and snippet.",
			parameters: webSearchInput,
			execute: serverExecute("web_search", webSearchInput, async ({ query, count, reason }): Promise<WebSearchResult[] | string> => {
				if (policy.enabled && !policy.enabled()) return "Web research is off for this session";
				const provider = search();
				if (!provider) {
					return (
						"web_search is not available: no search engine is configured. " +
						"Report in your brief that web search is unavailable."
					);
				}
				try {
					if (approve && await approve("web_search", query, reason) === null) return "user denied";
					if (policy.enabled && !policy.enabled()) return "Web research is off for this session";
					const results = await provider.search(query, count ?? 5);
					policy.onSearchResults?.(results);
					return results;
				} catch (err) {
					return `web_search failed: ${err instanceof Error ? err.message : String(err)}`;
				}
			}),
		} } : {}),

		web_fetch: {
			name: "web_fetch",
			label: "web_fetch",
			description:
				"Fetch a web page and extract its readable content as markdown (Readability). " +
				"Handles HTML and plain text. PDF downloads are unavailable.",
			parameters: webFetchInput,
			execute: serverExecute("web_fetch", webFetchInput, async ({ url, reason }): Promise<string> => {
				try {
					if (policy.enabled && !policy.enabled()) return "Web research is off for this session";
					if (policy.canFetch && !policy.canFetch(url)) return "paste the link in chat to let me read it";
					if (approve && await approve("web_fetch", url, reason) === null) return "user denied";
					if (policy.enabled && !policy.enabled()) return "Web research is off for this session";
					if (policy.canFetch && !policy.canFetch(url)) return "paste the link in chat to let me read it";
					return await fetchAndExtract(url, fetchDeps);
				} catch (err) {
					const host = (() => { try { return new URL(url).hostname; } catch { return "invalid URL"; } })();
					return `web_fetch failed for ${host}: ${err instanceof Error ? err.message : String(err)}`;
				}
			}),
		},
	};
}

/** The provider-less backstop (tests pin the shape with it; the runner
 *  always injects the real seam — an absent seam reads as unavailable,
 *  never a crash and never a silent alternative engine). */
export const webTools = createWebTools(() => null);

