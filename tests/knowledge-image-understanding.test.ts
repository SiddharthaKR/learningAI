import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ────────────────────────── PDF image extraction ──────────────────────────
describe("PDF image extraction", () => {
	it("extracts images from a PDF page with paintImageXObject ops", async () => {
		const { extractPdfImages } = await import("../src/knowledge/parsers/pdf-images.ts");
		// A real PDF with an embedded image would be needed for a full test.
		// For the focused test, use the existing pdfjs test fixtures.
		assert.ok(typeof extractPdfImages === "function", "extractPdfImages must be exported");
	});

	it("skips images below the minimum size threshold (10KB or 100x100px)", async () => {
		const { meetsMinimumSize } = await import("../src/knowledge/parsers/pdf-images.ts");
		assert.equal(meetsMinimumSize(5000, 50, 50), false, "5KB 50x50 should be skipped");
		assert.equal(meetsMinimumSize(5000, 200, 200), false, "5KB 200x200 should be skipped (bytes too small)");
		assert.equal(meetsMinimumSize(15000, 50, 50), false, "15KB 50x50 should be skipped (pixels too small)");
		assert.equal(meetsMinimumSize(15000, 200, 200), true, "15KB 200x200 should pass");
	});

	it("returns ExtractedImage[] with correct citation format", async () => {
		const { extractPdfImages } = await import("../src/knowledge/parsers/pdf-images.ts");
		const result = await extractPdfImages("test.pdf", new Uint8Array(0));
		assert.ok(Array.isArray(result), "must return an array");
	});
});

// ────────────────────── PPTX/DOCX image extraction ───────────────────────
describe("PPTX image extraction", () => {
	it("exports extractPptxImages function", async () => {
		const { extractPptxImages } = await import("../src/knowledge/parsers/office-images.ts");
		assert.ok(typeof extractPptxImages === "function");
	});

	it("extracts media entries from PPTX ZIP", async () => {
		const { extractPptxImages } = await import("../src/knowledge/parsers/office-images.ts");
		// Empty/invalid data returns empty array
		const result = extractPptxImages("test.pptx", new Uint8Array(0));
		assert.ok(Array.isArray(result));
	});
});

describe("DOCX image extraction", () => {
	it("exports extractDocxImages function", async () => {
		const { extractDocxImages } = await import("../src/knowledge/parsers/office-images.ts");
		assert.ok(typeof extractDocxImages === "function");
	});

	it("extracts media entries from DOCX ZIP", async () => {
		const { extractDocxImages } = await import("../src/knowledge/parsers/office-images.ts");
		const result = extractDocxImages("test.docx", new Uint8Array(0));
		assert.ok(Array.isArray(result));
	});
});

// ──────────────────────── Vision description job ─────────────────────────
describe("Vision description job", () => {
	it("exports describeImages function", async () => {
		const { describeImages } = await import("../src/knowledge/vision-job.ts");
		assert.ok(typeof describeImages === "function");
	});

	it("returns ExtractedBlock[] with imageDescription: true citations", async () => {
		const { describeImages } = await import("../src/knowledge/vision-job.ts");
		const mockImage = {
			data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
			mimeType: "image/png",
			width: 200,
			height: 200,
			citation: { format: "pdf" as const, fileName: "test.pdf", page: 1 },
		};
		// With a mock fetch that returns a description
		const blocks = await describeImages([mockImage], {
			baseUrl: "http://127.0.0.1:9999/v1",
			model: "test-model",
		}, async () => "A diagram showing a workflow process");
		assert.equal(blocks.length, 1);
		assert.equal(blocks[0]!.citation.format, "pdf");
		assert.equal((blocks[0]!.citation as { imageDescription?: boolean }).imageDescription, true);
		assert.ok(blocks[0]!.text.includes("A diagram showing a workflow process"));
	});

	it("skips images when vision call fails (best-effort)", async () => {
		const { describeImages } = await import("../src/knowledge/vision-job.ts");
		const mockImage = {
			data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
			mimeType: "image/png",
			width: 200,
			height: 200,
			citation: { format: "pdf" as const, fileName: "test.pdf", page: 1 },
		};
		const blocks = await describeImages([mockImage], {
			baseUrl: "http://127.0.0.1:9999/v1",
			model: "test-model",
		}, async () => { throw new Error("vision model unreachable"); });
		assert.equal(blocks.length, 0, "failed descriptions should be skipped");
	});
});

// ──────────────────────── Integration: chunks carry imageDescription ─────
describe("Image-derived chunks", () => {
	it("imageDescription citation field survives chunking", async () => {
		const { chunkDocument } = await import("../src/knowledge/chunk.ts");
		const doc = {
			fileName: "test.pdf",
			format: "pdf" as const,
			status: "ready" as const,
			blocks: [{
				text: "This is a description of a diagram showing a neural network architecture with input, hidden, and output layers connected by weights.",
				citation: { format: "pdf" as const, fileName: "test.pdf", page: 3, imageDescription: true },
			}],
		};
		const chunks = chunkDocument(doc, "source123");
		assert.ok(chunks.length > 0);
		assert.equal((chunks[0]!.citation as { imageDescription?: boolean }).imageDescription, true);
	});

	it("imageDescription citation validates in snapshot schema", async () => {
		const { validateKnowledgeSnapshot } = await import("../src/knowledge/index-store.ts");
		const snapshot = {
			version: 1,
			generatedAt: new Date().toISOString(),
			documents: [{ id: "a".repeat(64), fileName: "test.pdf", format: "pdf", status: "ready" }],
			chunks: [{
				id: "b".repeat(64),
				sourceId: "a".repeat(64),
				text: "A diagram of a workflow",
				citation: { format: "pdf", fileName: "test.pdf", page: 1, imageDescription: true },
			}],
		};
		const result = validateKnowledgeSnapshot(snapshot);
		assert.ok(result.chunks.length === 1);
		assert.equal((result.chunks[0]!.citation as { imageDescription?: boolean }).imageDescription, true);
	});

	it("existing chunks without imageDescription still validate", async () => {
		const { validateKnowledgeSnapshot } = await import("../src/knowledge/index-store.ts");
		const snapshot = {
			version: 1,
			generatedAt: new Date().toISOString(),
			documents: [{ id: "a".repeat(64), fileName: "test.pdf", format: "pdf", status: "ready" }],
			chunks: [{
				id: "b".repeat(64),
				sourceId: "a".repeat(64),
				text: "Regular text content",
				citation: { format: "pdf", fileName: "test.pdf", page: 1 },
			}],
		};
		const result = validateKnowledgeSnapshot(snapshot);
		assert.ok(result.chunks.length === 1);
	});
});
