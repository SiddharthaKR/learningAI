import type { KnowledgeChunk } from "./contracts.ts";
import type { Retriever } from "./retriever.ts";
import type { PreparedRankerData, Ranker } from "./search.ts";
import { KnowledgeSearch } from "./search.ts";
import { tokenize } from "./tokenize.ts";

const K1 = 1.2;
const B = 0.75;

/** Per-store piece: per-chunk term frequencies + lengths, and this store's document frequencies. Cached per store revision. */
interface Bm25Part {
	ids: string[];
	frequencies: Map<string, number>[];
	lengths: number[];
	documentFrequency: Map<string, number>;
	totalLength: number;
}

/** What rank() consumes: the parts of every store actually searched; corpus stats are derived over their union. */
interface Bm25Corpus {
	parts: Bm25Part[];
	count: number;
	totalLength: number;
}

function preparePart(chunks: KnowledgeChunk[]): Bm25Part {
	const part: Bm25Part = { ids: [], frequencies: [], lengths: [], documentFrequency: new Map(), totalLength: 0 };
	for (const chunk of chunks) {
		const tokens = tokenize(chunk.text);
		const frequencies = new Map<string, number>();
		for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
		for (const token of frequencies.keys()) part.documentFrequency.set(token, (part.documentFrequency.get(token) ?? 0) + 1);
		part.totalLength += tokens.length;
		part.ids.push(chunk.id);
		part.frequencies.push(frequencies);
		part.lengths.push(tokens.length);
	}
	return part;
}

function combineParts(parts: Bm25Part[]): Bm25Corpus {
	let count = 0;
	let totalLength = 0;
	for (const part of parts) { count += part.ids.length; totalLength += part.totalLength; }
	return { parts, count, totalLength };
}

/** BM25 over the given chunks; a chunk's score is its best score across the queries. */
export const bm25Ranker: Ranker = {
	name: "bm25",
	prepare: (chunks) => preparePart(chunks),
	// Cheap per-search step: no tokenizing; document frequencies stay per part and are summed per query term.
	combine: (parts) => combineParts(parts as Bm25Part[]),
	rank(queries: string[], chunks: KnowledgeChunk[], prepared?: PreparedRankerData): Map<string, number> {
		const scores = new Map<string, number>();
		const corpus = (prepared as Bm25Corpus | undefined) ?? combineParts([preparePart(chunks)]);
		if (!corpus.count || !corpus.totalLength) return scores;
		const averageLength = corpus.totalLength / corpus.count;
		const idfCache = new Map<string, number>();
		const idfOf = (term: string): number => {
			let idf = idfCache.get(term);
			if (idf === undefined) {
				let df = 0;
				for (const part of corpus.parts) df += part.documentFrequency.get(term) ?? 0;
				idf = Math.log(1 + (corpus.count - df + 0.5) / (df + 0.5));
				idfCache.set(term, idf);
			}
			return idf;
		};
		for (const query of queries) {
			const terms = tokenize(query);
			for (const part of corpus.parts) {
				for (let index = 0; index < part.ids.length; index++) {
					const frequencies = part.frequencies[index]!;
					const length = part.lengths[index]!;
					let score = 0;
					for (const term of terms) {
						const frequency = frequencies.get(term) ?? 0;
						if (!frequency) continue;
						score += idfOf(term) * frequency * (K1 + 1) / (frequency + K1 * (1 - B + B * length / averageLength));
					}
					const id = part.ids[index]!;
					if (score > 0 && score > (scores.get(id) ?? 0)) scores.set(id, score);
				}
			}
		}
		return scores;
	},
};

/** Compatibility wrapper: BM25-only KnowledgeSearch. */
export class Bm25Retriever implements Retriever {
	private readonly inner: KnowledgeSearch;
	constructor(loadChunks: (userId: string) => KnowledgeChunk[] | Promise<KnowledgeChunk[]>) {
		this.inner = new KnowledgeSearch(loadChunks, [bm25Ranker]);
	}
	search(queries: string[], userId: string) {
		return this.inner.search(queries, userId);
	}
}
