import type { ExtractedDocument, ExtractedImage } from "./contracts.ts";
import { extractDocx } from "./parsers/docx.ts";
import { extractDocxImages, extractPptxImages } from "./parsers/office-images.ts";
import { extractPdf } from "./parsers/pdf.ts";
import { extractPdfImages } from "./parsers/pdf-images.ts";
import { extractPptx } from "./parsers/pptx.ts";
import { extractText } from "./parsers/text.ts";

export async function extractDocument({ fileName, data }: { fileName: string; data: Uint8Array }): Promise<ExtractedDocument> {
	const extension = /\.([^.\\/]+)$/.exec(fileName)?.[1]?.toLowerCase();
	if (extension === "pdf") {
		const doc = await extractPdf(fileName, data);
		const images = await extractPdfImages(fileName, data);
		return images.length ? { ...doc, images } : doc;
	}
	if (extension === "pptx") {
		const blocks = extractPptx(fileName, data);
		const images = extractPptxImages(fileName, data);
		return images.length
			? { fileName, format: extension, status: "ready", blocks, images }
			: { fileName, format: extension, status: "ready", blocks };
	}
	if (extension === "docx") {
		const blocks = extractDocx(fileName, data);
		const images = extractDocxImages(fileName, data);
		return images.length
			? { fileName, format: extension, status: "ready", blocks, images }
			: { fileName, format: extension, status: "ready", blocks };
	}
	if (extension === "md" || extension === "txt") return { fileName, format: extension, status: "ready", blocks: extractText(fileName, data, extension) };
	throw new Error("Unsupported document format. Accepted formats: PDF, PPTX, DOCX, MD, TXT. Excel files are not supported.");
}
