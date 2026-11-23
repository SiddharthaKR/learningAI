/**
 * Fixes for the 2026-11-23 evaluation (owner, 2026-11-24): mixed PDFs OCR
 * only their text-less pages; split tables repeat their header.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkDocument } from "../src/knowledge/chunk.ts";
import { extractPdf } from "../src/knowledge/parsers/pdf.ts";
import { pdfFixture } from "./fixtures/knowledge/builders.ts";

describe("mixed PDFs", () => {
	it("keeps native pages and OCRs only the pages without a text layer", async () => {
		const asked: number[][] = [];
		const doc = await extractPdf("mixed.pdf", pdfFixture(["Native introduction", null]), async (_name, _data, pages) => {
			asked.push([...pages]);
			return [{ page: 1, text: "should be ignored" }, { page: 2, text: "SCANNED CODE 73921" }];
		});
		assert.deepEqual(asked, [[2]]);
		assert.equal(doc.status, "ready");
		assert.deepEqual(doc.blocks.map((b) => [b.citation.format === "pdf" ? b.citation.page : 0, b.text.trim(), "ocr" in b.citation && b.citation.ocr === true]), [
			[1, "Native introduction", false],
			[2, "SCANNED CODE 73921", true],
		]);
	});

	it("never runs OCR when every page has text", async () => {
		let called = false;
		await extractPdf("text.pdf", pdfFixture(["one", "two"]), async () => { called = true; return []; });
		assert.equal(called, false);
	});
});

describe("split tables", () => {
	it("repeats the header row (and Markdown separator) in every piece", () => {
		const rows = Array.from({ length: 180 }, (_, i) => `| R${i} | ${"value ".repeat(6)}|`);
		const table = ["| Name | Value |", "| --- | --- |", ...rows].join("\n");
		const chunks = chunkDocument({ fileName: "t.docx", format: "docx", status: "ready", blocks: [{ text: table, citation: { format: "docx", fileName: "t.docx", paragraph: 1 }, kind: "table" }] }, "s");
		assert.ok(chunks.length > 1);
		for (const chunk of chunks) assert.ok(chunk.text.startsWith("| Name | Value |\n| --- | --- |\n| R"), chunk.text.slice(0, 40));
		const body = chunks.flatMap((c) => c.text.split("\n").slice(2));
		assert.deepEqual(body, rows, "every data row appears exactly once, in order");
	});
});
