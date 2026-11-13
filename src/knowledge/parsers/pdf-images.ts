import { zlibSync } from "fflate";
import { standardFontsDir } from "../../agent/subagents/pdf-ops.ts";
import type { ExtractedImage } from "../contracts.ts";

const MIN_BYTES = 10240;
const MIN_DIMENSION = 100;

export function meetsMinimumSize(bytes: number, width: number, height: number): boolean {
	return bytes >= MIN_BYTES && width >= MIN_DIMENSION && height >= MIN_DIMENSION;
}

async function loadPdfjs() {
	return await import("pdfjs-dist/legacy/build/pdf.mjs");
}

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc ^= data[i]!;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function uint32be(value: number): Uint8Array {
	return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const typeBytes = new TextEncoder().encode(type);
	const combined = new Uint8Array(typeBytes.length + data.length);
	combined.set(typeBytes, 0);
	combined.set(data, typeBytes.length);
	const out = new Uint8Array(4 + combined.length + 4);
	out.set(uint32be(data.length), 0);
	out.set(combined, 4);
	out.set(uint32be(crc32(combined)), 4 + combined.length);
	return out;
}

export function rgbaToPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
	const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	const ihdr = new Uint8Array(13);
	ihdr.set(uint32be(width), 0);
	ihdr.set(uint32be(height), 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	const ihdrChunk = pngChunk("IHDR", ihdr);

	const rowBytes = width * 4;
	const raw = new Uint8Array(height * (1 + rowBytes));
	for (let y = 0; y < height; y++) {
		raw[y * (1 + rowBytes)] = 0; // filter: none
		raw.set(rgba.subarray(y * rowBytes, y * rowBytes + rowBytes), y * (1 + rowBytes) + 1);
	}
	const compressed = zlibSync(raw);
	const idatChunk = pngChunk("IDAT", compressed);
	const iendChunk = pngChunk("IEND", new Uint8Array(0));

	const png = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
	let offset = 0;
	for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
		png.set(part, offset);
		offset += part.length;
	}
	return png;
}

/** pdfjs resolves image objects asynchronously: objs.get(name) throws until
 *  they arrive, so wait via the callback form (bounded). */
function resolveImageObject(page: { objs: { get(name: string, cb?: (value: unknown) => void): unknown } }, name: string): Promise<unknown> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(undefined), 10000);
		try {
			page.objs.get(name, (value) => {
				clearTimeout(timer);
				resolve(value);
			});
		} catch {
			clearTimeout(timer);
			resolve(undefined);
		}
	});
}

/** pdfjs ImageKind -> RGBA bytes (1 = 1bpp gray, 2 = RGB24, 3 = RGBA32). */
function toRgba(width: number, height: number, kind: number, data: Uint8Array | Uint8ClampedArray): Uint8Array | undefined {
	if (kind === 3) return data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	const out = new Uint8Array(width * height * 4);
	if (kind === 2) {
		for (let i = 0, n = width * height; i < n; i++) {
			out[i * 4] = data[i * 3]!;
			out[i * 4 + 1] = data[i * 3 + 1]!;
			out[i * 4 + 2] = data[i * 3 + 2]!;
			out[i * 4 + 3] = 255;
		}
		return out;
	}
	if (kind === 1) {
		const rowBytes = Math.ceil(width / 8);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
				const o = (y * width + x) * 4;
				out[o] = out[o + 1] = out[o + 2] = bit ? 255 : 0;
				out[o + 3] = 255;
			}
		}
		return out;
	}
	return undefined;
}

export async function extractPdfImages(fileName: string, data: Uint8Array): Promise<ExtractedImage[]> {
	if (data.length === 0) return [];
	const pdfjs = await loadPdfjs();
	let task;
	try {
		task = pdfjs.getDocument({ data: new Uint8Array(data), standardFontDataUrl: standardFontsDir(), verbosity: 0 });
	} catch {
		return [];
	}
	let doc;
	try {
		doc = await task.promise;
	} catch {
		return [];
	}
	const images: ExtractedImage[] = [];
	try {
		for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
			const page = await doc.getPage(pageNumber);
			const ops = await page.getOperatorList();
			const seen = new Set<string>();
			for (let i = 0; i < ops.fnArray.length; i++) {
				if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
				const imageName = ops.argsArray[i]?.[0] as string | undefined;
				if (!imageName || seen.has(imageName)) continue;
				seen.add(imageName);
				try {
					const imgObj = (await resolveImageObject(page, imageName)) as { width: number; height: number; data: Uint8Array | Uint8ClampedArray; kind: number } | undefined;
					if (!imgObj?.data || !imgObj.width || !imgObj.height) continue;
					const rawBytes = imgObj.data.length;
					if (!meetsMinimumSize(rawBytes, imgObj.width, imgObj.height)) continue;
					const rgba = toRgba(imgObj.width, imgObj.height, imgObj.kind, imgObj.data);
						if (!rgba) continue;
					const pngData = rgbaToPng(imgObj.width, imgObj.height, rgba);
					images.push({
						data: pngData,
						mimeType: "image/png",
						width: imgObj.width,
						height: imgObj.height,
						citation: { format: "pdf", fileName, page: pageNumber },
					});
				} catch {
					// best-effort: skip unresolvable image objects
				}
			}
		}
	} finally {
		await task.destroy();
	}
	return images;
}
