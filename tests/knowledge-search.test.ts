import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtractedDocument, KnowledgeChunk, KnowledgeCitation } from "../src/knowledge/contracts.ts";
import { chunkDocument } from "../src/knowledge/chunk.ts";
import { bm25Ranker, Bm25Retriever } from "../src/knowledge/bm25.ts";
import { KnowledgeSearch, type Ranker } from "../src/knowledge/search.ts";
import { validateKnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import { MAX_KNOWLEDGE_UPLOAD_BYTES, validateKnowledgeUpload } from "../src/knowledge/upload.ts";

const { formatCitation } = await import("../src/agent/tools/knowledge.ts");

const citation: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 1 };
function doc(blocks: Extract<ExtractedDocument, { status: "ready" }>["blocks"]): ExtractedDocument {
	return { fileName: "guide.pdf", format: "pdf", status: "ready", blocks };
}
const hex = (n: number) => n.toString(16).padStart(64, "0");

describe("chunker sections, tables and ordinals", () => {
	it("prefixes the section path and counts it toward the budget", () => {
		const chunks = chunkDocument(doc([{ text: "x".repeat(3000), citation, section: ["Chapter 5", "AXI Interface"] }]), "s");
		assert.ok(chunks.length > 1);
		for (const chunk of chunks) {
			assert.ok(chunk.text.startsWith("§ Chapter 5 › AXI Interface\n"));
			assert.ok(Array.from(chunk.text).length <= 1200);
			assert.deepEqual(chunk.section, ["Chapter 5", "AXI Interface"]);
		}
	});
	it("adds no prefix or section without a section path", () => {
		const [chunk] = chunkDocument(doc([{ text: "plain", citation }]), "s");
		assert.equal(chunk!.text, "plain");
		assert.equal("section" in chunk!, false);
	});
	it("keeps a table of at most 4000 points whole", () => {
		const table = Array.from({ length: 100 }, (_, i) => `row${i} | ${"c".repeat(30)}`).join("\n");
		assert.ok(table.length <= 4000 && table.length > 1200);
		const chunks = chunkDocument(doc([{ text: table, citation, kind: "table", section: ["T"] }]), "s");
		assert.equal(chunks.length, 1);
		assert.equal(chunks[0]!.text, `§ T\n${table}`);
	});
	it("splits an oversized table only at row boundaries and repeats the prefix", () => {
		const rows = Array.from({ length: 200 }, (_, i) => `row${String(i).padStart(3, "0")} | ${"c".repeat(40)}`);
		const chunks = chunkDocument(doc([{ text: rows.join("\n"), citation, kind: "table", section: ["T"] }]), "s");
		assert.ok(chunks.length > 1);
		const seen: string[] = [];
		for (const chunk of chunks) {
			assert.ok(chunk.text.startsWith("§ T\n"));
			assert.ok(Array.from(chunk.text).length <= 4000);
			seen.push(...chunk.text.slice(4).split("\n"));
		}
		assert.deepEqual(seen, rows);
	});
	it("numbers chunks with a running 0-based ordinal across blocks", () => {
		const chunks = chunkDocument(doc([{ text: "a".repeat(2000), citation }, { text: "b", citation: { ...citation, page: 2 } }]), "s");
		assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i));
	});
	it("includes the section in the id hash", () => {
		const a = chunkDocument(doc([{ text: "same", citation, section: ["A"] }]), "s")[0]!;
		const b = chunkDocument(doc([{ text: "same", citation, section: ["B"] }]), "s")[0]!;
		assert.notEqual(a.id, b.id);
	});
});

describe("snapshot schema", () => {
	const base = (chunk: Record<string, unknown>) => ({
		version: 1, generatedAt: "t",
		documents: [{ id: hex(1), fileName: "guide.pdf", format: "pdf", status: "ready" }],
		chunks: [{ id: hex(2), sourceId: hex(1), text: "t", citation, ...chunk }],
	});
	it("accepts old-shape chunks without section/ordinal/ocr", () => {
		assert.equal(validateKnowledgeSnapshot(base({})).chunks.length, 1);
	});
	it("accepts section, ordinal and pdf ocr; rejects bad ordinals", () => {
		assert.doesNotThrow(() => validateKnowledgeSnapshot(base({ section: ["A"], ordinal: 0, citation: { ...citation, ocr: true } })));
		assert.throws(() => validateKnowledgeSnapshot(base({ ordinal: -1 })));
		assert.throws(() => validateKnowledgeSnapshot(base({ ordinal: 1.5 })));
	});
});

function chunkOf(id: string, text: string, ordinal?: number, extra: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
	const chunk: KnowledgeChunk = { id, sourceId: "src", text, citation, ...extra };
	if (ordinal !== undefined) chunk.ordinal = ordinal;
	return chunk;
}

describe("KnowledgeSearch", () => {
	const fixtures = [chunkOf("a", "fire fire"), chunkOf("b", "fire safety"), chunkOf("c", "meeting"), chunkOf("d", "safety drill fire")];
	it("ranks identically to the BM25 retriever on chunks without ordinals", async () => {
		const legacy = await new Bm25Retriever(() => fixtures).search(["fire", "safety"], "u");
		const search = await new KnowledgeSearch(() => fixtures, [bm25Ranker]).search(["fire", "safety"], "u");
		assert.deepEqual(search, legacy);
		const scores = bm25Ranker.rank(["fire", "safety"], fixtures);
		assert.deepEqual(search.map((r) => [r.id, r.score]), [...scores].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([id, s]) => [id, s]));
	});
	it("validates queries with the original error", async () => {
		const s = new KnowledgeSearch(() => fixtures, [bm25Ranker]);
		await assert.rejects(s.search([], "u"), /queries must be an array of 1–4 non-empty strings/);
		await assert.rejects(s.search(["ok", " "], "u"), /queries must be an array/);
	});
	it("fuses several rankers with reciprocal rank fusion", async () => {
		const first: Ranker = { rank: () => new Map([["a", 3], ["b", 2]]) };
		const second: Ranker = { rank: () => new Map([["b", 9], ["c", 1]]) };
		const results = await new KnowledgeSearch(() => fixtures, [first, second]).search(["q"], "u");
		assert.deepEqual(results.map((r) => r.id), ["b", "a", "c"]);
		assert.ok(Math.abs(results[0]!.score - (1 / 62 + 1 / 61)) < 1e-12);
	});
	it("merges prev+hit+next in reading order with overlap and repeated section lines removed", async () => {
		const full = Array.from({ length: 90 }, (_, i) => `w${String(i).padStart(2, "0")}`).join(" ");
		const c0 = full.slice(0, 200), c1 = full.slice(150, 350), c2 = full.slice(300);
		const section = ["Sec"];
		const chunks = [
			chunkOf("c0", `§ Sec\n${c0}`, 0, { section }),
			chunkOf("c1", `§ Sec\n${c1} unique`, 1, { section }),
			chunkOf("c2", `§ Sec\n${c1.slice(-50)} unique${c2.slice(50)}`, 2, { section }),
			chunkOf("zz", "elsewhere", 7),
		];
		const only: Ranker = { rank: () => new Map([["c1", 5]]) };
		const [result] = await new KnowledgeSearch(() => chunks, [only]).search(["q"], "u");
		assert.equal(result!.id, "c1");
		assert.equal(result!.score, 5);
		assert.deepEqual(result!.section, section);
		assert.equal(result!.text, `§ Sec\n${c0}${c1.slice(c0.length - 150)} unique${c2.slice(50)}`);
		assert.equal(result!.text.split("§ Sec").length, 2);
	});
	it("merges adjacent hits of one source into a single result with the best score and best-scoring hit's citation", async () => {
		const early: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 1 };
		const late: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 2 };
		const chunks = [0, 1, 2, 3, 4, 5].map((i) => chunkOf(`k${i}`, `block ${i} text`, i, { citation: i < 3 ? early : late }));
		const ranker: Ranker = { rank: () => new Map([["k1", 2], ["k3", 7], ["k5", 1]]) };
		const results = await new KnowledgeSearch(() => chunks, [ranker]).search(["q"], "u");
		// SAME PAGE ONLY (owner, 2026-11-24): page 1 and page 2 stay separate results.
		assert.equal(results.length, 2);
		assert.equal(results[0]!.id, "k3");
		assert.equal(results[0]!.score, 7);
		assert.deepEqual(results[0]!.citation, late);
		assert.equal(results[0]!.text, "block 3 text\nblock 4 text\nblock 5 text");
		assert.equal(results[1]!.id, "k1");
		assert.deepEqual(results[1]!.citation, early);
		assert.equal(results[1]!.text, "block 0 text\nblock 1 text\nblock 2 text");
	});
	it("never merges a neighbor from another page under the hit's citation", async () => {
		const page1: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 1 };
		const page2: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 2 };
		const chunks = [chunkOf("a", "intro text", 0, { citation: page1 }), chunkOf("b", "unique fact 73921", 1, { citation: page2 })];
		const ranker: Ranker = { rank: () => new Map([["a", 3]]) };
		const results = await new KnowledgeSearch(() => chunks, [ranker]).search(["q"], "u");
		assert.equal(results.length, 1);
		assert.deepEqual(results[0]!.citation, page1);
		assert.ok(!results[0]!.text.includes("73921"), "page-2 text must not appear under the page-1 citation");
	});
	it("keeps an image description separate from the page text, and widens MD line spans", async () => {
		const text: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 4 };
		const image: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 4, imageDescription: true };
		const pdf = [chunkOf("t", "page text", 0, { citation: text }), chunkOf("i", "diagram description", 1, { citation: image })];
		const pdfResults = await new KnowledgeSearch(() => pdf, [{ rank: () => new Map([["t", 1]]) }]).search(["q"], "u");
		assert.equal(pdfResults[0]!.text, "page text");
		const md = [1, 2, 3].map((i) => chunkOf(`m${i}`, `line ${i}`, i - 1, { citation: { format: "md", fileName: "n.md", heading: "H", lineStart: i * 10, lineEnd: i * 10 + 5 } }));
		const mdResults = await new KnowledgeSearch(() => md, [{ rank: () => new Map([["m2", 1]]) }]).search(["q"], "u");
		assert.deepEqual(mdResults[0]!.citation, { format: "md", fileName: "n.md", heading: "H", lineStart: 10, lineEnd: 35 });
	});
	it("returns hits without ordinals unchanged", async () => {
		const results = await new KnowledgeSearch(() => [chunkOf("old", "legacy fire", undefined), chunkOf("n", "other", 1)], [bm25Ranker]).search(["fire"], "u");
		assert.equal(results.length, 1);
		assert.deepEqual(results[0], { ...chunkOf("old", "legacy fire"), score: results[0]!.score });
	});
});

describe("tool citation display and upload cap", () => {
	const result = (c: KnowledgeCitation, section?: string[]) => ({ ...chunkOf("x", "t", 0, section ? { section } : {}), citation: c, score: 1 });
	it("shows the section path and marks OCR", () => {
		assert.equal(formatCitation(result({ format: "pdf", fileName: "file.pdf", page: 12 }, ["Chapter 5", "AXI Interface"])), "[file.pdf, page 12, §Chapter 5 › AXI Interface]");
		assert.equal(formatCitation(result({ format: "pdf", fileName: "file.pdf", page: 3, ocr: true })), "[file.pdf, page 3] (OCR, verify exact numbers)");
		assert.equal(formatCitation(result({ format: "pdf", fileName: "file.pdf", page: 1 })), "[file.pdf, page 1]");
	});
	it("allows exactly 100 MiB", () => {
		assert.equal(MAX_KNOWLEDGE_UPLOAD_BYTES, 104_857_600);
		assert.equal(validateKnowledgeUpload("a.txt", MAX_KNOWLEDGE_UPLOAD_BYTES), "txt");
		assert.throws(() => validateKnowledgeUpload("a.txt", MAX_KNOWLEDGE_UPLOAD_BYTES + 1), /too_large/);
	});
});
