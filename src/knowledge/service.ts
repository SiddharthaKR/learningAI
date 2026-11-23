import { createHash } from "node:crypto";
import type { KnowledgeSearchScope } from "../core/contracts/chat.ts";
import type { ExtractedBlock, ExtractedDocument, KnowledgeChunk, KnowledgeFormat } from "./contracts.ts";
import { processKnowledgeCache, type CachedStore, type KnowledgeCache } from "./cache.ts";
import type { ChunkPart } from "./search.ts";
import { chunkDocument } from "./chunk.ts";
import { extractDocument } from "./extract.ts";
import { normalizeKnowledgeFileName, validateKnowledgeSnapshot, type KnowledgeDocumentRecord, type KnowledgeSnapshot } from "./index-store.ts";
import { resolveOpenSection, type OpenSectionResult } from "./open-section.ts";
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

/** The vision endpoint from VISION_BASE_URL / VISION_MODEL / VISION_API_KEY; absent = no image descriptions. */
export function knowledgeVisionConfig(env: Record<string, string | undefined> = process.env): VisionConfig | undefined {
	const baseUrl = env.VISION_BASE_URL?.trim().replace(/\/$/u, "");
	const model = env.VISION_MODEL?.trim();
	if (!baseUrl || !model) return undefined;
	const apiKey = env.VISION_API_KEY?.trim();
	return { baseUrl, model, ...(apiKey ? { apiKey } : {}) };
}

/** Where a block sits for ordering: PDF page or PPTX slide. DOCX images carry
 *  no real position, so they (and anything else) sort after all text. */
function blockPosition(block: ExtractedBlock): number {
	if (block.citation.format === "pdf") return block.citation.page;
	if (block.citation.format === "pptx") return block.citation.slide;
	return Number.POSITIVE_INFINITY;
}

/** Text blocks with each image description placed right after its own page's
 *  text (owner, 2026-11-24), so ordinals and neighbors follow the document. */
export function blocksWithImageDescriptions(blocks: ExtractedBlock[], descriptions: ExtractedBlock[]): ExtractedBlock[] {
	const merged = [...blocks];
	for (const description of descriptions) {
		const position = blockPosition(description);
		const after = position === Number.POSITIVE_INFINITY ? -1 : merged.findIndex((block) => blockPosition(block) > position);
		merged.splice(after < 0 ? merged.length : after, 0, description);
	}
	return merged;
}

/** A ready document whose images still need describing (the background step). */
export interface PendingImageDescriptions {
	documentId: string;
	extracted: ExtractedDocument;
	visionConfig: VisionConfig;
}

/** Describe the pending images. Returns the document's complete new chunk list
 *  (text plus page-placed descriptions, all under the document id), or null when
 *  no image produced a description. */
export async function describePendingImages({ documentId, extracted, visionConfig }: PendingImageDescriptions): Promise<KnowledgeChunk[] | null> {
	if (extracted.status !== "ready" || !extracted.images?.length) return null;
	const descriptions = await describeImages(extracted.images, visionConfig);
	if (!descriptions.length) return null;
	return chunkDocument({ ...extracted, blocks: blocksWithImageDescriptions(extracted.blocks, descriptions) }, documentId);
}

export interface IndexedKnowledgeDocument {
	document: KnowledgeDocumentRecord;
	chunks: KnowledgeChunk[];
	/** Images left to describe in the background (only with deferImages). */
	pendingImages?: PendingImageDescriptions;
}

/**
 * Extract and chunk one document. With a visionConfig, image descriptions run
 * inline; with deferImages as well, the text chunks return at once and
 * pendingImages carries the image work for the caller to finish later.
 */
export async function indexKnowledgeDocument({ fileName, data, visionConfig, deferImages = false }: { fileName: string; data: Uint8Array; visionConfig?: VisionConfig; deferImages?: boolean }): Promise<IndexedKnowledgeDocument> {
	fileName = normalizeKnowledgeFileName(fileName);
	const contentHash = createHash("sha256").update(data).digest("hex");
	const id = createHash("sha256").update(JSON.stringify([fileName, contentHash])).digest("hex");
	const format = acceptedFormat(fileName);
	if (!format) return { document: { id, fileName, status: "rejected", error: "Unsupported document format. Accepted formats: PDF, PPTX, DOCX, MD, TXT." }, chunks: [] };
	try {
		const extracted = await extractDocument({ fileName, data });
		const document: KnowledgeDocumentRecord = { id, fileName, format, status: extracted.status };
		const chunks = chunkDocument(extracted, id);
		if (!visionConfig || extracted.status !== "ready" || !extracted.images?.length) return { document, chunks };
		const pendingImages = { documentId: id, extracted, visionConfig };
		if (deferImages) return { document, chunks, pendingImages };
		return { document, chunks: (await describePendingImages(pendingImages)) ?? chunks };
	} catch {
		return { document: { id, fileName, format, status: "rejected", error: "Document extraction failed. Check that the file is valid, readable, and within supported extraction limits." }, chunks: [] };
	}
}

export interface KnowledgeLoaderOptions {
	/** Which knowledge is visible; absent = "all". */
	scope?: KnowledgeSearchScope;
	sharedIndexFile?: string;
	loadPersonalSnapshot?: (userId: string) => KnowledgeSnapshot | Promise<KnowledgeSnapshot>;
	/** Snapshot cache; defaults to the process-wide one. */
	cache?: KnowledgeCache;
}

interface ScopedStores {
	personal?: CachedStore;
	uploaded?: CachedStore;
	admin?: CachedStore;
}

/** Resolve the stores visible under the scope, through the revision-validated cache. */
async function loadScopedStores(userId: string, options: KnowledgeLoaderOptions): Promise<ScopedStores> {
	const scope = options.scope ?? "all";
	const sharedIndexFile = options.sharedIndexFile ?? process.env.KNOWLEDGE_INDEX_FILE?.trim();
	const cache = options.cache ?? processKnowledgeCache();
	const stores = await import("../server/stores.ts");
	let personal: CachedStore | undefined;
	if (scope !== "shared") {
		if (options.loadPersonalSnapshot) {
			// Caller-supplied snapshots have no file identity to validate against: never cached.
			const snapshot = validateKnowledgeSnapshot(await options.loadPersonalSnapshot(userId));
			personal = { snapshot, part: { chunks: snapshot.chunks } };
		} else {
			// indexFile() is a checked-store call, so the owner-exists guard still applies on cache hits.
			personal = await cache.get(stores.checkedStoresForUser(userId).knowledgeStore.indexFile(), "personal");
		}
	}
	const uploaded = scope === "personal" ? undefined : await cache.get(stores.sharedKnowledgeStore.indexFile(), "shared");
	const admin = sharedIndexFile && scope !== "personal" ? await cache.get(sharedIndexFile, "shared") : undefined;
	return { personal, uploaded, admin };
}

/** open_section port implementation: owner's personal docs + shared uploads + optional admin index. */
export async function openKnowledgeSection(userId: string, fileName: string, section: string[], options: KnowledgeLoaderOptions = {}): Promise<OpenSectionResult> {
	const { personal, uploaded, admin } = await loadScopedStores(userId, options);
	return resolveOpenSection([
		...(personal ? [{ scope: "personal" as const, label: "personal", snapshot: personal.snapshot }] : []),
		...(uploaded ? [{ scope: "shared" as const, label: "shared", snapshot: uploaded.snapshot }] : []),
		...(admin ? [{ scope: "shared" as const, label: "shared index", snapshot: admin.snapshot }] : []),
	], fileName, section);
}

/** Retriever loader seam, per store: admin index, shared uploads, then personal (cached; carries prepared ranker data). */
export async function loadKnowledgeParts(userId: string, options: KnowledgeLoaderOptions = {}): Promise<ChunkPart[]> {
	const { personal, uploaded, admin } = await loadScopedStores(userId, options);
	return [admin, uploaded, personal].flatMap((store) => (store ? [store.part] : []));
}

/** Retriever loader seam: reload shared state and resolve only the explicit owner. */
export async function loadKnowledgeChunks(userId: string, options: KnowledgeLoaderOptions = {}): Promise<KnowledgeChunk[]> {
	return (await loadKnowledgeParts(userId, options)).flatMap((part) => part.chunks);
}
