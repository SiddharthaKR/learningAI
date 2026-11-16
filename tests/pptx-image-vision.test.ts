/**
 * PPTX picture reading: pictures placed on slides are described by a vision
 * model and indexed as text under their slide. A failing picture never fails
 * the document; it is reported by slide so the UI can tell the user.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { officeZip, slideXml } from "./fixtures/knowledge/builders.ts";
import { extractPptxImages } from "../src/knowledge/parsers/office-images.ts";
import { describeImagesReport, visionConfigFromEnv, MAX_DESCRIBED_IMAGES } from "../src/knowledge/vision-job.ts";
import { indexKnowledgeDocument } from "../src/knowledge/service.ts";
import { validateKnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import type { ExtractedImage } from "../src/knowledge/contracts.ts";

/** A PNG the extractor accepts: valid IHDR (200×200) padded past the 10 KB floor. */
function png(seed: number): Uint8Array {
	const bytes = new Uint8Array(12_000);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, 200);
	view.setUint32(20, 200);
	bytes[100] = seed; // distinct content per picture
	return bytes;
}
const rels = (...targets: string[]) =>
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets.map((t, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${t}"/>`).join("")}</Relationships>`;

/** Slide 1: logo (also on slide 3). Slide 2: diagram. Template background: on no slide. */
function deck(): Uint8Array {
	return officeZip({
		"ppt/slides/slide1.xml": slideXml(["Intro", "Welcome"]),
		"ppt/slides/slide2.xml": slideXml(["Timing", "See the diagram"]),
		"ppt/slides/slide3.xml": slideXml(["Summary", "Done"]),
		"ppt/slides/_rels/slide1.xml.rels": rels("../media/logo.png"),
		"ppt/slides/_rels/slide2.xml.rels": rels("../media/diagram.png"),
		"ppt/slides/_rels/slide3.xml.rels": rels("../media/logo.png"),
		"ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels("../media/background.png"),
		"ppt/media/logo.png": png(1),
		"ppt/media/diagram.png": png(2),
		"ppt/media/background.png": png(3),
	});
}

function image(slide: number, seed: number): ExtractedImage {
	return { data: png(seed), mimeType: "image/png", width: 200, height: 200, citation: { format: "pptx", fileName: "d.pptx", slide, title: "" } };
}

describe("extractPptxImages", () => {
	it("keeps only pictures placed on slides, labels a reused picture with its first slide, in slide order", () => {
		const images = extractPptxImages("d.pptx", deck());
		assert.deepEqual(images.map((i) => (i.citation as { slide: number }).slide), [1, 2]);
		assert.equal(images.length, 2, "the template-only background is not a slide picture");
	});
});

describe("describeImagesReport", () => {
	it("describes each unique picture once and keeps input order", async () => {
		const calls: number[] = [];
		const report = await describeImagesReport([image(1, 1), image(2, 2), image(4, 1)], { baseUrl: "http://x/v1", model: "m" }, {
			callFn: async (b64) => { calls.push(b64.length); return `picture ${calls.length}`; },
		});
		assert.equal(calls.length, 2, "identical bytes on slide 4 reuse slide 1's description");
		assert.deepEqual(report.blocks.map((b) => (b.citation as { slide: number }).slide), [1, 2]);
		assert.deepEqual(report.failedSlides, []);
		assert.equal(report.described, 2);
		assert.equal(report.skipped, 0);
	});

	it("reports failing pictures by slide and still returns the others", async () => {
		const report = await describeImagesReport([image(1, 1), image(3, 2), image(5, 3)], { baseUrl: "http://x/v1", model: "m" }, {
			callFn: async (b64) => { if (b64 === Buffer.from(png(2)).toString("base64")) throw new Error("proxy dropped image"); return "ok"; },
		});
		assert.deepEqual(report.failedSlides, [3]);
		assert.equal(report.blocks.length, 2);
	});

	it("treats an empty answer as a failure", async () => {
		const report = await describeImagesReport([image(2, 1)], { baseUrl: "http://x/v1", model: "m" }, { callFn: async () => "   " });
		assert.deepEqual(report.failedSlides, [2]);
	});

	it(`caps at ${MAX_DESCRIBED_IMAGES} pictures and counts the rest as skipped`, async () => {
		const many = Array.from({ length: MAX_DESCRIBED_IMAGES + 5 }, (_, i) => image(i + 1, i + 1));
		let calls = 0;
		const report = await describeImagesReport(many, { baseUrl: "http://x/v1", model: "m" }, { callFn: async () => { calls++; return "d"; } });
		assert.equal(calls, MAX_DESCRIBED_IMAGES);
		assert.equal(report.skipped, 5);
	});

	it("runs every model call through the shared slot and in parallel", async () => {
		let inSlot = 0;
		let maxConcurrent = 0;
		let active = 0;
		const report = await describeImagesReport([image(1, 1), image(2, 2), image(3, 3)], { baseUrl: "http://x/v1", model: "m" }, {
			runSlot: async (fn) => { inSlot++; return fn(); },
			callFn: async () => { active++; maxConcurrent = Math.max(maxConcurrent, active); await new Promise((r) => setTimeout(r, 10)); active--; return "d"; },
		});
		assert.equal(inSlot, 3);
		assert.ok(maxConcurrent > 1, "calls overlap; the slot owner bounds them");
		assert.equal(report.described, 3);
	});
});

describe("indexKnowledgeDocument with vision", () => {
	it("adds picture chunks under the right slide, valid in a snapshot, and reports nothing failed", async () => {
		const indexed = await indexKnowledgeDocument({ fileName: "d.pptx", data: deck(), vision: { config: { baseUrl: "http://x/v1", model: "m" }, callFn: async () => "A timing diagram with clock and data lines" } });
		const pictures = indexed.chunks.filter((c) => (c.citation as { imageDescription?: boolean }).imageDescription);
		assert.equal(pictures.length, 2);
		assert.ok(pictures.every((c) => c.sourceId === indexed.document.id));
		const slide2 = pictures.find((c) => (c.citation as { slide: number }).slide === 2)!;
		assert.equal((slide2.citation as { title: string }).title, "Timing", "inherits the slide's title");
		const slide2Text = indexed.chunks.findIndex((c) => (c.citation as { slide: number }).slide === 2 && !(c.citation as { imageDescription?: boolean }).imageDescription);
		assert.equal(indexed.chunks.indexOf(slide2), slide2Text + 1, "the picture follows its slide's text");
		validateKnowledgeSnapshot({ version: 1, generatedAt: new Date().toISOString(), documents: [indexed.document], chunks: indexed.chunks });
		assert.deepEqual(indexed.imageReport, { described: 2, failedSlides: [], skipped: 0 });
	});

	it("keeps the document ready when every picture fails, and reports the slides", async () => {
		const indexed = await indexKnowledgeDocument({ fileName: "d.pptx", data: deck(), vision: { config: { baseUrl: "http://x/v1", model: "m" }, callFn: async () => { throw new Error("vision down"); } } });
		assert.equal(indexed.document.status, "ready");
		assert.ok(indexed.chunks.length > 0, "slide text is still indexed");
		assert.deepEqual(indexed.imageReport, { described: 0, failedSlides: [1, 2], skipped: 0 });
	});

	it("without vision: text only and no report (today's behaviour)", async () => {
		const indexed = await indexKnowledgeDocument({ fileName: "d.pptx", data: deck() });
		assert.ok(indexed.chunks.every((c) => !(c.citation as { imageDescription?: boolean }).imageDescription));
		assert.equal(indexed.imageReport, undefined);
	});
});

describe("vision HTTP call", () => {
	async function stub(handler: (body: Record<string, unknown>) => { status: number; content?: string }) {
		const { createServer } = await import("node:http");
		const bodies: Record<string, unknown>[] = [];
		const server = createServer((request, response) => {
			let raw = "";
			request.on("data", (chunk) => { raw += chunk; });
			request.on("end", () => {
				const body = JSON.parse(raw) as Record<string, unknown>;
				bodies.push(body);
				const { status, content } = handler(body);
				response.writeHead(status, { "content-type": "application/json" });
				response.end(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : JSON.stringify({ error: "unsupported parameter" }));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;
		return { bodies, baseUrl: `http://127.0.0.1:${port}/v1`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
	}

	it("asks the model not to think, so reasoning cannot use up the answer", async () => {
		const server = await stub(() => ({ status: 200, content: "A diagram" }));
		try {
			const report = await describeImagesReport([image(1, 1)], { baseUrl: server.baseUrl, model: "m" });
			assert.equal(report.described, 1);
			assert.equal(server.bodies[0]!.reasoning_effort, "none");
		} finally { await server.close(); }
	});

	it("retries once without reasoning_effort when the server rejects it, with room for thinking", async () => {
		const server = await stub((body) => body.reasoning_effort ? { status: 400 } : { status: 200, content: "A diagram" });
		try {
			const report = await describeImagesReport([image(1, 1)], { baseUrl: server.baseUrl, model: "m" });
			assert.equal(report.described, 1);
			assert.equal(server.bodies.length, 2);
			assert.equal(server.bodies[1]!.reasoning_effort, undefined);
			assert.ok((server.bodies[1]!.max_tokens as number) >= 2048);
		} finally { await server.close(); }
	});
});

describe("visionConfigFromEnv", () => {
	const base = { LLM_BASE_URL: "http://127.0.0.1:8088/v1", LLM_MODEL: "gemma-4-26b", LLM_API_KEY: "" };
	it("prefers VISION_BASE_URL + VISION_MODEL", () => {
		assert.deepEqual(visionConfigFromEnv({ ...base, LLM_VISION: "true", VISION_BASE_URL: "http://v/v1/", VISION_MODEL: "vis", VISION_API_KEY: "k" }), { baseUrl: "http://v/v1", model: "vis", apiKey: "k" });
	});
	it("falls back to the main model when LLM_VISION=true", () => {
		assert.deepEqual(visionConfigFromEnv({ ...base, LLM_VISION: "true" }), { baseUrl: "http://127.0.0.1:8088/v1", model: "gemma-4-26b" });
	});
	it("is off when neither is set, or only half of VISION_* is set without LLM_VISION", () => {
		assert.equal(visionConfigFromEnv({ ...base, LLM_VISION: "false" }), undefined);
		assert.equal(visionConfigFromEnv({ ...base, LLM_VISION: "false", VISION_BASE_URL: "http://v/v1" }), undefined);
	});
});
