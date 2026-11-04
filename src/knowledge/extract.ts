import type { ExtractedDocument } from "./contracts.ts";
import { extractDocx } from "./parsers/docx.ts";
import { extractPdf } from "./parsers/pdf.ts";
import { extractPptx } from "./parsers/pptx.ts";
import { extractText } from "./parsers/text.ts";

export async function extractDocument({ fileName, data }: { fileName: string; data: Uint8Array }): Promise<ExtractedDocument> {
	const extension = /\.([^.\\/]+)$/.exec(fileName)?.[1]?.toLowerCase();
	if (extension === "pdf") return extractPdf(fileName, data);
	if (extension === "pptx") return { fileName, format: extension, status: "ready", blocks: extractPptx(fileName, data) };
	if (extension === "docx") return { fileName, format: extension, status: "ready", blocks: extractDocx(fileName, data) };
	if (extension === "md" || extension === "txt") return { fileName, format: extension, status: "ready", blocks: extractText(fileName, data, extension) };
	throw new Error("Unsupported document format. Accepted formats: PDF, PPTX, DOCX, MD, TXT. Excel files are not supported.");
}
