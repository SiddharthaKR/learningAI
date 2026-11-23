/**
 * Picture reading for Word and PDF, and the per-format failure locations
 * (slide / page / paragraph + heading) the opt-in notice is built from.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { officeZip, paragraphXml } from "./fixtures/knowledge/builders.ts";
import { extractDocxImages } from "../src/knowledge/parsers/office-images.ts";
import { extractDocx } from "../src/knowledge/parsers/docx.ts";
import { describeImagesReport } from "../src/knowledge/vision-job.ts";
import { indexKnowledgeDocument, picturesEligible } from "../src/knowledge/service.ts";
import { validateKnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import type { ExtractedImage } from "../src/knowledge/contracts.ts";

function png(seed: number): Uint8Array {
	const bytes = new Uint8Array(12_000);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, 200);
	view.setUint32(20, 200);
	bytes[100] = seed;
	return bytes;
}
const drawing = (rId: string) => `<w:p><w:r><w:drawing><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r></w:p>`;
const docRels = (pairs: Array<[string, string]>) =>
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pairs.map(([id, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`).join("")}</Relationships>`;
const styles = `<w:styles xmlns:w="urn:w"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;

/** Intro text; "Results" heading; a chart picture; text; a footer logo that is not in the body. */
function wordDoc(): Uint8Array {
	const body = [
		paragraphXml("Intro text."),
		paragraphXml("Results", "Heading1"),
		drawing("rId5"),
		paragraphXml("The chart above shows the trend."),
	].join("");
	return officeZip({
		"word/document.xml": `<w:document xmlns:w="urn:w"><w:body>${body}<w:sectPr/></w:body></w:document>`,
		"word/styles.xml": styles,
		"word/_rels/document.xml.rels": docRels([["rId5", "media/chart.png"], ["rId9", "media/logo.png"]]),
		"word/media/chart.png": png(1),
		"word/media/logo.png": png(2),
	});
}

const image = (citation: ExtractedImage["citation"], seed: number): ExtractedImage => ({ data: png(seed), mimeType: "image/png", width: 200, height: 200, citation });

describe("Word pictures", () => {
	it("are placed at their paragraph under their heading; pictures not in the body are skipped", () => {
		const images = extractDocxImages("r.docx", wordDoc());
		assert.equal(images.length, 1, "the logo is referenced but never placed in the body");
		assert.deepEqual(images[0]!.citation, { format: "docx", fileName: "r.docx", paragraph: 3, heading: "Results" });
	});

	it("the picture's paragraph number matches the text reader's numbering", () => {
		const blocks = extractDocx("r.docx", wordDoc());
		const after = blocks.find((b) => b.text.includes("chart above"))!;
		assert.equal((after.citation as { paragraph: number }).paragraph, 4, "picture is paragraph 3, the next text paragraph 4");
	});

	it("are indexed after the text before them, valid in a snapshot", async () => {
		const indexed = await indexKnowledgeDocument({ fileName: "r.docx", data: wordDoc(), vision: { config: { baseUrl: "http://x/v1", model: "m" }, callFn: async () => "Bar chart of quarterly results" } });
		const index = indexed.chunks.findIndex((c) => (c.citation as { imageDescription?: boolean }).imageDescription);
		assert.ok(index > 0);
		assert.match(indexed.chunks[index - 1]!.text, /Intro text/u, "follows the last text block before paragraph 3");
		assert.deepEqual(indexed.chunks[index]!.section, ["Results"]);
		validateKnowledgeSnapshot({ version: 1, generatedAt: new Date().toISOString(), documents: [indexed.document], chunks: indexed.chunks });
		assert.deepEqual(indexed.imageReport, { described: 1, failed: [], skipped: 0 });
		assert.equal(indexed.document.hasPictures, true);
		assert.equal(indexed.document.picturesRead, true);
	});
});

describe("failure locations per format", () => {
	it("slides, pages and paragraphs are reported in order with Word headings", async () => {
		const report = await describeImagesReport([
			image({ format: "pptx", fileName: "d.pptx", slide: 7, title: "" }, 1),
			image({ format: "pptx", fileName: "d.pptx", slide: 3, title: "" }, 2),
		], { baseUrl: "http://x/v1", model: "m" }, { callFn: async () => { throw new Error("down"); } });
		assert.deepEqual(report.failed, [{ kind: "slide", number: 3 }, { kind: "slide", number: 7 }]);
		const pdf = await describeImagesReport([image({ format: "pdf", fileName: "p.pdf", page: 12 }, 3)], { baseUrl: "http://x/v1", model: "m" }, { callFn: async () => "" });
		assert.deepEqual(pdf.failed, [{ kind: "page", number: 12 }]);
		const word = await describeImagesReport([image({ format: "docx", fileName: "r.docx", paragraph: 3, heading: "Results" }, 4)], { baseUrl: "http://x/v1", model: "m" }, { callFn: async () => "" });
		assert.deepEqual(word.failed, [{ kind: "paragraph", number: 3, heading: "Results" }]);
	});
});

describe("documents remember pictures", () => {
	it("text-only reading of a file with pictures records hasPictures without picturesRead", async () => {
		const indexed = await indexKnowledgeDocument({ fileName: "r.docx", data: wordDoc() });
		assert.equal(indexed.document.hasPictures, true);
		assert.equal(indexed.document.picturesRead, undefined);
		assert.equal(indexed.imageReport, undefined);
	});
});

describe("which documents can have their pictures read", () => {
	const block = (citation: Record<string, unknown>) => ({ text: "t", citation: citation as never });
	it("PowerPoint, Word and text PDFs yes; scanned (OCR) PDFs and plain text no", () => {
		assert.equal(picturesEligible({ format: "pptx", status: "ready", blocks: [] }), true);
		assert.equal(picturesEligible({ format: "docx", status: "ready", blocks: [] }), true);
		assert.equal(picturesEligible({ format: "pdf", status: "ready", blocks: [block({ format: "pdf", fileName: "a.pdf", page: 1 })] }), true);
		assert.equal(picturesEligible({ format: "pdf", status: "ready", blocks: [block({ format: "pdf", fileName: "a.pdf", page: 1, ocr: true })] }), false, "scanned pages are already read by OCR");
		assert.equal(picturesEligible({ format: "pdf", status: "no_text_layer", blocks: [] }), false);
		assert.equal(picturesEligible({ format: "md", status: "ready", blocks: [] }), false);
	});
});
