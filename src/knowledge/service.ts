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

/** A block's place in the document: slide (PPTX), page (PDF) or first paragraph (Word). */
function position(block: ExtractedBlock): number {
	const citation = block.citation;
	if (citation.format === "pptx") return citation.slide;
	if (citation.format === "pdf") return citation.page;
	if (citation.format === "docx") return citation.paragraph;
	return 0;
}

/**
 * Slot each picture description in after the last text block at or before its place
 * (after its slide's or page's text; in Word, after the text above it), inheriting
 * that block's section (and PPTX title, Word heading), so one chunking pass yields
 * valid ids and ordinals.
 */
function withPictures(blocks: ExtractedBlock[], pictures: ExtractedBlock[]): ExtractedBlock[] {
	const pending = [...pictures].sort((a, b) => position(a) - position(b));
	const out: ExtractedBlock[] = [];
	let previous: ExtractedBlock | undefined;
	const placeBefore = (limit: number) => {
		while (pending.length && position(pending[0]!) < limit) out.push(inherit(pending.shift()!, previous));
	};
	for (const block of blocks) {
		placeBefore(position(block));
		out.push(block);
		previous = block;
	}
	placeBefore(Number.POSITIVE_INFINITY);
	return out;
}

function inherit(picture: ExtractedBlock, context: ExtractedBlock | undefined): ExtractedBlock {
	if (!context) return picture;
	let citation = picture.citation;
	if (citation.format === "pptx" && context.citation.format === "pptx" && context.citation.slide === citation.slide) citation = { ...citation, title: context.citation.title };
	if (citation.format === "docx" && citation.heading === undefined && context.citation.format === "docx" && context.citation.heading !== undefined) citation = { ...citation, heading: context.citation.heading };
	// A picture that knows its own heading path (Word) keeps it; otherwise it takes its neighbour's.
	return { ...picture, citation, ...(!picture.section?.length && context.section?.length ? { section: [...context.section] } : {}) };
}

/** Formats whose pictures can be read: PowerPoint, Word, and PDFs with a real text layer (not scanned/OCR). */
export function picturesEligible(extracted: { format: KnowledgeFormat; status: string; blocks: ExtractedBlock[] }): boolean {
	if (extracted.status !== "ready") return false;
	if (extracted.format === "pptx" || extracted.format === "docx") return true;
	return extracted.format === "pdf" && !extracted.blocks.some((block) => block.citation.format === "pdf" && block.citation.ocr);
}

/**
 * Extract and chunk one document. `hasPictures` records whether it has pictures that
 * could be read. With `vision` (the user opted in and the server has a vision model),
 * those pictures are described and indexed in place; `imageReport` then says what
 * was read, where reading failed, and how many were over the cap. Pictures never
 * fail a document.
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
		const images = picturesEligible(extracted) ? extracted.images ?? [] : [];
		const document: KnowledgeDocumentRecord = { id, fileName, format, status: extracted.status, ...(images.length ? { hasPictures: true } : {}) };
		if (!activeVision || !images.length || extracted.status !== "ready") return { document, chunks: chunkDocument(extracted, id) };
		const { blocks: pictures, ...imageReport } = await describeImagesReport(images, activeVision.config, { ...(activeVision.callFn ? { callFn: activeVision.callFn } : {}), ...(activeVision.runSlot ? { runSlot: activeVision.runSlot } : {}) });
		const chunks = chunkDocument({ ...extracted, blocks: withPictures(extracted.blocks, pictures) }, id);
		return { document: { ...document, picturesRead: true }, chunks, imageReport };
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
