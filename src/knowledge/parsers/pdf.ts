import { pdfPageTexts } from "../../agent/subagents/pdf-ops.ts";
import type { ExtractedDocument, ExtractedBlock } from "../contracts.ts";

export async function extractPdf(fileName: string, data: Uint8Array): Promise<ExtractedDocument> {
	const pages = await pdfPageTexts(data);
	const blocks: ExtractedBlock[] = pages.filter(({ text }) => text.trim()).map(({ page, text }) => ({ text, citation: { format: "pdf", fileName, page } }));
	return blocks.length ? { fileName, format: "pdf", status: "ready", blocks } : { fileName, format: "pdf", status: "no_text_layer", blocks: [] };
}
