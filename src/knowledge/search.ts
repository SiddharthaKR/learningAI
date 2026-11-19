import type { KnowledgeChunk, KnowledgeResult } from "./contracts.ts";
import type { Retriever } from "./retriever.ts";

export const RESULT_LIMIT = 8;
const RRF_K = 60;
const MIN_OVERLAP = 20;
const MAX_OVERLAP = 400;

/** Opaque, ranker-defined precomputed data (tokenization, term stats, vectors...). */
export type PreparedRankerData = unknown;

/**
 * Scores chunks for a set of queries. Returns chunkId -> score, only scores > 0.
 *
 * PREPARE SEAM: a search spans several stores (admin index + shared uploads + the user's personal
 * docs). A ranker with expensive per-chunk work may implement `prepare` (run ONCE per store
 * revision by the knowledge cache, cached under `name`) and `combine` (run per search, must be
 * cheap: merge the per-store pieces of exactly the stores being searched, so corpus-wide
 * statistics cover the combined set). `rank` then receives the combined data as `prepared`; it
 * must give the same answer as when called without it (`prepared` is only an optimisation).
 *
 * EMBEDDING SEAM (not implemented): an embedding ranker would implement `prepare` by loading
 * vectors from a persisted sidecar file next to the store's index.json (e.g. index.embeddings.json),
 * keyed by chunk id + model name, computed at UPLOAD time and never at search time. Chunks with no
 * vector for the configured model are simply unscored. `combine` concatenates the per-store vector
 * tables; `rank` embeds only the (short) queries and does the nearest-neighbour scoring. It is
 * appended to the `rankers` array in KnowledgeSearch and fused by RRF; nothing else changes.
 */
export interface Ranker {
	/** Cache key for this ranker's prepared data; required for `prepare` to be cached. */
	name?: string;
	prepare?(chunks: KnowledgeChunk[]): PreparedRankerData;
	combine?(parts: PreparedRankerData[]): PreparedRankerData;
	rank(queries: string[], chunks: KnowledgeChunk[], prepared?: PreparedRankerData): Map<string, number>;
}

/** One store's chunks plus a (cached) way to get a ranker's prepared data for them. */
export interface ChunkPart {
	chunks: KnowledgeChunk[];
	prepared?(ranker: Ranker): PreparedRankerData | undefined;
}

/** What a loader may return: a flat chunk list (uncached) or per-store parts (cache-aware). */
export type KnowledgeLoad = KnowledgeChunk[] | { parts: ChunkPart[] };

function preparedFor(ranker: Ranker, parts: ChunkPart[]): PreparedRankerData | undefined {
	if (!ranker.prepare || !ranker.name) return undefined;
	const pieces: PreparedRankerData[] = [];
	for (const part of parts) {
		const piece = part.prepared?.(ranker);
		if (piece === undefined) return undefined;
		pieces.push(piece);
	}
	if (ranker.combine) return ranker.combine(pieces);
	return pieces.length === 1 ? pieces[0] : undefined;
}

function byScoreThenId(a: [string, number], b: [string, number]): number {
	return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

function validateQueries(queries: string[]): string[] {
	if (!Array.isArray(queries) || queries.length < 1 || queries.length > 4) {
		throw new Error("queries must be an array of 1–4 non-empty strings");
	}
	const normalized: string[] = [];
	for (let i = 0; i < queries.length; i++) {
		const query = queries[i];
		if (typeof query !== "string" || !query.trim()) {
			throw new Error("queries must be an array of 1–4 non-empty strings");
		}
		normalized.push(query.trim());
	}
	return normalized;
}

/** Longest suffix of `earlier` (length >= MIN_OVERLAP) that is a prefix of `later`. */
function overlapLength(earlier: string, later: string): number {
	const limit = Math.min(earlier.length, later.length, MAX_OVERLAP);
	for (let length = limit; length >= MIN_OVERLAP; length--) {
		if (earlier.endsWith(later.slice(0, length))) return length;
	}
	return 0;
}

function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return newline === -1 ? text : text.slice(0, newline);
}

/** Merge chunks (reading order) into one text, dropping duplicated overlap and repeated "§ ..." lines. */
export function mergeChunkTexts(chunks: KnowledgeChunk[]): string {
	let merged = chunks[0]!.text;
	for (let i = 1; i < chunks.length; i++) {
		const previous = chunks[i - 1]!;
		const current = chunks[i]!;
		let body = current.text;
		const sameBlock =
			JSON.stringify(previous.citation) === JSON.stringify(current.citation) &&
			JSON.stringify(previous.section ?? null) === JSON.stringify(current.section ?? null);
		if (sameBlock) {
			const head = firstLine(current.text);
			if (head.startsWith("§ ") && head === firstLine(previous.text) && body.length > head.length) {
				body = body.slice(head.length + 1);
			}
			const overlap = overlapLength(previous.text, body);
			merged += overlap ? body.slice(overlap) : `\n${body}`;
		} else {
			merged += `\n${body}`;
		}
	}
	return merged;
}

interface Window {
	lo: number;
	hi: number;
	hits: KnowledgeResult[];
}

/**
 * Retrieval = rank, take top hits, then expand each hit with its reading-order neighbours.
 *
 * RANKER SLOT: with one ranker its scores are used directly. With several, scores are
 * combined by reciprocal rank fusion (k=60). An embedding ranker plugs in here later by
 * being appended to the `rankers` array; nothing else changes.
 */
export class KnowledgeSearch implements Retriever {
	constructor(
		private readonly loadChunks: (userId: string) => KnowledgeLoad | Promise<KnowledgeLoad>,
		private readonly rankers: Ranker[],
	) {}

	/** Ranking only (top hits, no neighbour expansion). */
	async rankHits(queries: string[], userId: string): Promise<{ hits: KnowledgeResult[]; chunks: KnowledgeChunk[] }> {
		const normalized = validateQueries(queries);
		const loaded = await this.loadChunks(userId);
		const parts: ChunkPart[] = Array.isArray(loaded) ? [{ chunks: loaded }] : loaded.parts;
		const chunks = Array.isArray(loaded) ? loaded : parts.length === 1 ? parts[0]!.chunks : parts.flatMap((part) => part.chunks);
		if (!chunks.length) return { hits: [], chunks };
		const prepared = this.rankers.map((ranker) => preparedFor(ranker, parts));
		const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
		let scores: Map<string, number>;
		if (this.rankers.length === 1) {
			scores = this.rankers[0]!.rank(normalized, chunks, prepared[0]);
		} else {
			scores = new Map();
			for (const [rankerIndex, ranker] of this.rankers.entries()) {
				const ordered = [...ranker.rank(normalized, chunks, prepared[rankerIndex])].filter(([, score]) => score > 0).sort(byScoreThenId);
				ordered.forEach(([id], index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + index + 1)));
			}
		}
		const hits: KnowledgeResult[] = [];
		for (const [id, score] of [...scores].filter(([, value]) => value > 0).sort(byScoreThenId).slice(0, RESULT_LIMIT)) {
			const chunk = byId.get(id);
			if (chunk) hits.push({ ...chunk, score });
		}
		return { hits, chunks };
	}

	async search(queries: string[], userId: string): Promise<KnowledgeResult[]> {
		const { hits, chunks } = await this.rankHits(queries, userId);
		return expandNeighbors(hits, chunks);
	}
}

/** One result per hit (or per group of overlapping/adjacent hit windows) with prev+hit+next text. */
export function expandNeighbors(hits: KnowledgeResult[], chunks: KnowledgeChunk[]): KnowledgeResult[] {
	const bySource = new Map<string, Map<number, KnowledgeChunk>>();
	for (const chunk of chunks) {
		if (chunk.ordinal === undefined) continue;
		let ordinals = bySource.get(chunk.sourceId);
		if (!ordinals) bySource.set(chunk.sourceId, (ordinals = new Map()));
		ordinals.set(chunk.ordinal, chunk);
	}
	// Each output sits at the rank position of its best-ranked hit.
	const slots: { rank: number; result: KnowledgeResult }[] = [];
	const windowsBySource = new Map<string, { windows: Window[]; ranks: Map<Window, number> }>();
	hits.forEach((hit, rank) => {
		if (hit.ordinal === undefined || !bySource.get(hit.sourceId)?.has(hit.ordinal)) {
			slots.push({ rank, result: hit });
			return;
		}
		const ordinals = bySource.get(hit.sourceId)!;
		const lo = ordinals.has(hit.ordinal - 1) ? hit.ordinal - 1 : hit.ordinal;
		const hi = ordinals.has(hit.ordinal + 1) ? hit.ordinal + 1 : hit.ordinal;
		let entry = windowsBySource.get(hit.sourceId);
		if (!entry) windowsBySource.set(hit.sourceId, (entry = { windows: [], ranks: new Map() }));
		const window: Window = { lo, hi, hits: [hit] };
		entry.ranks.set(window, rank);
		entry.windows.push(window);
	});
	for (const [sourceId, { windows, ranks }] of windowsBySource) {
		const ordinals = bySource.get(sourceId)!;
		windows.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
		const groups: Window[] = [];
		for (const window of windows) {
			const last = groups.at(-1);
			if (last && window.lo <= last.hi + 1) {
				last.hi = Math.max(last.hi, window.hi);
				last.hits.push(...window.hits);
				ranks.set(last, Math.min(ranks.get(last)!, ranks.get(window)!));
			} else groups.push(window);
		}
		for (const group of groups) {
			// The merged result is cited at its BEST-scoring hit (owner, 2026-11-13):
			// citing the earliest chunk mislabeled the answer with a neighbor's page.
			const best = group.hits.reduce((a, b) => (b.score > a.score ? b : a));
			const parts: KnowledgeChunk[] = [];
			for (let ordinal = group.lo; ordinal <= group.hi; ordinal++) {
				const chunk = ordinals.get(ordinal);
				if (chunk) parts.push(chunk);
			}
			const result: KnowledgeResult = { ...best, text: mergeChunkTexts(parts), score: best.score };
			if (parts.some((part) => JSON.stringify(part.citation) !== JSON.stringify(best.citation))) {
				result.passages = parts;
			}
			slots.push({ rank: ranks.get(group)!, result });
		}
	}
	return slots.sort((a, b) => a.rank - b.rank).map((slot) => slot.result);
}
