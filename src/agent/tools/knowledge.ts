/**
 * THE KNOWLEDGE TOOL (Task 6B, office-knowledge plan): `search_knowledge`
 * retrieves bilingual chunks from the shared + personal indexes for the
 * session's owner, with exact citations. Registered ONLY when the session's
 * officeKnowledgeEnabled flag is ON; the tool is never in the registry
 * while Knowledge is OFF.
 *
 * The tool accepts 1–4 queries (the prompt instructs the agent to include
 * Japanese and English formulations plus key terms/acronyms). It searches
 * through the injected Retriever port — never importing server stores or
 * the BM25 implementation directly.
 *
 * STICKY USE (Task 6A contract): the first successful non-empty retrieval
 * atomically sets `knowledgeUsed` on the session BEFORE returning chunks
 * to the model. A failed sticky persist withholds chunks — the approval
 * rule (web-policy.ts) depends on it.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { Retriever } from "../../knowledge/retriever.ts";
import type { KnowledgeResult } from "../../knowledge/contracts.ts";

const searchKnowledgeInput = Type.Object({
	queries: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		maxItems: 4,
		description:
			"1–4 search queries. Include Japanese AND English formulations plus key terms or acronyms " +
			"so retrieval matches bilingual content. Each query is a plain search string.",
	}),
});

export interface KnowledgeToolContext {
	/** The session owner's user ID — retrieval resolves only their personal + shared chunks. */
	ownerId: string;
	/** The session's chat ID — for the sticky persist. */
	chatId: string;
	/** The retriever port (injected from the composition root). */
	retriever: Retriever;
	/** Atomically set knowledgeUsed on the session. Returns true if the
	 *  transition false→true was persisted. Throws on persist failure. */
	markKnowledgeUsed: (chatId: string) => boolean;
}

export function formatCitation(result: KnowledgeResult): string {
	const c = result.citation;
	const path = result.section?.length ? result.section.join(" › ") : undefined;
	switch (c.format) {
		case "pdf":
			return `[${c.fileName}, page ${c.page}${path ? `, §${path}` : ""}]${c.ocr ? " (OCR)" : ""}`;
		case "pptx":
			return `[${c.fileName}, slide ${c.slide}${c.title ? `: ${c.title}` : ""}${path ? `, §${path}` : ""}]`;
		case "docx": {
			const where = path ?? c.heading;
			return `[${c.fileName}${where ? `, §${where}` : ""}, ¶${c.paragraph}]`;
		}
		case "md":
		case "txt": {
			const where = path ?? c.heading;
			return `[${c.fileName}${where ? `, §${where}` : ""}, lines ${c.lineStart}–${c.lineEnd}]`;
		}
	}
}

export function createKnowledgeTool(ctx: KnowledgeToolContext): Record<string, AgentTool<any>> {
	return {
		search_knowledge: {
			name: "search_knowledge",
			label: "search_knowledge",
			description:
				"Search the owner's office documents (shared and personal) by keyword. Returns up to 8 relevant text " +
				"chunks with exact citations (filename, page/slide/heading/paragraph/line). Include Japanese AND English " +
				"formulations plus key terms or acronyms in your queries so bilingual documents are found. " +
				"When citing retrieved content in your response, always name the source file and location.",
			parameters: searchKnowledgeInput,
			execute: serverExecute("search_knowledge", searchKnowledgeInput, async ({ queries }): Promise<string | object> => {
				// Runtime backstop: the schema enforces 1–4 non-empty strings,
				// but the retriever also validates (defense in depth).
				const results = await ctx.retriever.search(queries, ctx.ownerId);
				if (!results.length) {
					return "No matching documents found for your queries. Try different terms or phrasing.";
				}
				// STICKY PERSIST: set knowledgeUsed BEFORE returning chunks.
				// A persist failure withholds the chunks — the web approval
				// rule depends on this flag being durable.
				try {
					ctx.markKnowledgeUsed(ctx.chatId);
				} catch (err) {
					console.error(`[search_knowledge] sticky persist failed for chat ${ctx.chatId}:`, err);
					return "Knowledge retrieval succeeded but the session could not be updated. Please try again.";
				}
				// Format results with inline citations.
				const formatted = results.map(
					(r, i) => `${i + 1}. ${formatCitation(r)}\n${r.text}`,
				);
				return formatted.join("\n\n---\n\n");
			}),
		},
	};
}
