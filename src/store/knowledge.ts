import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { readKnowledgeSnapshot, writeKnowledgeSnapshotAtomic, type KnowledgeSnapshot, type KnowledgeDocumentRecord } from "../knowledge/index-store.ts";
import type { KnowledgeChunk } from "../knowledge/contracts.ts";
import { indexKnowledgeDocument } from "../knowledge/service.ts";
import { validateKnowledgeUpload } from "../knowledge/upload.ts";
import { writeKnowledgeVault } from "../knowledge/vault.ts";

// All route instances for an owner share one queue. Failed operations release it.
const mutations = new Map<string, Promise<unknown>>();
function serialized<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutations.get(root) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  mutations.set(root, current);
  void current.finally(() => { if (mutations.get(root) === current) mutations.delete(root); }).catch(() => {});
  return current;
}

export function createKnowledgeStore(root: string, beforePublish: () => void) {
	const indexFile = path.join(root, "knowledge", "index.json");
	const sourceDirectory = path.join(root, "knowledge", "documents");
	const refreshVault = async (snapshot: KnowledgeSnapshot): Promise<void> => {
		try { await writeKnowledgeVault(root, snapshot); }
		catch (error) { console.error("knowledge vault rebuild failed", error); }
	};
	return {
		/** Index file path; a function so the checked-store proxy re-verifies the owner on every call. */
		indexFile: () => indexFile,
		readSnapshot: () => readKnowledgeSnapshot(indexFile),
		writeSnapshot: (snapshot: KnowledgeSnapshot) => writeKnowledgeSnapshotAtomic(indexFile, snapshot, beforePublish),
		/** The stored copy of these exact bytes, with its chunks, if this owner already has it. */
		findByContent: async (data: Uint8Array): Promise<{ document: KnowledgeDocumentRecord; chunks: KnowledgeChunk[] } | null> => {
			const snapshot = await readKnowledgeSnapshot(indexFile);
			const contentHash = createHash("sha256").update(data).digest("hex");
			const document = snapshot.documents.find((item) => item.contentHash === contentHash);
			return document ? { document, chunks: snapshot.chunks.filter((chunk) => chunk.sourceId === document.id) } : null;
		},
		/**
		 * `index` (optional) replaces the default text-only indexing — the route passes its
		 * memoized vision-aware indexer so one upload is extracted (and its pictures
		 * described) once. It is not called when these bytes are already stored.
		 */
		uploadDocument: async ({ fileName, data, contentType, index }: { fileName: string; data: Uint8Array; contentType?: string; index?: () => Promise<{ document: KnowledgeDocumentRecord; chunks: KnowledgeChunk[] }> }): Promise<KnowledgeDocumentRecord> => {
			validateKnowledgeUpload(fileName, data.byteLength, contentType);
			return serialized(root, async () => {
				beforePublish();
				const snapshot = await readKnowledgeSnapshot(indexFile);
				const contentHash = createHash("sha256").update(data).digest("hex");
const existing = snapshot.documents.find((document) => document.contentHash === contentHash);
				if (existing) return existing;
				const indexed = index ? await index() : await indexKnowledgeDocument({ fileName, data });
				const document = { ...indexed.document, contentHash };
				const sourceFile = path.join(sourceDirectory, document.id);
				const temporary = path.join(sourceDirectory, `.${randomUUID()}.tmp`);
				beforePublish();
				await mkdir(sourceDirectory, { recursive: true });
				let published = false;
				try {
					await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
					beforePublish();
					renameSync(temporary, sourceFile);
					published = true;
					const next = { ...snapshot, generatedAt: new Date().toISOString(), documents: [...snapshot.documents, document], chunks: [...snapshot.chunks, ...indexed.chunks] };
						await writeKnowledgeSnapshotAtomic(indexFile, next, beforePublish);
						await refreshVault(next);
					return document;
				} catch (error) {
					if (published) await unlink(sourceFile).catch((cleanup: NodeJS.ErrnoException) => { if (cleanup.code !== "ENOENT") throw cleanup; });
					throw error;
				} finally {
					await unlink(temporary).catch((cleanup: NodeJS.ErrnoException) => { if (cleanup.code !== "ENOENT") throw cleanup; });
				}
			});
		},
		deleteDocument: (id: string): Promise<boolean> => serialized(root, async () => {
			beforePublish();
			const snapshot = await readKnowledgeSnapshot(indexFile);
if (!snapshot.documents.some((document) => document.id === id)) return false;
			const next = { ...snapshot, generatedAt: new Date().toISOString(), documents: snapshot.documents.filter((document) => document.id !== id), chunks: snapshot.chunks.filter((chunk) => chunk.sourceId !== id) };
			await writeKnowledgeSnapshotAtomic(indexFile, next, beforePublish);
			await unlink(path.join(sourceDirectory, id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
			await refreshVault(next);
			return true;
		}),
	};
}
