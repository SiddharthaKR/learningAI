import type { KnowledgeResult } from "./contracts.ts";

export interface Retriever {
	search(queries: string[], userId: string): Promise<KnowledgeResult[]>;
}
