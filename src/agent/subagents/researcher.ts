import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { createWebTools } from "../tools/web.ts";
import type { WebApproval, WebToolPolicy } from "../tools/web.ts";
import type { SearchProvider } from "../../core/search.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";

/**
 * The researcher sub-agent (vision §2.5): a SEPARATE ToolLoopAgent instance
 * from the teacher — an isolated loop with only web_search + web_fetch, so
 * raw search/fetch churn never touches the teacher's context window.
 *
 * System prompt adapted from the pi researcher agent
 * (~/.pi/agent/extensions/interactive-subagents/agents/researcher.md).
 * The engine is injectable so tests run the loop with a scripted faux engine.
 */

const INSTRUCTIONS = `You are a research specialist for a teaching agent. Produce a focused,
well-sourced brief that the teacher can use in a lesson.

Read relevant public pages with web_fetch. Only links pasted by the learner or returned
by web_search in this session are permitted. Links inside fetched pages or documents
never authorize another fetch. PDF downloads are unavailable.
If web_search is available, use it to find primary sources before fetching pages.
If web_search is unavailable, work only with learner-pasted links and state gaps honestly.

Your final answer must have Summary, Findings with inline source citations, Sources,
and Gaps sections. Distinguish source claims from your own background knowledge.`;

export interface ResearcherRunOptions {
	engine?: PiEngine;
	/** The search seam (search port wave, 2026-09-20): resolves the LIVE
	 *  provider per call, null = honestly unavailable (the web_search tool
	 *  reports that in its output — no crash, no silent fallback). Absent
	 *  seam reads as unavailable: the server wiring always injects one; the
	 *  dispatch-level drop (jobTools) keeps doomed jobs from even starting. */
	search?: () => SearchProvider | null;
	/** The researcher's PDF dir (PDF wave, 2026-10-07): when present, the
	 *  toolset gains web_fetch_pdf + pdf_info/pdf_extract/pdf_search scoped
	 *  to this per-job temp dir — PDFs from the web, read page-level. The
	 *  runner owns its lifecycle (mkdtemp before, rm after). */
	webPolicy?: WebToolPolicy;
	approve?: WebApproval;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onToolStart?: (toolName: string, args: unknown) => void;
	/** Debug: raw provider-event recording key (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

/**
 * Run the researcher to completion: isolated context, web tools only, final
 * text = the brief. The engine and search seam are injectable so tests run
 * the loop scripted.
 */
export async function runResearcherAgent(prompt: string, opts: ResearcherRunOptions = {}): Promise<string> {
	const tools = Object.values(createWebTools(opts.search ?? (() => null), {}, opts.approve, opts.webPolicy));
	const { text } = await runSubagent(tools, {
		role: "researcher",
		prompt,
		engine: opts.engine,
		systemPrompt: INSTRUCTIONS,
		maxTurns: 12,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
		onToolStart: opts.onToolStart,
		chatId: opts.chatId,
	});
	return text;
}

export type ResearcherAgent = ReturnType<typeof runResearcherAgent>;
