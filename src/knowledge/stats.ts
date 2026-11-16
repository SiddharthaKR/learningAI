import type { KnowledgeSnapshot } from "./index-store.ts";

/** The audit-log fields the stats need (src/server/knowledge-audit.ts writes the full event). */
export interface KnowledgeUploadEvent { at: string; username: string; action: "add" | "delete"; documentId: string }

export interface KnowledgeStatsItem {
	id: string;
	fileName: string;
	format?: string;
	status: string;
	chunkCount: number;
	uploadedBy?: string;
	uploadedAt?: string;
}
export interface KnowledgeStats {
	totalItems: number;
	totalChunks: number;
	uploadsByDay: Array<{ day: string; count: number }>;
	items: KnowledgeStatsItem[];
}

/**
 * Pure content-library statistics for the shared store. Uploader and date come from the
 * latest "add" audit event per document (events may arrive in any order). Only documents
 * still in the snapshot count. Days are UTC; documents with no add event group as "unknown".
 */
export function computeKnowledgeStats(snapshot: KnowledgeSnapshot, events: readonly KnowledgeUploadEvent[]): KnowledgeStats {
	const chunkCounts = new Map<string, number>();
	for (const chunk of snapshot.chunks) chunkCounts.set(chunk.sourceId, (chunkCounts.get(chunk.sourceId) ?? 0) + 1);
	const uploads = new Map<string, KnowledgeUploadEvent>();
	for (const event of events) {
		if (event.action !== "add") continue;
		const known = uploads.get(event.documentId);
		if (!known || event.at > known.at) uploads.set(event.documentId, event);
	}
	const days = new Map<string, number>();
	let unknown = 0;
	const items = snapshot.documents.map((document) => {
		const upload = uploads.get(document.id);
		const parsed = upload ? new Date(upload.at) : undefined;
		if (!parsed || Number.isNaN(parsed.getTime())) unknown += 1;
		else { const day = parsed.toISOString().slice(0, 10); days.set(day, (days.get(day) ?? 0) + 1); }
		return { id: document.id, fileName: document.fileName, format: document.format, status: document.status, chunkCount: chunkCounts.get(document.id) ?? 0, uploadedBy: upload?.username, uploadedAt: upload?.at };
	});
	const uploadsByDay = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
	if (unknown) uploadsByDay.push({ day: "unknown", count: unknown });
	return { totalItems: snapshot.documents.length, totalChunks: snapshot.chunks.length, uploadsByDay, items };
}
