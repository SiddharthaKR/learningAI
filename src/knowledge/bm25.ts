import type { KnowledgeChunk } from "./contracts.ts";
import type { Retriever } from "./retriever.ts";
import type { Ranker } from "./search.ts";
import { KnowledgeSearch } from "./search.ts";
import { tokenize } from "./tokenize.ts";

const K1 = 1.2;
const B = 0.75;

/** BM25 over the given chunks; a chunk's score is its best score across the queries. */
export const bm25Ranker: Ranker = {
	rank(queries: string[], chunks: KnowledgeChunk[]): Map<string, number> {
		const scores = new Map<string, number>();
		if (!chunks.length) return scores;
		const documentFrequency = new Map<string, number>();
		let totalLength = 0;
		const documents = chunks.map((chunk) => {
			const tokens = tokenize(chunk.text);
			const frequencies = new Map<string, number>();
			for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
			for (const token of frequencies.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
			totalLength += tokens.length;
			return { chunk, frequencies, length: tokens.length };
		});
		if (!totalLength) return scores;
		const averageLength = totalLength / chunks.length;
		for (const query of queries) {
			const terms = tokenize(query);
			for (const document of documents) {
				let score = 0;
				for (const term of terms) {
					const frequency = document.frequencies.get(term) ?? 0;
					if (!frequency) continue;
					const df = documentFrequency.get(term)!;
					const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
					score += idf * frequency * (K1 + 1) / (frequency + K1 * (1 - B + B * document.length / averageLength));
				}
				if (score > 0 && score > (scores.get(document.chunk.id) ?? 0)) scores.set(document.chunk.id, score);
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
