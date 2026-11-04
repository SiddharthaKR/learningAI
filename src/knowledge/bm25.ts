import type { KnowledgeChunk, KnowledgeResult } from "./contracts.ts";
import type { Retriever } from "./retriever.ts";
import { tokenize } from "./tokenize.ts";

const K1 = 1.2;
const B = 0.75;
const RESULT_LIMIT = 8;

export class Bm25Retriever implements Retriever {
	constructor(private readonly loadChunks: (userId: string) => KnowledgeChunk[] | Promise<KnowledgeChunk[]>) {}

	async search(queries: string[], userId: string): Promise<KnowledgeResult[]> {
		if (!Array.isArray(queries) || queries.length < 1 || queries.length > 4) {
			throw new Error("queries must be an array of 1–4 non-empty strings");
		}
		const normalizedQueries: string[] = [];
		for (const query of queries) {
			if (typeof query !== "string" || !query.trim()) {
				throw new Error("queries must be an array of 1–4 non-empty strings");
			}
			normalizedQueries.push(query.trim());
		}

		const chunks = await this.loadChunks(userId);
		if (!chunks.length) return [];
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
		if (!totalLength) return [];
		const averageLength = totalLength / chunks.length;
		const merged = new Map<string, KnowledgeResult>();
		for (const query of normalizedQueries) {
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
				if (score > 0 && score > (merged.get(document.chunk.id)?.score ?? 0)) {
					merged.set(document.chunk.id, { ...document.chunk, score });
				}
			}
		}
		return [...merged.values()].sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)).slice(0, RESULT_LIMIT);
	}
}
