import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtractedDocument, KnowledgeChunk, KnowledgeCitation } from "../src/knowledge/contracts.ts";
import { tokenize } from "../src/knowledge/tokenize.ts";
import { chunkDocument } from "../src/knowledge/chunk.ts";
import { Bm25Retriever } from "../src/knowledge/bm25.ts";
import type { Retriever } from "../src/knowledge/retriever.ts";

const citation: KnowledgeCitation = { format: "pdf", fileName: "guide.pdf", page: 1 };
function document(text: string, blockCitation = citation): Extract<ExtractedDocument, { status: "ready" }> {
	return { fileName: "guide.pdf", format: "pdf", status: "ready", blocks: [{ text, citation: blockCitation }] };
}
function chunk(id: string, text: string): KnowledgeChunk {
	return { id, sourceId: "guide", text, citation };
}

describe("knowledge tokenization", () => {
	it("normalizes Latin words and digits without discarding term frequency", () => {
		assert.deepEqual(tokenize("Ｆｉｒｅ４２, CAFÉ; fire42 / café!"), ["fire42", "café", "fire42", "café"]);
	});
	it("emits CJK stream bigrams across punctuation and non-CJK text", () => {
		assert.deepEqual(tokenize("安全、あア 한글 A9"), ["a9", "安全", "全あ", "あア", "ア한", "한글"]);
		assert.deepEqual(tokenize("火"), ["火"]);
		assert.deepEqual(tokenize("𠀀火災"), ["𠀀火", "火災"]);
		assert.deepEqual(tokenize("！？"), []);
	});
});

describe("knowledge chunking", () => {
	it("hard-splits by Unicode code points with exactly 200 points of overlap", () => {
		const points = Array.from({ length: 2300 }, (_, index) => String.fromCodePoint(0x20000 + index));
		const chunks = chunkDocument(document(points.join("")), "source");
		assert.deepEqual(chunks.map((item) => Array.from(item.text).length), [1200, 1200, 300]);
		assert.deepEqual(chunks.map((item) => item.text), [points.slice(0, 1200).join(""), points.slice(1000, 2200).join(""), points.slice(2000).join("")]);
		assert.ok(chunks.every((item) => !/[\uD800-\uDFFF]/u.test(item.text)));
	});
	it("prefers the latest paragraph break over later newline and whitespace", () => {
		const text = `${"a".repeat(910)}\n\n${"b".repeat(38)}\n\n${"c".repeat(98)}\n${"d".repeat(49)} ${"e".repeat(400)}`;
		const chunks = chunkDocument(document(text), "source");
		assert.equal(chunks[0]!.text, text.slice(0, 952));
		assert.equal(chunks[1]!.text, text.slice(752));
	});
	for (const [name, separator] of [["newline", "\n"], ["whitespace", " "]] as const) {
		it(`prefers the last ${name} boundary in range`, () => {
			const text = `${"a".repeat(920)}${separator}${"b".repeat(179)}${separator}${"c".repeat(500)}`;
			const chunks = chunkDocument(document(text), "source");
			assert.equal(chunks[0]!.text, text.slice(0, 1101));
			assert.equal(chunks[1]!.text, text.slice(901));
		});
	}
	it("ignores boundaries below 900 points and emits no trailing overlap-only chunk", () => {
		const text = `${"a".repeat(898)} ${"b".repeat(301)}`;
		assert.deepEqual(chunkDocument(document(text), "source").map((item) => item.text), [text]);
		assert.equal(chunkDocument(document(`${text}c`), "source")[0]!.text, text);
	});
	it("preserves each citation and hashes source, canonical citation, ordinal, and text deterministically", () => {
		const input = document("repeat");
		input.blocks.push({ text: "repeat", citation: { format: "pdf", fileName: "guide.pdf", page: 2 } });
		const chunks = chunkDocument(input, "source");
		assert.equal(chunks.length, 2);
		assert.deepEqual(chunks.map((item) => item.citation), [citation, input.blocks[1]!.citation]);
		assert.deepEqual(chunkDocument(input, "source"), chunks);
		assert.ok(chunks.every((item) => /^[a-f0-9]{64}$/.test(item.id)));
		assert.equal(new Set(chunks.map((item) => item.id)).size, 2);
		assert.notEqual(chunkDocument(input, "other")[0]!.id, chunks[0]!.id);
		assert.notEqual(chunkDocument(document("changed"), "source")[0]!.id, chunks[0]!.id);
		const reordered = { page: 1, fileName: "guide.pdf", format: "pdf" } as KnowledgeCitation;
		assert.equal(chunkDocument(document("repeat", reordered), "source")[0]!.id, chunks[0]!.id);
	});
	it("retains repeated content at different positions with distinct IDs", () => {
		const chunks = chunkDocument(document("火".repeat(2200)), "source");
		assert.equal(chunks.length, 2);
		assert.equal(chunks[0]!.text, chunks[1]!.text);
		assert.notEqual(chunks[0]!.id, chunks[1]!.id);
	});
	it("skips blank blocks and no-text documents", () => {
		assert.deepEqual(chunkDocument(document(" \n\t"), "source"), []);
		assert.deepEqual(chunkDocument({ fileName: "scan.pdf", format: "pdf", status: "no_text_layer", blocks: [] }, "source"), []);
	});
});

describe("knowledge BM25 retrieval", () => {
	const japanese = chunk("ja", "火災時は避難経路を確認して安全な場所へ移動する。");
	const bilingual = chunk("mixed", "経費精算 expense reimbursement の申請手順");
	const unrelated = chunk("other", "Meeting rooms and video calls");
	const retriever: Retriever = new Bm25Retriever(() => [japanese, bilingual, unrelated]);
	it("finds Japanese-only content and retains its source and citation", async () => {
		const results = await retriever.search(["火災 避難経路"], "alice");
		assert.equal(results.length, 1);
		assert.deepEqual(results[0], { ...japanese, score: results[0]!.score });
		assert.ok(results[0]!.score > 0);
	});
	it("finds Japanese content through English plus Japanese query formulations", async () => {
		assert.deepEqual((await retriever.search(["fire evacuation route", "火災 避難経路"], "alice")).map((item) => item.id), ["ja"]);
	});
	it("finds a mixed chunk by either language and deduplicates repeated queries", async () => {
		const english = await retriever.search(["expense reimbursement"], "alice");
		const japaneseResults = await retriever.search(["経費精算"], "alice");
		assert.deepEqual(english.map((item) => item.id), ["mixed"]);
		assert.deepEqual(japaneseResults.map((item) => item.id), ["mixed"]);
		const merged = await retriever.search(["expense reimbursement", "経費精算", "expense reimbursement"], "alice");
		assert.deepEqual(merged.map((item) => item.id), ["mixed"]);
		assert.equal(merged[0]!.score, Math.max(english[0]!.score, japaneseResults[0]!.score));
	});
	it("uses standard positive IDF, term frequency, and length normalization", async () => {
		const ranked = await new Bm25Retriever(() => [chunk("a", "fire fire"), chunk("b", "fire safety"), chunk("c", "meeting")]).search(["fire"], "alice");
		assert.deepEqual(ranked.map((item) => item.id), ["a", "b"]);
		// N=3, df=2, average length=5/3; denominators are 3.38 and 2.38.
		assert.ok(Math.abs(ranked[0]!.score - Math.log(1.6) * 4.4 / 3.38) < 1e-12);
		assert.ok(Math.abs(ranked[1]!.score - Math.log(1.6) * 2.2 / 2.38) < 1e-12);
	});
	it("orders equal scores by ID and caps the merged results at eight", async () => {
		const chunks = Array.from({ length: 12 }, (_, index) => chunk(String(12 - index).padStart(2, "0"), index % 2 ? "fire" : "safety"));
		const results = await new Bm25Retriever(() => chunks).search(["fire", "safety"], "alice");
		assert.deepEqual(results.map((item) => item.id), ["01", "02", "03", "04", "05", "06", "07", "08"]);
	});
	it("passes the owner to an async loader on every search without leaking snapshots", async () => {
		const personal: Record<string, KnowledgeChunk[]> = { alice: [chunk("alice-only", "fire")], bob: [chunk("bob-only", "fire")] };
		const owners: string[] = [];
		const isolated = new Bm25Retriever(async (userId) => { owners.push(userId); return personal[userId] ?? []; });
		assert.deepEqual((await isolated.search(["fire"], "alice")).map((item) => item.id), ["alice-only"]);
		assert.deepEqual((await isolated.search(["fire"], "bob")).map((item) => item.id), ["bob-only"]);
		assert.deepEqual(await isolated.search(["fire"], "missing"), []);
		assert.deepEqual(owners, ["alice", "bob", "missing"]);
	});
	it("accepts four trimmed queries and excludes all zero-score chunks", async () => {
		assert.deepEqual(await retriever.search([" absent ", "elsewhere", "unknown", "!?"], "alice"), []);
		assert.deepEqual((await retriever.search([" expense ", "unknown", "elsewhere", "absent"], "alice")).map((item) => item.id), ["mixed"]);
		assert.deepEqual(await new Bm25Retriever(() => []).search(["fire"], "alice"), []);
	});
	for (const queries of [[], ["a", "b", "c", "d", "e"], [""], [" \n\t"], ["valid", " "], "fire", null, [42], ["valid", null], Array(1)]) {
		it(`rejects invalid queries ${JSON.stringify(queries)} before loading`, async () => {
			let loaded = false;
			const validated = new Bm25Retriever(() => { loaded = true; return []; });
			await assert.rejects(() => validated.search(queries as string[], "alice"), /queries.*1.*4.*non-empty strings/i);
			assert.equal(loaded, false);
		});
	}
});
