import { createHash } from "node:crypto";
import type { KnowledgeSearchScope } from "../core/contracts/chat.ts";
import type { ExtractedBlock, KnowledgeChunk, KnowledgeFormat } from "./contracts.ts";
import { processKnowledgeCache, type CachedStore, type KnowledgeCache } from "./cache.ts";
import type { ChunkPart } from "./search.ts";
import { chunkDocument } from "./chunk.ts";
import { extractDocument } from "./extract.ts";
import { normalizeKnowledgeFileName, validateKnowledgeSnapshot, type KnowledgeDocumentRecord, type KnowledgeSnapshot } from "./index-store.ts";
import { resolveOpenSection, type OpenSectionResult } from "./open-section.ts";
import { describeImagesReport, type ImageReport, type IndexVision, type VisionConfig } from "./vision-job.ts";

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

function blockSlide(block: ExtractedBlock): number {
	return block.citation.format === "pptx" ? block.citation.slide : 0;
}

/**
 * Slot each picture description in right after its slide's text, inheriting that
 * slide's title and section, so one chunking pass yields valid ids and ordinals.
 * Pictures on slides without text go in slide order.
 */
function withPictures(blocks: ExtractedBlock[], pictures: ExtractedBlock[]): ExtractedBlock[] {
	const pending = [...pictures].sort((a, b) => blockSlide(a) - blockSlide(b));
	const out: ExtractedBlock[] = [];
	blocks.forEach((block, index) => {
		const slide = blockSlide(block);
		while (pending.length && blockSlide(pending[0]!) < slide) out.push(pending.shift()!);
		out.push(block);
		const next = blocks[index + 1];
		if (next && blockSlide(next) === slide) return;
		while (pending.length && blockSlide(pending[0]!) === slide) {
			const picture = pending.shift()!;
			const title = block.citation.format === "pptx" ? block.citation.title : "";
			out.push({ ...picture, citation: { ...picture.citation, title } as ExtractedBlock["citation"], ...(block.section?.length ? { section: [...block.section] } : {}) });
		}
	});
	return [...out, ...pending];
}

/**
 * Extract and chunk one document. With `vision`, PPTX pictures placed on slides are
 * described and indexed under their slide; `imageReport` then says what was read,
 * which slides failed, and how many were over the cap. Pictures never fail a document.
 */
export async function indexKnowledgeDocument({ fileName, data, visionConfig, vision }: { fileName: string; data: Uint8Array; visionConfig?: VisionConfig; vision?: IndexVision }): Promise<{ document: KnowledgeDocumentRecord; chunks: KnowledgeChunk[]; imageReport?: ImageReport }> {
	fileName = normalizeKnowledgeFileName(fileName);
	const contentHash = createHash("sha256").update(data).digest("hex");
	const id = createHash("sha256").update(JSON.stringify([fileName, contentHash])).digest("hex");
	const format = acceptedFormat(fileName);
	if (!format) return { document: { id, fileName, status: "rejected", error: "Unsupported document format. Accepted formats: PDF, PPTX, DOCX, MD, TXT." }, chunks: [] };
	const activeVision = vision ?? (visionConfig ? { config: visionConfig } : undefined);
	try {
		const extracted = await extractDocument({ fileName, data });
		if (!activeVision || format !== "pptx" || extracted.status !== "ready") {
			return { document: { id, fileName, format, status: extracted.status }, chunks: chunkDocument(extracted, id) };
		}
		const report = await describeImagesReport(extracted.images ?? [], activeVision.config, { ...(activeVision.callFn ? { callFn: activeVision.callFn } : {}), ...(activeVision.runSlot ? { runSlot: activeVision.runSlot } : {}) });
		const { blocks: pictures, ...imageReport } = report;
		const chunks = chunkDocument({ ...extracted, blocks: withPictures(extracted.blocks, pictures) }, id);
		return { document: { id, fileName, format, status: extracted.status }, chunks, imageReport };
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
