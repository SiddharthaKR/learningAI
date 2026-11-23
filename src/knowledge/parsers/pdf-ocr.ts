import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { extractPdfImages } from "./pdf-images.ts";

/**
 * OCR fallback for PDFs without a text layer. Runs tesseract.js (eng+jpn) over
 * the embedded page images that pdf-images.ts extracts. Language data ships in
 * the @tesseract.js-data/* npm packages, so nothing is downloaded at runtime.
 */

const LANGS = ["eng", "jpn"] as const;
const DATA_VARIANT = "4.0.0_best_int";
const require = createRequire(import.meta.url);

export interface OcrPage {
	page: number;
	text: string;
}

/** tesseract.js takes one langPath: gather both traineddata files into one
 *  dir under os.tmpdir() (copied once; reused across runs). */
async function prepareLangPath(): Promise<string> {
	const dir = path.join(os.tmpdir(), "learnharness-tesseract", "lang");
	await mkdir(dir, { recursive: true });
	for (const lang of LANGS) {
		const pkgJson = require.resolve(`@tesseract.js-data/${lang}/package.json`);
		await copyFile(path.join(path.dirname(pkgJson), DATA_VARIANT, `${lang}.traineddata.gz`), path.join(dir, `${lang}.traineddata.gz`));
	}
	return dir;
}

/** OCR the embedded page images (only those on `pages` when given); returns one
 *  entry per page that yielded text.
 *  Never throws: any failure to load or run tesseract is logged and yields []. */
export async function ocrPdfPages(fileName: string, data: Uint8Array, pages?: ReadonlySet<number>): Promise<OcrPage[]> {
	let images;
	try {
		images = await extractPdfImages(fileName, data);
	} catch {
		return [];
	}
	if (pages) images = images.filter((image) => image.citation.format === "pdf" && pages.has(image.citation.page));
	if (!images.length) return [];
	let worker: import("tesseract.js").Worker | undefined;
	try {
		const { createWorker } = await import("tesseract.js");
		const langPath = await prepareLangPath();
		const cachePath = path.join(os.tmpdir(), "learnharness-tesseract", "cache");
		await mkdir(cachePath, { recursive: true });
		worker = await createWorker(LANGS.join("+"), 1, { langPath, cachePath, gzip: true });
		const byPage = new Map<number, string[]>();
		for (const image of images) {
			const page = image.citation.format === "pdf" ? image.citation.page : undefined;
			if (page === undefined) continue;
			const { data: result } = await worker.recognize(Buffer.from(image.data));
			const text = result.text.trim();
			if (!text) continue;
			byPage.set(page, [...(byPage.get(page) ?? []), text]);
		}
		return [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([page, texts]) => ({ page, text: texts.join("\n\n") }));
	} catch (error) {
		console.error("[knowledge] PDF OCR unavailable:", error instanceof Error ? error.message : error);
		return [];
	} finally {
		await worker?.terminate().catch(() => {});
	}
}
