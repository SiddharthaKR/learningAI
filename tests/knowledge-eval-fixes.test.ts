/**
 * Fixes for the 2026-11-23 evaluation (owner, 2026-11-24): vision descriptions
 * run with thinking off and a real budget, land after their own page under the
 * document's id in the background; mixed PDFs OCR only their text-less pages;
 * split tables repeat their header.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { chunkDocument } from "../src/knowledge/chunk.ts";
import type { ExtractedBlock, ExtractedDocument } from "../src/knowledge/contracts.ts";
import { readKnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import { extractPdf } from "../src/knowledge/parsers/pdf.ts";
import { blocksWithImageDescriptions, knowledgeVisionConfig, type IndexedKnowledgeDocument } from "../src/knowledge/service.ts";
import { VISION_MAX_TOKENS, VISION_TIMEOUT_MS } from "../src/knowledge/vision-job.ts";
import { createKnowledgeStore, settleKnowledgeImageWork } from "../src/store/knowledge.ts";
import { pdfFixture } from "./fixtures/knowledge/builders.ts";

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const fileName = "manual.pdf";
const page = (n: number, text: string): ExtractedBlock => ({ text, citation: { format: "pdf", fileName, page: n } });
const image = (n: number) => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png", width: 200, height: 200, citation: { format: "pdf" as const, fileName, page: n } });

/** Stub the vision endpoint: records request bodies, optionally waits on a gate. */
function stubVision(gate?: Promise<void>): Array<Record<string, unknown>> {
	const bodies: Array<Record<string, unknown>> = [];
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body)));
		await gate;
		return new Response(JSON.stringify({ choices: [{ message: { content: "Block diagram: RFMC connector to the ADC tiles" } }] }), { headers: { "content-type": "application/json" } });
	}) as typeof fetch;
	return bodies;
}

function pendingUpload(): IndexedKnowledgeDocument {
	const id = "a".repeat(64);
	const extracted: ExtractedDocument = { fileName, format: "pdf", status: "ready", blocks: [page(1, "Introduction text"), page(2, "Board features text")], images: [image(1)] };
	return {
		document: { id, fileName, format: "pdf", status: "ready" },
		chunks: chunkDocument(extracted, id),
		pendingImages: { documentId: id, extracted, visionConfig: { baseUrl: "http://vision.test/v1", model: "vision-model" } },
	};
}

describe("vision descriptions", () => {
	it("reads the endpoint from VISION_* settings", () => {
		assert.equal(knowledgeVisionConfig({}), undefined);
		assert.deepEqual(knowledgeVisionConfig({ VISION_BASE_URL: "http://h/v1/", VISION_MODEL: "m" }), { baseUrl: "http://h/v1", model: "m" });
	});

	it("places each description right after its own page's text; position-less ones go last", () => {
		const description = (citation: ExtractedBlock["citation"]): ExtractedBlock => ({ text: "d", citation: { ...citation, imageDescription: true } as ExtractedBlock["citation"] });
		const merged = blocksWithImageDescriptions(
			[page(1, "p1"), page(2, "p2a"), page(2, "p2b"), page(3, "p3")],
			[description(page(2, "").citation), description({ format: "docx", fileName: "x.docx", paragraph: 1 })],
		);
		assert.deepEqual(merged.map((b) => `${b.text}${"imageDescription" in b.citation ? "*" : ""}`), ["p1", "p2a", "p2b", "d*", "p3", "d*"]);
	});

	it("publishes text at once, then adds the descriptions under the document id with thinking off", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "lh-vision-"));
		let open!: () => void;
		const bodies = stubVision(new Promise<void>((resolve) => { open = resolve; }));
		const store = createKnowledgeStore(root, () => {});
		const indexed = pendingUpload();
		const document = await store.uploadDocument({ fileName, data: new Uint8Array([9, 9, 9]), contentType: "application/pdf", indexed });
		assert.equal((await store.readSnapshot()).chunks.length, 2, "text is searchable before vision finishes");
		open();
		await settleKnowledgeImageWork();
		const snapshot = await readKnowledgeSnapshot(store.indexFile());
		const chunks = snapshot.chunks.filter((chunk) => chunk.sourceId === document.id).sort((a, b) => a.ordinal! - b.ordinal!);
		assert.deepEqual(chunks.map((c) => [c.citation.format === "pdf" ? c.citation.page : 0, "imageDescription" in c.citation && c.citation.imageDescription === true]), [[1, false], [1, true], [2, false]]);
		assert.ok(chunks.every((c) => c.sourceId === indexed.document.id));
		assert.equal(bodies.length, 1);
		assert.equal(bodies[0]!.reasoning_effort, "none");
		assert.deepEqual(bodies[0]!.chat_template_kwargs, { enable_thinking: false });
		assert.equal(bodies[0]!.max_tokens, VISION_MAX_TOKENS);
		assert.equal(VISION_MAX_TOKENS, 1536);
		assert.equal(VISION_TIMEOUT_MS, 180_000);
	});

	it("leaves a document deleted while its images were being described deleted", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "lh-vision-"));
		let open!: () => void;
		stubVision(new Promise<void>((resolve) => { open = resolve; }));
		const store = createKnowledgeStore(root, () => {});
		const document = await store.uploadDocument({ fileName, data: new Uint8Array([7, 7]), contentType: "application/pdf", indexed: pendingUpload() });
		assert.equal(await store.deleteDocument(document.id), true);
		open();
		await settleKnowledgeImageWork();
		const snapshot = await store.readSnapshot();
		assert.equal(snapshot.documents.length, 0);
		assert.equal(snapshot.chunks.length, 0);
	});
});

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
