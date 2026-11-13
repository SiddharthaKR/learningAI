import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PDF plumbing for the pdf-reader sub-agent — sources v0 (2026-09): Node
 * ports of the four pdf-reader skill scripts (pdf_info / pdf_extract /
 * pdf_search / pdf_render), on the user-chosen hybrid stack:
 *
 * - TEXT (info / extract / search): pdfjs-dist — pure JS, no native deps.
 * - RENDER: subagents/headless.ts uses the same pdfjs engine with
 *   @napi-rs/canvas (Skia), in-process — no browser needed.
 *
 * Doctrine (the skill's reading strategy, mirrored in the sub-agent's system
 * prompt): triage with pdf_info FIRST, then size-based strategy — short PDFs
 * render all pages, medium render flagged (math/image-heavy) pages, long
 * ones search for targeted lookups before reading anything at length.
 *
 * These are pure library functions — no model in sight. The pdf-reader
 * agent (pdf-reader.ts) drives them through its own tool loop.
 */

export interface PdfPageInfo {
	page: number;
	text_length: number;
	image_count: number;
	/** Fraction of math-flavored chars — the render-this-page signal (port
	 *  of the skill's unicode-range density heuristic). */
	math_density: number;
}

export interface PdfInfo {
	path: string;
	page_count: number;
	/** Mean chars/page — the size class the strategy branches on. */
	mean_text_length: number;
	pages: PdfPageInfo[];
}

/** Load the legacy pdfjs build (runs headless in plain node, no worker). */
async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjs;
}

/** Standard-font data dir (live-smoke finding 2026-09-19: without it pdfjs
 *  warns and falls back on non-embedded standard fonts — Helvetica, Times…).
 *  The node side takes a plain filesystem path, shared by text and rendering.
 *  pdfjs checks endsWith("/") even on Windows: use a literal trailing slash,
 *  NOT path.sep ("\\" on Windows). Node fs accepts this path on every OS. */
export function standardFontsDir(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/";
}

async function openDocument(source: string | Uint8Array) {
	const pdfjs = await loadPdfjs();
	const data = typeof source === "string" ? new Uint8Array(await fs.readFile(source)) : new Uint8Array(source);
	// The legacy build in plain node runs on a main-thread fake worker (no
	// workerSrc needed); teardown is the loading task's destroy().
	// verbosity 0 = errors only — scanned PDFs (JBIG2 XObjects) otherwise
	// flood the log with per-page warnings (live-smoke finding 2026-09-19).
	const task = pdfjs.getDocument({ data, standardFontDataUrl: standardFontsDir(), verbosity: 0 });
	return { doc: await task.promise, task };
}

/** Stable page boundaries for document indexing, without formatted extraction headers.
 * Copy byte input because pdfjs may transfer its backing buffer to the worker. */
export async function pdfPageTexts(source: string | Uint8Array): Promise<Array<{ page: number; text: string }>> {
	return (await pdfPageTextsWithOutline(source)).pages;
}

/** Page texts plus, per page (index = page - 1), the outline section path
 *  (outermost first) or undefined when the PDF has no usable outline. Any
 *  outline failure is swallowed: texts always come back. */
export async function pdfPageTextsWithOutline(source: string | Uint8Array): Promise<{ pages: Array<{ page: number; text: string }>; sections: Array<string[] | undefined> }> {
	const { doc, task } = await openDocument(source);
	try {
		const pages: Array<{ page: number; text: string }> = [];
		for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
			const page = await doc.getPage(pageNumber);
			const content = await page.getTextContent();
			pages.push({ page: pageNumber, text: itemsToText(content.items as unknown[]) });
		}
		let sections: Array<string[] | undefined> = pages.map(() => undefined);
		try {
			sections = outlineSections(await resolveOutline(doc), doc.numPages);
		} catch {
			// outline is best-effort
		}
		return { pages, sections };
	} finally {
		await task.destroy();
	}
}

export interface OutlineEntry {
	title: string;
	depth: number;
	/** 0-based page index the entry starts on. */
	pageIndex: number;
}

interface PdfOutlineNode {
	title?: string;
	dest?: unknown;
	items?: PdfOutlineNode[];
}

/** Flatten the outline (document order) resolving each entry to a page index.
 *  Entries whose destination cannot be resolved are skipped. */
async function resolveOutline(doc: {
	getOutline(): Promise<unknown>;
	getDestination(id: string): Promise<unknown>;
	getPageIndex(ref: never): Promise<number>;
	numPages: number;
}): Promise<OutlineEntry[]> {
	const root = (await doc.getOutline()) as PdfOutlineNode[] | null;
	if (!Array.isArray(root) || root.length === 0) return [];
	const out: OutlineEntry[] = [];
	const walk = async (nodes: PdfOutlineNode[], depth: number) => {
		for (const node of nodes) {
			const title = typeof node.title === "string" ? node.title.trim() : "";
			let pageIndex: number | undefined;
			try {
				let dest: unknown = node.dest;
				if (typeof dest === "string") dest = await doc.getDestination(dest);
				if (Array.isArray(dest) && dest.length > 0) {
					const target = dest[0];
					if (typeof target === "number") pageIndex = target;
					else if (target && typeof target === "object") pageIndex = await doc.getPageIndex(target as never);
				}
			} catch {
				pageIndex = undefined;
			}
			if (title && pageIndex !== undefined && Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < doc.numPages) out.push({ title, depth, pageIndex });
			if (Array.isArray(node.items) && node.items.length) await walk(node.items, depth + 1);
		}
	};
	await walk(root, 0);
	return out;
}

/** Per page: the path of the deepest outline entries starting on or before it. */
export function outlineSections(entries: OutlineEntry[], numPages: number): Array<string[] | undefined> {
	const result: Array<string[] | undefined> = [];
	for (let p = 0; p < numPages; p++) {
		const stack: string[] = [];
		for (const entry of entries) {
			if (entry.pageIndex > p) continue;
			stack.length = Math.min(entry.depth, stack.length);
			stack.push(entry.title);
		}
		result.push(stack.length ? stack : undefined);
	}
	return result;
}

const CJK_RE = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

interface TextItemLike {
	str: string;
	hasEOL?: boolean;
	width?: number;
	height?: number;
	transform?: number[];
}

/** Join a page's text items into a body string: pdfjs end-of-line marks (and
 *  baseline jumps) become newlines; adjacent runs get one space only where
 *  pdfjs geometry shows a gap. Never spaces around CJK, never doubles whitespace. */
export function itemsToText(items: unknown[]): string {
	let out = "";
	let prev: TextItemLike | undefined;
	for (const raw of items) {
		if (!raw || typeof raw !== "object" || typeof (raw as { str?: unknown }).str !== "string") continue;
		const it = raw as TextItemLike;
		const str = it.str;
		if (prev && str && out && !out.endsWith("\n")) {
			const last = out[out.length - 1]!;
			const first = str[0]!;
			if (!/\s/.test(last) && !/\s/.test(first) && !CJK_RE.test(last) && !CJK_RE.test(first)) {
				const pt = prev.transform;
				const ct = it.transform;
				if (pt && ct && pt.length >= 6 && ct.length >= 6 && typeof prev.width === "number") {
					const size = Math.abs(ct[3]!) || it.height || 0;
					const dy = Math.abs(ct[5]! - pt[5]!);
					const gap = ct[4]! - (pt[4]! + prev.width);
					if (size > 0 && dy > size * 0.5) out += "\n";
					else if (size > 0 && gap > size * 0.1) out += " ";
				}
			}
		}
		out += str;
		if (it.hasEOL && out && !out.endsWith("\n")) out += "\n";
		if (str) prev = it;
	}
	return out.replace(/\n+$/, "");
}

/** Math-flavored char fraction — the skill's heuristic, verbatim ranges. */
function mathDensity(text: string): number {
	let mathChars = 0;
	for (const c of text) {
		const code = c.codePointAt(0)!;
		if (
			(code >= 0x2200 && code <= 0x22ff) || // Mathematical Operators
			(code >= 0x2100 && code <= 0x214f) || // Letterlike Symbols
			(code >= 0x2190 && code <= 0x21ff) || // Arrows
			(code >= 0x27c0 && code <= 0x27ef) || // Misc Mathematical Symbols-A
			(code >= 0x2980 && code <= 0x29ff) || // Misc Mathematical Symbols-B
			(code >= 0x2a00 && code <= 0x2aff) || // Supplemental Mathematical Operators
			(code >= 0x0370 && code <= 0x03ff) || // Greek
			(code >= 0x1d400 && code <= 0x1d7ff) || // Mathematical Alphanumeric Symbols
			"∫∑∏√∂∇∞≈≠≤≥±×÷∈∉⊂⊃∪∩∧∨¬∀∃∅".includes(c)
		) {
			mathChars++;
		}
	}
	return mathChars / Math.max(text.length, 1);
}

/** Cheap validity probe: getDocument resolves only for parseable PDFs —
 *  no page walk, no text extraction (unlike pdfInfo). The reader's upfront
 *  unreadable-source gate; garbage files throw pdfjs's precise error. */
export async function pdfProbe(filePath: string): Promise<void> {
	const { task } = await openDocument(filePath);
	await task.destroy();
}

/** pdf_info: page count + per-page triage signals. ALWAYS run first. */
export async function pdfInfo(filePath: string): Promise<PdfInfo> {
	const pdfjs = await loadPdfjs(); // OPS constant for the operator-list scan
	const { doc } = await openDocument(filePath);
	const pages: PdfPageInfo[] = [];
	let totalText = 0;
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const text = itemsToText(content.items as unknown[]);
		// count page images: paintImageXObject ops in the operator list
		const ops = await page.getOperatorList();
		let imageCount = 0;
		for (const fn of ops.fnArray) {
			if (fn === pdfjs.OPS.paintImageXObject) imageCount++;
		}
		totalText += text.length;
		pages.push({
			page: i,
			text_length: text.length,
			image_count: imageCount,
			math_density: Math.round(mathDensity(text) * 10000) / 10000,
		});
	}
	return {
		path: filePath,
		page_count: doc.numPages,
		mean_text_length: Math.round(totalText / Math.max(doc.numPages, 1)),
		pages,
	};
}

/** Parse 'all' | '1-5' | '1,3,7' | '3' into a sorted 1-indexed page list. */
export function parsePageSpec(spec: string, total: number): number[] {
	const trimmed = spec.trim().toLowerCase();
	if (trimmed === "all") return Array.from({ length: total }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of spec.split(",")) {
		const p = part.trim();
		if (!p) continue;
		if (p.includes("-")) {
			const [startRaw, endRaw] = p.split("-", 2) as [string, string];
			const start = Math.max(1, parseInt(startRaw, 10));
			const end = Math.min(total, parseInt(endRaw, 10));
			for (let pg = start; pg <= end; pg++) pages.add(pg);
		} else {
			const pg = parseInt(p, 10);
			if (pg >= 1 && pg <= total) pages.add(pg);
		}
	}
	return [...pages].sort((a, b) => a - b);
}

/** pdf_extract: text of the requested pages, `--- Page N ---` headed. */
export async function pdfExtract(filePath: string, pageSpec: string): Promise<string> {
	const { doc } = await openDocument(filePath);
	const pages = parsePageSpec(pageSpec, doc.numPages);
	if (pages.length === 0) return "No pages selected — page spec matched nothing.";
	const out: string[] = [];
	for (const i of pages) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		out.push(`--- Page ${i} ---`);
		out.push(itemsToText(content.items as unknown[]));
	}
	return out.join("\n");
}

export interface PdfSearchHit {
	page: number;
	line: number;
	/** contextLines around the hit, `>>>` marking the hit line. */
	context: string;
}

/** pdf_search: keyword/regex across all pages with context lines.
 *  pageTexts rides along so the agent can extract a hit's full page without
 *  a second pass (the skill pipelines `search → extract` the same way). */
export async function pdfSearch(
	filePath: string,
	query: string,
	opts?: { contextLines?: number; literal?: boolean },
): Promise<{ hits: PdfSearchHit[]; pageTexts: Map<number, string> }> {
	const contextLines = opts?.contextLines ?? 3;
	const { doc } = await openDocument(filePath);
	let pattern: RegExp;
	if (opts?.literal) {
		pattern = new RegExp(escapeRegex(query), "i");
	} else {
		try {
			pattern = new RegExp(query, "i");
		} catch (err) {
			throw new Error(`Invalid regex: ${(err as Error).message}`);
		}
	}
	const hits: PdfSearchHit[] = [];
	const pageTexts = new Map<number, string>();
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const text = itemsToText(content.items as unknown[]);
		pageTexts.set(i, text);
		const lines = text.split("\n");
		for (let ln = 0; ln < lines.length; ln++) {
			if (!pattern.test(lines[ln]!)) continue;
			const start = Math.max(0, ln - contextLines);
			const end = Math.min(lines.length, ln + contextLines + 1);
			const context = lines
				.slice(start, end)
				.map((l, j) => `${start + j === ln ? ">>>" : "   "} ${l}`)
				.join("\n");
			hits.push({ page: i, line: ln + 1, context });
		}
	}
	return { hits, pageTexts };
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where rendered pages land (mirrors the skill's /tmp convention). */
export function renderDir(filePath: string): string {
	// FNV-1a short hash of the absolute path — stable per file, no deps.
	const abs = path.resolve(filePath);
	let h = 0x811c9dc5;
	for (let i = 0; i < abs.length; i++) {
		h ^= abs.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return path.join("/tmp", `lh-pdf-${h.toString(16).padStart(8, "0")}`);
}
