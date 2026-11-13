import { createHash } from "node:crypto";
import type { KnowledgeChunk, KnowledgeFormat } from "./contracts.ts";
import { chunkDocument } from "./chunk.ts";
import { extractDocument } from "./extract.ts";
import { normalizeKnowledgeFileName, readKnowledgeSnapshot, validateKnowledgeSnapshot, type KnowledgeDocumentRecord, type KnowledgeSnapshot } from "./index-store.ts";
import { describeImages, type VisionConfig } from "./vision-job.ts";

function acceptedFormat(fileName: string): KnowledgeFormat | undefined {
	const extension = /\.([^.\/]+)$/u.exec(fileName)?.[1]?.toLowerCase();
	return ["pdf", "pptx", "docx", "md", "txt"].includes(extension ?? "") ? extension as KnowledgeFormat : undefined;
}

/** No bytes are available to hash after a read failure; use a distinct stable identity. */
export function unreadableKnowledgeDocument(fileName: string): KnowledgeDocumentRecord {
	fileName = normalizeKnowledgeFileName(fileName);
	const id = createHash("sha256").update(JSON.stringify([fileName, "source_read_failure"])).digest("hex");
	const format = acceptedFormat(fileName);
	return { id, fileName, ...(format ? { format } : {}), status: "rejected", error: "Document could not be read. Check that the source file exists and is readable." };
}

export async function indexKnowledgeDocument({ fileName, data, visionConfig }: { fileName: string; data: Uint8Array; visionConfig?: VisionConfig }): Promise<{ document: KnowledgeDocumentRecord; chunks: KnowledgeChunk[] }> {
	fileName = normalizeKnowledgeFileName(fileName);
	const contentHash = createHash("sha256").update(data).digest("hex");
	const id = createHash("sha256").update(JSON.stringify([fileName, contentHash])).digest("hex");
	const format = acceptedFormat(fileName);
	if (!format) return { document: { id, fileName, status: "rejected", error: "Unsupported document format. Accepted formats: PDF, PPTX, DOCX, MD, TXT." }, chunks: [] };
	try {
		const extracted = await extractDocument({ fileName, data });
		const textChunks = chunkDocument(extracted, id);
		let imageChunks: KnowledgeChunk[] = [];
		if (visionConfig && extracted.images?.length) {
			const imageBlocks = await describeImages(extracted.images, visionConfig);
			if (imageBlocks.length) imageChunks = chunkDocument({ fileName, format, status: "ready", blocks: imageBlocks }, id + "-img");
		}
		return { document: { id, fileName, format, status: extracted.status }, chunks: [...textChunks, ...imageChunks] };
	} catch {
		return { document: { id, fileName, format, status: "rejected", error: "Document extraction failed. Check that the file is valid, readable, and within supported extraction limits." }, chunks: [] };
	}
}

export interface KnowledgeLoaderOptions {
	sharedIndexFile?: string;
	loadPersonalSnapshot?: (userId: string) => KnowledgeSnapshot | Promise<KnowledgeSnapshot>;
}

/** Retriever loader seam: reload shared state and resolve only the explicit owner. */
export async function loadKnowledgeChunks(userId: string, options: KnowledgeLoaderOptions = {}): Promise<KnowledgeChunk[]> {
	const sharedIndexFile = options.sharedIndexFile ?? process.env.KNOWLEDGE_INDEX_FILE?.trim();
	const shared = sharedIndexFile ? await readKnowledgeSnapshot(sharedIndexFile) : undefined;
	const personal = options.loadPersonalSnapshot
		? validateKnowledgeSnapshot(await options.loadPersonalSnapshot(userId))
		: await (await import("../server/stores.ts")).checkedStoresForUser(userId).knowledgeStore.readSnapshot();
	const uploaded = await (await import("../server/stores.ts")).sharedKnowledgeStore.readSnapshot();
	return [...(shared?.chunks ?? []), ...uploaded.chunks, ...personal.chunks];
}
