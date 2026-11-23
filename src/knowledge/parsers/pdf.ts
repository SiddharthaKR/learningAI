import { pdfPageTextsWithOutline } from "../../agent/subagents/pdf-ops.ts";
import type { ExtractedDocument, ExtractedBlock } from "../contracts.ts";
import { ocrPdfPages, type OcrPage } from "./pdf-ocr.ts";

export type PdfOcrFn = (fileName: string, data: Uint8Array, pages: ReadonlySet<number>) => Promise<OcrPage[]>;

/**
 * Native text per page; pages with no text layer are OCRed (owner, 2026-11-24:
 * a mixed PDF used to skip its scanned pages entirely once any page had text).
 * OCR blocks keep their page number and carry the ocr flag.
 */
export async function extractPdf(fileName: string, data: Uint8Array, ocr: PdfOcrFn = ocrPdfPages): Promise<ExtractedDocument> {
	const { pages, sections } = await pdfPageTextsWithOutline(data);
	const withSection = (page: number, text: string, ocrFlag?: boolean): ExtractedBlock => {
		const section = sections[page - 1];
		return {
			text,
			citation: ocrFlag ? { format: "pdf", fileName, page, ocr: true } : { format: "pdf", fileName, page },
			...(section?.length ? { section } : {}),
		};
	};
	const native = new Map<number, string>();
	for (const { page, text } of pages) if (text.trim()) native.set(page, text);
	const missing = new Set(pages.map(({ page }) => page).filter((page) => !native.has(page)));
	const ocrText = new Map<number, string>();
	if (missing.size) {
		for (const { page, text } of await ocr(fileName, data, missing)) {
			if (missing.has(page) && text.trim()) ocrText.set(page, text);
		}
	}
	const blocks: ExtractedBlock[] = [];
	for (const { page } of pages) {
		const text = native.get(page);
		if (text !== undefined) blocks.push(withSection(page, text));
		else if (ocrText.has(page)) blocks.push(withSection(page, ocrText.get(page)!, true));
	}
	return blocks.length ? { fileName, format: "pdf", status: "ready", blocks } : { fileName, format: "pdf", status: "no_text_layer", blocks: [] };
}
