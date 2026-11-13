import { pdfPageTextsWithOutline } from "../../agent/subagents/pdf-ops.ts";
import type { ExtractedDocument, ExtractedBlock } from "../contracts.ts";
import { ocrPdfPages } from "./pdf-ocr.ts";

export async function extractPdf(fileName: string, data: Uint8Array): Promise<ExtractedDocument> {
	const { pages, sections } = await pdfPageTextsWithOutline(data);
	const withSection = (page: number, text: string, ocr?: boolean): ExtractedBlock => {
		const section = sections[page - 1];
		return {
			text,
			citation: ocr ? { format: "pdf", fileName, page, ocr: true } : { format: "pdf", fileName, page },
			...(section?.length ? { section } : {}),
		};
	};
	const blocks: ExtractedBlock[] = pages.filter(({ text }) => text.trim()).map(({ page, text }) => withSection(page, text));
	if (blocks.length) return { fileName, format: "pdf", status: "ready", blocks };
	const ocrBlocks = (await ocrPdfPages(fileName, data)).map(({ page, text }) => withSection(page, text, true));
	return ocrBlocks.length ? { fileName, format: "pdf", status: "ready", blocks: ocrBlocks } : { fileName, format: "pdf", status: "no_text_layer", blocks: [] };
}
