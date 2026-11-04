import { createHash } from "node:crypto";
import type { ExtractedDocument, KnowledgeChunk, KnowledgeCitation } from "./contracts.ts";

const MAX_POINTS = 1200;
const MIN_BOUNDARY_POINTS = 900;
const OVERLAP_POINTS = 200;

function canonicalCitation(citation: KnowledgeCitation): string {
	return JSON.stringify(citation, Object.keys(citation).sort());
}

function chunkEnd(points: string[], start: number): number {
	const maximum = Math.min(start + MAX_POINTS, points.length);
	if (maximum === points.length) return maximum;
	let paragraph = 0;
	let newline = 0;
	let whitespace = 0;
	for (let end = start + MIN_BOUNDARY_POINTS; end <= maximum; end++) {
		const last = points[end - 1]!;
		if (last === "\n" && points[end - 2] === "\n") paragraph = end;
		if (last === "\n") newline = end;
		if (/\s/u.test(last)) whitespace = end;
	}
	return paragraph || newline || whitespace || maximum;
}

export function chunkDocument(document: ExtractedDocument, sourceId: string): KnowledgeChunk[] {
	if (document.status === "no_text_layer") return [];
	const chunks: KnowledgeChunk[] = [];
	let ordinal = 0;
	for (const block of document.blocks) {
		const points = Array.from(block.text);
		const citationJson = canonicalCitation(block.citation);
		for (let start = 0; start < points.length;) {
			const end = chunkEnd(points, start);
			const text = points.slice(start, end).join("");
			if (text.trim()) {
				const id = createHash("sha256").update(JSON.stringify([sourceId, citationJson, ordinal, text])).digest("hex");
				chunks.push({ id, sourceId, text, citation: block.citation });
				ordinal++;
			}
			if (end === points.length) break;
			start = Math.max(start + 1, end - OVERLAP_POINTS);
		}
	}
	return chunks;
}
