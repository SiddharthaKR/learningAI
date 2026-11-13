import type { KnowledgeChunk } from "./contracts.ts";
import type { KnowledgeSnapshot } from "./index-store.ts";
import { MAX_SECTION_CHARS, type KnowledgeMapEdge, type KnowledgeMapNode, type KnowledgeMapResponse, type KnowledgeScope, type KnowledgeSectionResponse } from "./map-contracts.ts";
import { mergeChunkTexts } from "./search.ts";

const SEP = "\u001f";

export function documentNodeId(scope: KnowledgeScope, documentId: string): string {
	return `${scope}:${documentId}`;
}
export function sectionNodeId(scope: KnowledgeScope, documentId: string, path: string[]): string {
	return path.length === 0 ? documentNodeId(scope, documentId) : `${scope}:${documentId}:${path.join(SEP)}`;
}

/** Chunks of one document in reading order (ordinal; snapshot order when absent). */
function readingOrder(snapshot: KnowledgeSnapshot, documentId: string): KnowledgeChunk[] {
	return snapshot.chunks
		.map((chunk, index) => ({ chunk, index }))
		.filter(({ chunk }) => chunk.sourceId === documentId)
		.sort((a, b) => (a.chunk.ordinal ?? a.index) - (b.chunk.ordinal ?? b.index) || a.index - b.index)
		.map(({ chunk }) => chunk);
}

function startsWith(section: string[] | undefined, path: string[]): boolean {
	if (!section || section.length < path.length) return false;
	return path.every((segment, i) => section[i] === segment);
}

/** Structure graph of ready documents from stored section paths. Pure. */
export function buildKnowledgeMap(snapshot: KnowledgeSnapshot, scope: KnowledgeScope): KnowledgeMapResponse {
	const nodes: KnowledgeMapNode[] = [];
	const edges: KnowledgeMapEdge[] = [];
	for (const document of snapshot.documents) {
		if (document.status !== "ready") continue;
		const chunks = readingOrder(snapshot, document.id);
		const documentNode: KnowledgeMapNode = {
			id: documentNodeId(scope, document.id), kind: "document", scope, documentId: document.id,
			fileName: document.fileName, label: document.fileName, path: [], chunkCount: chunks.length,
			...(chunks[0] ? { citation: chunks[0].citation } : {}),
		};
		nodes.push(documentNode);
		const byId = new Map<string, KnowledgeMapNode>();
		for (const chunk of chunks) {
			const section = chunk.section;
			if (!section || section.length === 0) continue;
			for (let depth = 1; depth <= section.length; depth++) {
				const path = section.slice(0, depth);
				const id = sectionNodeId(scope, document.id, path);
				let node = byId.get(id);
				if (!node) {
					node = { id, kind: "section", scope, documentId: document.id, fileName: document.fileName, label: path[depth - 1]!, path, chunkCount: 0, citation: chunk.citation };
					byId.set(id, node);
					nodes.push(node);
					edges.push({ from: depth === 1 ? documentNode.id : sectionNodeId(scope, document.id, path.slice(0, -1)), to: id });
				}
				node.chunkCount += 1;
			}
		}
	}
	return { nodes, edges };
}

/** Text of a section (path [] = whole document), or null when nothing matches. */
export function sectionText(snapshot: KnowledgeSnapshot, scope: KnowledgeScope, documentId: string, path: string[]): KnowledgeSectionResponse | null {
	const document = snapshot.documents.find((candidate) => candidate.id === documentId && candidate.status === "ready");
	if (!document) return null;
	const chunks = readingOrder(snapshot, documentId).filter((chunk) => path.length === 0 || startsWith(chunk.section, path));
	if (chunks.length === 0) return null;
	const merged = mergeChunkTexts(chunks);
	const truncated = merged.length > MAX_SECTION_CHARS;
	return {
		scope, documentId, fileName: document.fileName, path,
		text: truncated ? merged.slice(0, MAX_SECTION_CHARS) : merged,
		truncated,
		citation: chunks[0]!.citation,
	};
}
