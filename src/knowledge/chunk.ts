import { createHash } from "node:crypto";
import type { ExtractedBlock, ExtractedDocument, KnowledgeChunk, KnowledgeCitation } from "./contracts.ts";

const MAX_POINTS = 1200;
const MIN_BOUNDARY_POINTS = 900;
const OVERLAP_POINTS = 200;
const MIN_BODY_POINTS = 400;
const TABLE_MAX_POINTS = 4000;

function canonicalCitation(citation: KnowledgeCitation): string {
	return JSON.stringify(citation, Object.keys(citation).sort());
}

function chunkEnd(points: string[], start: number, maxPoints: number, minBoundary: number): number {
	const maximum = Math.min(start + maxPoints, points.length);
	if (maximum === points.length) return maximum;
	let paragraph = 0;
	let newline = 0;
	let whitespace = 0;
	for (let end = start + minBoundary; end <= maximum; end++) {
		const last = points[end - 1]!;
		if (last === "\n" && points[end - 2] === "\n") paragraph = end;
		if (last === "\n") newline = end;
		if (/\s/u.test(last)) whitespace = end;
	}
	return paragraph || newline || whitespace || maximum;
}

/** First line of every chunk that has a section path: "§ A › B › C" + newline. */
export function sectionPrefix(section: string[] | undefined): string {
	return section?.length ? `§ ${section.join(" › ")}\n` : "";
}

/**
 * Split a table at row boundaries, repeating the header row (and a Markdown
 * separator row under it) at the top of every piece (owner, 2026-11-24), so
 * each piece keeps its column meaning. A header longer than half the budget is
 * not repeated.
 */
function splitTable(text: string, budget: number): string[] {
	const rows = text.split("\n");
	const headerRows = rows.length > 2 && /^\s*\|?\s*:?-{3,}/u.test(rows[1]!) ? 2 : 1;
	const header = rows.slice(0, headerRows).join("\n");
	const headerLength = Array.from(header).length;
	if (rows.length <= headerRows || headerLength * 2 > budget) return splitRows(rows, budget);
	return splitRows(rows.slice(headerRows), budget - headerLength - 1).map((piece) => `${header}\n${piece}`);
}

/** Split rows at row boundaries only; a single over-long row is hard-split as a last resort. */
function splitRows(rows: string[], budget: number): string[] {
	const pieces: string[] = [];
	let current: string[] = [];
	let currentLength = 0;
	const flush = () => {
		if (current.length) pieces.push(current.join("\n"));
		current = [];
		currentLength = 0;
	};
	for (const row of rows) {
		const rowPoints = Array.from(row);
		const rowLength = rowPoints.length;
		if (rowLength > budget) {
			flush();
			for (let i = 0; i < rowLength; i += budget) pieces.push(rowPoints.slice(i, i + budget).join(""));
			continue;
		}
		const added = rowLength + (current.length ? 1 : 0);
		if (currentLength + added > budget) flush();
		currentLength += rowLength + (current.length ? 1 : 0);
		current.push(row);
	}
	flush();
	return pieces;
}

export function chunkDocument(document: ExtractedDocument, sourceId: string): KnowledgeChunk[] {
	if (document.status === "no_text_layer") return [];
	const chunks: KnowledgeChunk[] = [];
	let ordinal = 0;
	const emit = (text: string, block: ExtractedBlock, citationJson: string, prefix: string) => {
		const hashed: unknown[] = [sourceId, citationJson, ordinal, text];
		if (block.section?.length) hashed.push(block.section);
		const id = createHash("sha256").update(JSON.stringify(hashed)).digest("hex");
		const chunk: KnowledgeChunk = { id, sourceId, text: prefix + text, citation: block.citation, ordinal };
		if (block.section?.length) chunk.section = [...block.section];
		chunks.push(chunk);
		ordinal++;
	};
	for (const block of document.blocks) {
		const prefix = sectionPrefix(block.section);
		const prefixLength = Array.from(prefix).length;
		const citationJson = canonicalCitation(block.citation);
		if (block.kind === "table") {
			if (!block.text.trim()) continue;
			if (Array.from(block.text).length <= TABLE_MAX_POINTS) {
				emit(block.text, block, citationJson, prefix);
				continue;
			}
			for (const piece of splitTable(block.text, Math.max(MIN_BODY_POINTS, TABLE_MAX_POINTS - prefixLength))) {
				if (piece.trim()) emit(piece, block, citationJson, prefix);
			}
			continue;
		}
		const points = Array.from(block.text);
		const maxPoints = Math.max(MIN_BODY_POINTS, MAX_POINTS - prefixLength);
		const minBoundary = Math.min(MIN_BOUNDARY_POINTS, Math.floor(maxPoints * 0.75));
		for (let start = 0; start < points.length;) {
			const end = chunkEnd(points, start, maxPoints, minBoundary);
			const text = points.slice(start, end).join("");
			if (text.trim()) emit(text, block, citationJson, prefix);
			if (end === points.length) break;
			start = Math.max(start + 1, end - OVERLAP_POINTS);
		}
	}
	return chunks;
}
