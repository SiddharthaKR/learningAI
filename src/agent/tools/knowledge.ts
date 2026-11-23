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
import type { KnowledgeSearchScope } from "../../core/contracts/chat.ts";
import type { KnowledgeResult } from "../../knowledge/contracts.ts";
import { MAX_SECTION_CHARS, type KnowledgeSectionResponse } from "../../knowledge/map-contracts.ts";

const searchKnowledgeInput = Type.Object({
	queries: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		maxItems: 4,
		description:
			"1–4 search queries. Include Japanese AND English formulations plus key terms or acronyms " +
			"so retrieval matches bilingual content. Each query is a plain search string.",
	}),
});

const openSectionInput = Type.Object({
	file: Type.String({ minLength: 1, description: "File name exactly as shown in a search citation." }),
	section: Type.Union([Type.Array(Type.String()), Type.String()], {
		description:
			"Heading path shown after § in the citation, outermost first: an array of headings, or one string with " +
			"\" › \" separators. [] reads the whole document.",
	}),
});

function normalizeSectionPath(section: string[] | string): string[] {
	const parts = (Array.isArray(section) ? section : [section]).flatMap((part) => part.split(" › "));
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export interface KnowledgeToolContext {
	/** The session owner's user ID — retrieval resolves only their personal + shared chunks. */
	ownerId: string;
	/** Search scope for the no-results hint; absent = "all". */
	scope?: KnowledgeSearchScope;
	/** The session's chat ID — for the sticky persist. */
	chatId: string;
	/** The retriever port (injected from the composition root). */
	retriever: Retriever;
	/** Atomically set knowledgeUsed on the session. Returns true if the
	 *  transition false→true was persisted. Throws on persist failure. */
	markKnowledgeUsed: (chatId: string) => boolean;
	/** open_section port (injected from the composition root): resolve a file
	 *  name + heading path among the owner's personal + shared documents.
	 *  null = not found; {ambiguous} = several documents share the name. */
	openSection: (ownerId: string, fileName: string, section: string[]) => Promise<KnowledgeSectionResponse | { ambiguous: string[] } | null>;
}

export function formatCitation(result: Pick<KnowledgeResult, "citation" | "section">): string {
	const c = result.citation;
	const path = result.section?.length ? result.section.join(" › ") : undefined;
	switch (c.format) {
		case "pdf":
			return `[${c.fileName}, page ${c.page}${path ? `, §${path}` : ""}]${c.ocr ? " (OCR, verify exact numbers)" : ""}`;
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
				"When citing retrieved content in your response, always name the source file and location. " +
					"To read a whole section when one hit is not enough, call open_section with a result's file name and its § path.",
			parameters: searchKnowledgeInput,
			execute: serverExecute("search_knowledge", searchKnowledgeInput, async ({ queries }): Promise<string | object> => {
				// Runtime backstop: the schema enforces 1–4 non-empty strings,
				// but the retriever also validates (defense in depth).
				const results = await ctx.retriever.search(queries, ctx.ownerId);
				if (!results.length) {
					const hint = ctx.scope === "shared" ? " (searching shared knowledge only)"
						: ctx.scope === "personal" ? " (searching your personal documents only)" : "";
					return `No matching documents found for your queries${hint}. Try different terms or phrasing.`;
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
				const formatted = results.map((result, index) => {
					const passages = result.passages ?? [result];
					const text = passages.map((passage) => `${formatCitation(passage)}\n${passage.text}`).join("\n\n");
					return `${index + 1}. ${text}`;
				});
				return formatted.join("\n\n---\n\n");
			}),
		},
		open_section: {
			name: "open_section",
			label: "open_section",
			description:
				"Read a WHOLE section of one office document (shared or personal) when a single search_knowledge hit is not enough. " +
				"`file` is the file name exactly as shown in a search citation. `section` is the heading path shown after § in the " +
				"citation, outermost heading first, as an array (e.g. [\"Chapter 2\", \"Setup\"]); it may also be one string with " +
				"\" › \" separators exactly as the citation shows it (\"Chapter 2 › Setup\"). An empty array reads the whole document. " +
				"Output is capped at 12,000 characters; open a deeper subsection for the rest.",
			parameters: openSectionInput,
			execute: serverExecute("open_section", openSectionInput, async ({ file, section }): Promise<string | object> => {
				const path = normalizeSectionPath(section);
				const found = await ctx.openSection(ctx.ownerId, file, path);
				if (!found) {
					return `No section found for file "${file}"${path.length ? ` at §${path.join(" › ")}` : ""}. ` +
						"Use search_knowledge first and pass a result's file name and § path exactly as cited.";
				}
				if ("ambiguous" in found) {
					return `Several documents match "${file}": ${found.ambiguous.join("; ")}. Cannot choose between them; tell the user the file name is ambiguous.`;
				}
				// STICKY PERSIST: same rule as search_knowledge — before any content.
				try {
					ctx.markKnowledgeUsed(ctx.chatId);
				} catch (err) {
					console.error(`[open_section] sticky persist failed for chat ${ctx.chatId}:`, err);
					return "Knowledge retrieval succeeded but the session could not be updated. Please try again.";
				}
				const header = found.citation
					? formatCitation({ id: "", sourceId: found.documentId, text: "", score: 0, citation: found.citation, section: found.path } as KnowledgeResult)
					: `[${found.fileName}${found.path.length ? `, §${found.path.join(" › ")}` : ""}]`;
				return `${header}\n${found.text}` +
					(found.truncated ? `\n\n[Section truncated at ${MAX_SECTION_CHARS.toLocaleString("en-US")} characters — open a deeper subsection for the rest.]` : "");
			}),
		},
	};
}
