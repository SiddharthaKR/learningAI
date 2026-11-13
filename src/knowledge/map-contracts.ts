/**
 * THE KNOWLEDGE MAP CONTRACT (owner-approved plan, 2026-11-13): a
 * structure graph of uploaded documents built from stored section paths —
 * no LLM. Separate from the learning graph. Types only; shared by the
 * server (map builder, API routes, open_section tool) and the client
 * (Knowledge page Map tab).
 */
import type { KnowledgeCitation } from "./contracts.ts";

/** Which store a document lives in. "personal" is always the caller's own. */
export type KnowledgeScope = "shared" | "personal";

export interface KnowledgeMapNode {
	/** Stable id: `${scope}:${documentId}` for documents,
	 *  `${scope}:${documentId}:${path.join("\u001f")}` for sections. */
	id: string;
	kind: "document" | "section";
	scope: KnowledgeScope;
	documentId: string;
	fileName: string;
	/** Display label: the file name (document) or the last path segment. */
	label: string;
	/** Full heading path, outermost first; [] for a document node. */
	path: string[];
	/** Number of chunks under this node (including descendants). */
	chunkCount: number;
	/** Citation of the first chunk under this node (page/slide/etc.), if any. */
	citation?: KnowledgeCitation;
}

export interface KnowledgeMapEdge {
	/** Parent node id (document or outer section). */
	from: string;
	/** Child node id. */
	to: string;
}

/** GET /api/knowledge/map */
export interface KnowledgeMapResponse {
	nodes: KnowledgeMapNode[];
	edges: KnowledgeMapEdge[];
}

/** GET /api/knowledge/section?scope=&doc=&path= (path = JSON array of strings,
 *  URL-encoded; [] = whole document). 404 {error:"not_found"} when absent. */
export interface KnowledgeSectionResponse {
	scope: KnowledgeScope;
	documentId: string;
	fileName: string;
	path: string[];
	/** Section text in reading order, overlap removed, capped at 12,000 chars. */
	text: string;
	truncated: boolean;
	citation?: KnowledgeCitation;
}

/** Max characters returned for one section (API and open_section tool). */
export const MAX_SECTION_CHARS = 12_000;
