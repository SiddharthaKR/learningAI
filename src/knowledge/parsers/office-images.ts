import { posix } from "node:path";
import { extractSelectedZipEntries } from "../archive.ts";
import type { ExtractedImage } from "../contracts.ts";
import { descendants, officeElements } from "./office.ts";
import { docxImagePlacements } from "./docx.ts";

const MIN_BYTES = 10240;
const MIN_DIMENSION = 100;

const MIME_MAP: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
};

export function meetsMinimumSize(bytes: number, width: number, height: number): boolean {
	return bytes >= MIN_BYTES && width >= MIN_DIMENSION && height >= MIN_DIMENSION;
}

function imageMimeType(entryName: string): string | undefined {
	const ext = /\.([^.]+)$/u.exec(entryName)?.[1]?.toLowerCase();
	return ext ? MIME_MAP[ext] : undefined;
}

export function pngDimensions(data: Uint8Array): { width: number; height: number } | undefined {
	// PNG signature (8 bytes) + IHDR chunk: 4-byte length, "IHDR", 4-byte width, 4-byte height
	if (data.length < 24) return undefined;
	if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const width = view.getUint32(16, false);
	const height = view.getUint32(20, false);
	return (width > 0 && height > 0) ? { width, height } : undefined;
}

export function jpegDimensions(data: Uint8Array): { width: number; height: number } | undefined {
	if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let offset = 2;
	while (offset + 4 < data.length) {
		if (data[offset] !== 0xff) return undefined;
		const marker = data[offset + 1]!;
		// SOF0 or SOF2 — baseline/progressive DCT
		if (marker === 0xc0 || marker === 0xc2) {
			if (offset + 9 > data.length) return undefined;
			const height = view.getUint16(offset + 5, false);
			const width = view.getUint16(offset + 7, false);
			return (width > 0 && height > 0) ? { width, height } : undefined;
		}
		// Skip non-SOF markers
		const segmentLength = view.getUint16(offset + 2, false);
		offset += 2 + segmentLength;
	}
	return undefined;
}

function imageDimensions(mimeType: string, data: Uint8Array): { width: number; height: number } | undefined {
	if (mimeType === "image/png") return pngDimensions(data);
	if (mimeType === "image/jpeg") return jpegDimensions(data);
	// GIF: 6-byte header + 2-byte width + 2-byte height (little-endian)
	if (mimeType === "image/gif" && data.length >= 10) {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const width = view.getUint16(6, true);
		const height = view.getUint16(8, true);
		return (width > 0 && height > 0) ? { width, height } : undefined;
	}
	return undefined;
}

function imageRelTargets(relsData: Uint8Array): string[] {
	return [...imageRels(relsData).values()];
}

/** Picture relationships of one part: id → target. */
function imageRels(relsData: Uint8Array): Map<string, string> {
	const rels = new Map<string, string>();
	for (const rel of descendants(officeElements(relsData), "Relationship")) {
		const { "@_Id": id, "@_Type": type, "@_Target": target, "@_TargetMode": mode } = rel.attributes;
		if (!id || !type?.endsWith("/image") || !target || mode === "External") continue;
		rels.set(id, target);
	}
	return rels;
}

export function extractPptxImages(fileName: string, data: Uint8Array): ExtractedImage[] {
	if (!data.length) return [];
	let entries: Map<string, Uint8Array>;
	try {
		entries = extractSelectedZipEntries(data, (name) =>
			/^ppt\/media\/.+$/u.test(name) || /^ppt\/slides\/_rels\/slide[1-9]\d*\.xml\.rels$/u.test(name));
	} catch {
		return [];
	}

	// Build media path → slide number map from relationship files
	const mediaToSlide = new Map<string, number>();
	for (const [entryName, entryData] of entries) {
		const slideMatch = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/u.exec(entryName);
		if (!slideMatch) continue;
		const slideNumber = Number(slideMatch[1]);
		for (const target of imageRelTargets(entryData)) {
			const resolved = target.startsWith("/")
				? target.slice(1)
				: posix.normalize(posix.join("ppt/slides", target));
			if (!/^ppt\/media\//u.test(resolved)) continue;
			// A picture reused on several slides is labelled with its first slide.
			const known = mediaToSlide.get(resolved);
			if (known === undefined || slideNumber < known) mediaToSlide.set(resolved, slideNumber);
		}
	}

	const images: ExtractedImage[] = [];
	for (const [entryName, entryData] of entries) {
		if (!/^ppt\/media\//u.test(entryName)) continue;
		// Only pictures placed on a slide: template/layout/master art (backgrounds, logos) is skipped.
		const slide = mediaToSlide.get(entryName);
		if (slide === undefined) continue;
		const mimeType = imageMimeType(entryName);
		if (!mimeType) continue;
		const dims = imageDimensions(mimeType, entryData);
		if (!dims) continue;
		if (!meetsMinimumSize(entryData.length, dims.width, dims.height)) continue;
		images.push({
			data: entryData,
			mimeType,
			width: dims.width,
			height: dims.height,
			citation: { format: "pptx", fileName, slide, title: "" },
		});
	}
	return images.sort((a, b) => (a.citation as { slide: number }).slide - (b.citation as { slide: number }).slide);
}

/**
 * Pictures placed in the Word body, each cited at its paragraph (the text reader's
 * numbering) under the heading above it, in document order. Header/footer art and
 * media that is never placed are skipped.
 */
export function extractDocxImages(fileName: string, data: Uint8Array): ExtractedImage[] {
	if (!data.length) return [];
	let entries: Map<string, Uint8Array>;
	let placements: ReturnType<typeof docxImagePlacements>;
	try {
		entries = extractSelectedZipEntries(data, (name) =>
			/^word\/media\/.+$/u.test(name) || name === "word/_rels/document.xml.rels");
		placements = docxImagePlacements(data);
	} catch {
		return [];
	}
	const relsData = entries.get("word/_rels/document.xml.rels");
	if (!relsData) return [];
	// Media path → earliest placement (a picture reused in the body is cited where it first appears).
	const mediaPlacement = new Map<string, { paragraph: number; heading?: string; section: string[] }>();
	for (const [id, target] of imageRels(relsData)) {
		const placement = placements.get(id);
		if (!placement) continue;
		const resolved = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join("word", target));
		if (!/^word\/media\//u.test(resolved)) continue;
		const known = mediaPlacement.get(resolved);
		if (!known || placement.paragraph < known.paragraph) mediaPlacement.set(resolved, placement);
	}

	const images: ExtractedImage[] = [];
	for (const [entryName, entryData] of entries) {
		if (!/^word\/media\//u.test(entryName)) continue;
		const placement = mediaPlacement.get(entryName);
		if (!placement) continue;
		const mimeType = imageMimeType(entryName);
		if (!mimeType) continue;
		const dims = imageDimensions(mimeType, entryData);
		if (!dims) continue;
		if (!meetsMinimumSize(entryData.length, dims.width, dims.height)) continue;
		images.push({
			data: entryData,
			mimeType,
			width: dims.width,
			height: dims.height,
			citation: { format: "docx", fileName, paragraph: placement.paragraph, ...(placement.heading === undefined ? {} : { heading: placement.heading }) },
			...(placement.section.length ? { section: placement.section } : {}),
		});
	}
	return images.sort((a, b) => (a.citation as { paragraph: number }).paragraph - (b.citation as { paragraph: number }).paragraph);
}
