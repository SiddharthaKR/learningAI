import assert from "node:assert/strict";
import { it } from "node:test";
import type { KnowledgeChunk } from "../src/knowledge/contracts.ts";
import type { KnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import { buildKnowledgeMap, sectionText } from "../src/knowledge/map.ts";
import { MAX_SECTION_CHARS } from "../src/knowledge/map-contracts.ts";

const D1 = "1".repeat(64), D2 = "2".repeat(64), D3 = "3".repeat(64), D4 = "4".repeat(64);
let counter = 0;
function chunk(sourceId: string, fileName: string, text: string, section?: string[], ordinal?: number, page = 1): KnowledgeChunk {
	return { id: String(++counter).padStart(64, "0"), sourceId, text, citation: { format: "pdf", fileName, page }, ...(section ? { section } : {}), ...(ordinal === undefined ? {} : { ordinal }) };
}
const SEP = "\u001f";
function snapshot(): KnowledgeSnapshot {
	return {
		version: 1, generatedAt: "x",
		documents: [
			{ id: D1, fileName: "a.pdf", format: "pdf", status: "ready" },
			{ id: D2, fileName: "plain.pdf", format: "pdf", status: "ready" },
			{ id: D3, fileName: "scan.pdf", format: "pdf", status: "no_text_layer" },
			{ id: D4, fileName: "b.pdf", format: "pdf", status: "ready" },
		],
		chunks: [
			// Snapshot order deliberately differs from ordinal order.
			chunk(D1, "a.pdf", "second", ["Ch1", "Sec B"], 2, 3),
			chunk(D1, "a.pdf", "first", ["Ch1", "Sec A"], 0, 1),
			chunk(D1, "a.pdf", "third", ["Ch1", "Sec A"], 1, 2),
			chunk(D1, "a.pdf", "other", ["Ch2"], 3, 4),
			chunk(D2, "plain.pdf", "no sections here"),
			chunk(D4, "b.pdf", "b text", ["Only"], 0),
		],
	};
}

it("builds nested prefix nodes with hierarchy edges, counts and citations", () => {
	const map = buildKnowledgeMap(snapshot(), "shared");
	const ids = map.nodes.map((node) => node.id);
	assert.deepEqual(ids, [
		`shared:${D1}`, `shared:${D1}:Ch1`, `shared:${D1}:Ch1${SEP}Sec A`, `shared:${D1}:Ch1${SEP}Sec B`, `shared:${D1}:Ch2`,
		`shared:${D2}`, `shared:${D4}`, `shared:${D4}:Only`,
	]);
	assert.equal(new Set(ids).size, ids.length);
	const byId = new Map(map.nodes.map((node) => [node.id, node]));
	const ch1 = byId.get(`shared:${D1}:Ch1`)!;
	assert.equal(ch1.kind, "section");
	assert.equal(ch1.label, "Ch1");
	assert.equal(ch1.chunkCount, 3);
	assert.equal(ch1.citation?.format === "pdf" && ch1.citation.page, 1); // lowest ordinal (0) is on page 1
	const secA = byId.get(`shared:${D1}:Ch1${SEP}Sec A`)!;
	assert.deepEqual(secA.path, ["Ch1", "Sec A"]);
	assert.equal(secA.label, "Sec A");
	assert.equal(secA.chunkCount, 2);
	const secB = byId.get(`shared:${D1}:Ch1${SEP}Sec B`)!;
	assert.equal(secB.citation?.format === "pdf" && secB.citation.page, 3);
	assert.equal(byId.get(`shared:${D1}`)!.chunkCount, 4);
	assert.deepEqual(map.edges, [
		{ from: `shared:${D1}`, to: `shared:${D1}:Ch1` },
		{ from: `shared:${D1}:Ch1`, to: `shared:${D1}:Ch1${SEP}Sec A` },
		{ from: `shared:${D1}:Ch1`, to: `shared:${D1}:Ch1${SEP}Sec B` },
		{ from: `shared:${D1}`, to: `shared:${D1}:Ch2` },
		{ from: `shared:${D4}`, to: `shared:${D4}:Only` },
	]);
});

it("emits only a document node for section-less documents and skips non-ready ones", () => {
	const map = buildKnowledgeMap(snapshot(), "personal");
	const plain = map.nodes.filter((node) => node.documentId === D2);
	assert.equal(plain.length, 1);
	assert.equal(plain[0]!.kind, "document");
	assert.equal(plain[0]!.id, `personal:${D2}`);
	assert.equal(plain[0]!.chunkCount, 1);
	assert.ok(!map.nodes.some((node) => node.documentId === D3));
});

it("is deterministic", () => {
	assert.deepEqual(buildKnowledgeMap(snapshot(), "shared"), buildKnowledgeMap(snapshot(), "shared"));
});

it("sectionText: prefix match, whole document, ordering, null cases", () => {
	const snap = snapshot();
	const ch1 = sectionText(snap, "shared", D1, ["Ch1"])!;
	assert.equal(ch1.text, "first\nthird\nsecond");
	assert.equal(ch1.truncated, false);
	assert.equal(ch1.fileName, "a.pdf");
	assert.deepEqual(ch1.path, ["Ch1"]);
	assert.equal(ch1.citation?.format === "pdf" && ch1.citation.page, 1);
	assert.equal(sectionText(snap, "shared", D1, ["Ch1", "Sec B"])!.text, "second");
	assert.equal(sectionText(snap, "shared", D1, [])!.text, "first\nthird\nsecond\nother");
	assert.equal(sectionText(snap, "personal", D2, [])!.text, "no sections here");
	assert.equal(sectionText(snap, "shared", D1, ["Ch"]), null);
	assert.equal(sectionText(snap, "shared", D1, ["Nope"]), null);
	assert.equal(sectionText(snap, "shared", "9".repeat(64), []), null);
	assert.equal(sectionText(snap, "shared", D3, []), null);
});

it("sectionText merges overlapping chunks and truncates at the cap", () => {
	const overlap = "0123456789abcdefghijKLMNOP";
	const doc = [{ id: D1, fileName: "a.pdf", format: "pdf" as const, status: "ready" as const }];
	const merged = sectionText({
		version: 1, generatedAt: "x", documents: doc,
		chunks: [chunk(D1, "a.pdf", `head ${overlap}`, ["S"], 0), chunk(D1, "a.pdf", `${overlap} tail`, ["S"], 1)],
	}, "shared", D1, ["S"])!;
	assert.equal(merged.text, `head ${overlap} tail`);
	const big = sectionText({
		version: 1, generatedAt: "x", documents: doc,
		chunks: [chunk(D1, "a.pdf", "x".repeat(8000), ["S"], 0, 1), chunk(D1, "a.pdf", "y".repeat(8000), ["S"], 1, 2)],
	}, "shared", D1, ["S"])!;
	assert.equal(big.text.length, MAX_SECTION_CHARS);
	assert.equal(big.truncated, true);
});
