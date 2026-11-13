import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtractedBlock } from "../src/knowledge/contracts.ts";
import { extractDocument } from "../src/knowledge/extract.ts";
import { documentXml, officeZip, paragraphXml, slideXml, utf8 } from "./fixtures/knowledge/builders.ts";

// Each cell is a list of paragraphs; each row is a list of cells.
const cellXml = (paragraphs: string[]) => `<w:tc>${paragraphs.map((text) => paragraphXml(text)).join("")}</w:tc>`;
const tableXml = (rows: string[][][]) => `<w:tbl>${rows.map((row) => `<w:tr>${row.map(cellXml).join("")}</w:tr>`).join("")}</w:tbl>`;

const pptxCell = (text: string) => `<a:tc><a:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody></a:tc>`;
const pptxTable = (rows: string[][]) => `<a:tbl>${rows.map((row) => `<a:tr>${row.map(pptxCell).join("")}</a:tr>`).join("")}</a:tbl>`;

async function blocksOf(fileName: string, data: Uint8Array): Promise<ExtractedBlock[]> {
	return (await extractDocument({ fileName, data })).blocks;
}

describe("knowledge structured extraction", () => {
	it("nests DOCX heading paths and resets deeper levels when a higher heading appears", async () => {
		const data = officeZip({
			"word/document.xml": documentXml([
				paragraphXml("Chapter", "Heading1"),
				paragraphXml("Intro"),
				paragraphXml("Section A", "Heading2"),
				paragraphXml("A1"),
				paragraphXml("A2"),
				paragraphXml("Detail", "Heading3"),
				paragraphXml("D1"),
				paragraphXml("Section B", "Heading2"),
				paragraphXml("B1"),
			]),
		});
		assert.deepEqual(await blocksOf("nest.docx", data), [
			{ text: "Intro", citation: { format: "docx", fileName: "nest.docx", heading: "Chapter", paragraph: 2 }, section: ["Chapter"] },
			{ text: "A1\nA2", citation: { format: "docx", fileName: "nest.docx", heading: "Section A", paragraph: 4 }, section: ["Chapter", "Section A"] },
			{ text: "D1", citation: { format: "docx", fileName: "nest.docx", heading: "Detail", paragraph: 7 }, section: ["Chapter", "Section A", "Detail"] },
			{ text: "B1", citation: { format: "docx", fileName: "nest.docx", heading: "Section B", paragraph: 9 }, section: ["Chapter", "Section B"] },
		]);
	});

	it("groups consecutive DOCX body paragraphs into one block and drops headings without body", async () => {
		const data = officeZip({
			"word/document.xml": documentXml([
				paragraphXml("Empty", "Heading1"),
				paragraphXml("Next", "Heading1"),
				paragraphXml("First"),
				paragraphXml(""),
				paragraphXml("Second"),
			]),
		});
		assert.deepEqual(await blocksOf("group.docx", data), [
			{ text: "First\nSecond", citation: { format: "docx", fileName: "group.docx", heading: "Next", paragraph: 3 }, section: ["Next"] },
		]);
	});

	it("emits each DOCX table as one kind:table block with cells joined by pipes and rows on lines", async () => {
		const data = officeZip({
			"word/document.xml": documentXml([
				paragraphXml("Specs", "Heading1"),
				tableXml([
					[["Name"], ["Value"]],
					[["Clock"], ["100 MHz"]],
					[["Notes"], ["first", "second"]],
				]),
				paragraphXml("After"),
			]),
		});
		// Paragraph numbering: Specs=1, table paragraphs 2-8, After=9.
		assert.deepEqual(await blocksOf("table.docx", data), [
			{ text: "Name | Value\nClock | 100 MHz\nNotes | first second", citation: { format: "docx", fileName: "table.docx", heading: "Specs", paragraph: 2 }, section: ["Specs"], kind: "table" },
			{ text: "After", citation: { format: "docx", fileName: "table.docx", heading: "Specs", paragraph: 9 }, section: ["Specs"] },
		]);
	});

	it("does not repeat DOCX table paragraphs in body blocks", async () => {
		const data = officeZip({
			"word/document.xml": documentXml([paragraphXml("Before"), tableXml([[["Cell"]]]), paragraphXml("Tail")]),
		});
		const blocks = await blocksOf("dup.docx", data);
		assert.deepEqual(blocks, [
			{ text: "Before", citation: { format: "docx", fileName: "dup.docx", paragraph: 1 } },
			{ text: "Cell", citation: { format: "docx", fileName: "dup.docx", paragraph: 2 }, kind: "table" },
			{ text: "Tail", citation: { format: "docx", fileName: "dup.docx", paragraph: 3 } },
		]);
		assert.equal(blocks.filter((block) => block.kind !== "table").some((block) => block.text.includes("Cell")), false);
	});

	it("gives a PPTX slide section from its title and emits its table as a separate kind:table block", async () => {
		const xml = `<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Results</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:graphic><a:graphicData>${pptxTable([["Metric", "Score"], ["Accuracy", "92"]])}</a:graphicData></a:graphic></p:graphicFrame><p:sp><p:txBody><a:p><a:r><a:t>Footer</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
		assert.deepEqual(await blocksOf("deck.pptx", officeZip({ "ppt/slides/slide1.xml": xml })), [
			{ text: "Results\nFooter", citation: { format: "pptx", fileName: "deck.pptx", slide: 1, title: "Results" }, section: ["Results"] },
			{ text: "Metric | Score\nAccuracy | 92", citation: { format: "pptx", fileName: "deck.pptx", slide: 1, title: "Results" }, section: ["Results"], kind: "table" },
		]);
	});

	it("uses the first non-empty PPTX paragraph as the title and omits section when a table-only slide has none", async () => {
		assert.deepEqual(await blocksOf("untitled.pptx", officeZip({ "ppt/slides/slide1.xml": slideXml(["", "Body only"]) })), [
			{ text: "Body only", citation: { format: "pptx", fileName: "untitled.pptx", slide: 1, title: "Body only" }, section: ["Body only"] },
		]);
		const blank = '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData>' + pptxTable([["Only", "Table"]]) + "</a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>";
		assert.deepEqual(await blocksOf("tableonly.pptx", officeZip({ "ppt/slides/slide1.xml": blank })), [
			{ text: "Only | Table", citation: { format: "pptx", fileName: "tableonly.pptx", slide: 1, title: "" }, kind: "table" },
		]);
	});

	it("builds MD heading paths from # levels and resets deeper levels on a higher heading", async () => {
		const blocks = await blocksOf("paths.md", utf8("# A\nx\n## Sub\ny\n# B\nz"));
		assert.deepEqual(blocks, [
			{ text: "A\nx", citation: { format: "md", fileName: "paths.md", heading: "A", lineStart: 1, lineEnd: 2 }, section: ["A"] },
			{ text: "Sub\ny", citation: { format: "md", fileName: "paths.md", heading: "Sub", lineStart: 3, lineEnd: 4 }, section: ["A", "Sub"] },
			{ text: "B\nz", citation: { format: "md", fileName: "paths.md", heading: "B", lineStart: 5, lineEnd: 6 }, section: ["B"] },
		]);
	});

	it("splits Markdown pipe-table runs into their own kind:table blocks inside the section", async () => {
		const blocks = await blocksOf("table.md", utf8("# Title\nIntro\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter\n## Next\nMore"));
		assert.deepEqual(blocks, [
			{ text: "Title\nIntro", citation: { format: "md", fileName: "table.md", heading: "Title", lineStart: 1, lineEnd: 2 }, section: ["Title"] },
			{ text: "| a | b |\n|---|---|\n| 1 | 2 |", citation: { format: "md", fileName: "table.md", heading: "Title", lineStart: 3, lineEnd: 5 }, section: ["Title"], kind: "table" },
			{ text: "After", citation: { format: "md", fileName: "table.md", heading: "Title", lineStart: 6, lineEnd: 6 }, section: ["Title"] },
			{ text: "Next\nMore", citation: { format: "md", fileName: "table.md", heading: "Next", lineStart: 7, lineEnd: 8 }, section: ["Title", "Next"] },
		]);
	});

	it("leaves TXT blocks without section or table metadata", async () => {
		assert.deepEqual(await blocksOf("plain.txt", utf8("# Not a heading\n| a | b |")), [
			{ text: "# Not a heading\n| a | b |", citation: { format: "txt", fileName: "plain.txt", lineStart: 1, lineEnd: 2 } },
		]);
	});
});
