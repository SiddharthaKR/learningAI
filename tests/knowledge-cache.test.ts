import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { PATHS } from "../config.ts";
import { KnowledgeCache, PERSONAL_IDLE_TTL_MS } from "../src/knowledge/cache.ts";
import { bm25Ranker } from "../src/knowledge/bm25.ts";
import type { KnowledgeChunk } from "../src/knowledge/contracts.ts";
import { tokenize } from "../src/knowledge/tokenize.ts";
import { writeKnowledgeSnapshotAtomic } from "../src/knowledge/index-store.ts";
import { KnowledgeSearch, type Ranker } from "../src/knowledge/search.ts";
import { indexKnowledgeDocument, loadKnowledgeChunks, loadKnowledgeParts } from "../src/knowledge/service.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { checkedStoresForUser, sharedKnowledgeStore } from "../src/server/stores.ts";

const text = (value: string) => new TextEncoder().encode(value);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "lh-kcache-"));

async function writeStore(file: string, docs: Record<string, string>): Promise<void> {
	const documents = [];
	const chunks = [];
	for (const [fileName, body] of Object.entries(docs)) {
		const indexed = await indexKnowledgeDocument({ fileName, data: text(body) });
		documents.push(indexed.document);
		chunks.push(...indexed.chunks);
	}
	await writeKnowledgeSnapshotAtomic(file, { version: 1, generatedAt: new Date().toISOString(), documents, chunks });
}

/** bm25 wrapper that counts prepare() calls. */
function counting(): { ranker: Ranker; prepares: () => number } {
	let count = 0;
	return {
		ranker: { ...bm25Ranker, prepare: (chunks) => { count++; return bm25Ranker.prepare!(chunks); } },
		prepares: () => count,
	};
}

/** Verbatim copy of the pre-cache BM25 implementation, used as the reference. */
function legacyBm25(queries: string[], chunks: KnowledgeChunk[]): Map<string, number> {
	const scores = new Map<string, number>();
	if (!chunks.length) return scores;
	const documentFrequency = new Map<string, number>();
	let totalLength = 0;
	const documents = chunks.map((chunk) => {
		const tokens = tokenize(chunk.text);
		const frequencies = new Map<string, number>();
		for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
		for (const token of frequencies.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
		totalLength += tokens.length;
		return { chunk, frequencies, length: tokens.length };
	});
	if (!totalLength) return scores;
	const averageLength = totalLength / chunks.length;
	for (const query of queries) {
		const terms = tokenize(query);
		for (const document of documents) {
			let score = 0;
			for (const term of terms) {
				const frequency = document.frequencies.get(term) ?? 0;
				if (!frequency) continue;
				const df = documentFrequency.get(term)!;
				const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
				score += idf * frequency * (1.2 + 1) / (frequency + 1.2 * (1 - 0.75 + 0.75 * document.length / averageLength));
			}
			if (score > 0 && score > (scores.get(document.chunk.id) ?? 0)) scores.set(document.chunk.id, score);
		}
	}
	return scores;
}

const CORPUS = {
	admin: { "a1.txt": "fire safety evacuation plan for the office building\n\nfire drill every month", "a2.txt": "network switch configuration guide with vlan and routing" },
	shared: { "s1.txt": "fire extinguisher inspection checklist\n\nsafety equipment and fire alarm test", "s2.txt": "quantum optics photon coherence and fire of lasers" },
	personal: { "p1.txt": "my notes about evacuation routes and personal safety\n\nfire fire fire", "p2.txt": "grocery list eggs milk bread" },
};

describe("cached BM25 equals uncached BM25 across stores", () => {
	it("gives identical scores and search results over admin + shared + personal", async () => {
		const dir = tmp();
		const files = { admin: path.join(dir, "admin.json"), shared: path.join(dir, "shared.json"), personal: path.join(dir, "personal.json") };
		for (const key of ["admin", "shared", "personal"] as const) await writeStore(files[key], CORPUS[key]);
		const cache = new KnowledgeCache();
		const parts = [await cache.get(files.admin, "shared"), await cache.get(files.shared, "shared"), await cache.get(files.personal, "personal")].map((s) => s.part);
		const flat = parts.flatMap((p) => p.chunks);
		for (const queries of [["fire"], ["fire safety", "evacuation"], ["vlan routing", "photon", "fire fire"], ["absent-term"]]) {
			const uncached = legacyBm25(queries, flat);
			const prepared = bm25Ranker.combine!(parts.map((p) => p.prepared!(bm25Ranker)));
			const cached = bm25Ranker.rank(queries, flat, prepared);
			assert.deepEqual([...cached], [...uncached], JSON.stringify(queries));
			const viaCache = await new KnowledgeSearch(() => ({ parts }), [bm25Ranker]).search(queries, "u");
			const viaFlat = await new KnowledgeSearch(() => flat, [bm25Ranker]).search(queries, "u");
			assert.deepEqual(viaCache, viaFlat);
		}
		// corpus stats are over the COMBINED set: a subset of stores scores differently from the full set.
		const subset = parts.slice(0, 2);
		const subsetScores = bm25Ranker.rank(["fire"], subset.flatMap((p) => p.chunks), bm25Ranker.combine!(subset.map((p) => p.prepared!(bm25Ranker))));
		assert.deepEqual([...subsetScores], [...legacyBm25(["fire"], subset.flatMap((p) => p.chunks))]);
	});
});

describe("knowledge cache", () => {
	it("hit avoids re-reading and re-preparing", async () => {
		const dir = tmp();
		const file = path.join(dir, "i.json");
		await writeStore(file, CORPUS.admin);
		const cache = new KnowledgeCache();
		const { ranker, prepares } = counting();
		const search = new KnowledgeSearch(async () => ({ parts: [(await cache.get(file, "shared")).part] }), [ranker]);
		const first = await search.search(["fire"], "u");
		assert.ok(first.length > 0);
		await search.search(["evacuation"], "u");
		await search.search(["fire", "vlan"], "u");
		assert.equal(cache.reads, 1);
		assert.equal(prepares(), 1);
	});

	it("a revision change invalidates only that store", async () => {
		const dir = tmp();
		const a = path.join(dir, "a.json");
		const b = path.join(dir, "b.json");
		await writeStore(a, CORPUS.admin);
		await writeStore(b, CORPUS.shared);
		const cache = new KnowledgeCache();
		const { ranker, prepares } = counting();
		const run = async () => new KnowledgeSearch(async () => ({ parts: [(await cache.get(a, "shared")).part, (await cache.get(b, "shared")).part] }), [ranker]).search(["fire"], "u");
		await run();
		assert.deepEqual([cache.reads, prepares()], [2, 2]);
		await writeStore(b, { ...CORPUS.shared, "s3.txt": "brand new fire document uploaded later" });
		const after = await run();
		assert.deepEqual([cache.reads, prepares()], [3, 3]);
		assert.ok(after.some((r) => r.citation.fileName === "s3.txt"));
		await run();
		assert.deepEqual([cache.reads, prepares()], [3, 3]);
		// delete = a different revision as well
		await writeStore(b, CORPUS.shared);
		assert.ok(!(await run()).some((r) => r.citation.fileName === "s3.txt"));
		assert.deepEqual([cache.reads, prepares()], [4, 4]);
	});

	it("missing index files are an empty store, then picked up when created", async () => {
		const file = path.join(tmp(), "later.json");
		const cache = new KnowledgeCache();
		assert.equal((await cache.get(file, "shared")).part.chunks.length, 0);
		await writeStore(file, CORPUS.admin);
		assert.ok((await cache.get(file, "shared")).part.chunks.length > 0);
	});

	it("evicts idle personal entries after 30 minutes, never shared ones", async () => {
		const dir = tmp();
		const personal = path.join(dir, "p.json");
		const shared = path.join(dir, "s.json");
		await writeStore(personal, CORPUS.personal);
		await writeStore(shared, CORPUS.shared);
		let now = 1_000_000;
		const cache = new KnowledgeCache({ now: () => now });
		await cache.get(personal, "personal");
		await cache.get(shared, "shared");
		now += PERSONAL_IDLE_TTL_MS - 1000;
		await cache.get(shared, "shared");
		assert.ok(cache.has(personal));
		await cache.get(personal, "personal"); // touch resets the idle clock
		now += PERSONAL_IDLE_TTL_MS - 1000;
		await cache.get(shared, "shared");
		assert.ok(cache.has(personal));
		now += PERSONAL_IDLE_TTL_MS + 1;
		await cache.get(shared, "shared");
		assert.ok(!cache.has(personal));
		assert.ok(cache.has(shared));
		const reads = cache.reads;
		await cache.get(personal, "personal");
		assert.equal(cache.reads, reads + 1);
	});
});

describe("cache with real stores", () => {
	let a: Account;
	let b: Account;
	before(async () => {
		delete process.env.LH_TEST_USER_ID;
		const accounts = createAccountStore(PATHS.data);
		a = await accounts.create("kcache-a", "correct horse battery staple", "en");
		b = await accounts.create("kcache-b", "correct horse battery staple", "en");
		await checkedStoresForUser(a.id).knowledgeStore.uploadDocument({ fileName: "kc-mine.md", data: text("# Top\n\nalpha secret notes\n") });
		await checkedStoresForUser(b.id).knowledgeStore.uploadDocument({ fileName: "kc-theirs.md", data: text("# Top\n\nbeta private notes\n") });
		await sharedKnowledgeStore.uploadDocument({ fileName: "kc-shared.md", data: text("# Top\n\ngamma shared notes\n") });
	});
	const names = (chunks: { citation: { fileName: string } }[]) => chunks.map((c) => c.citation.fileName).sort();

	it("scope filtering is unchanged with the cache, and users never see each other's cache", async () => {
		const cache = new KnowledgeCache();
		for (let round = 0; round < 2; round++) {
			assert.deepEqual(names(await loadKnowledgeChunks(a.id, { cache, scope: "personal" })), ["kc-mine.md"]);
			assert.deepEqual(names(await loadKnowledgeChunks(a.id, { cache, scope: "shared" })), ["kc-shared.md"]);
			assert.deepEqual(names(await loadKnowledgeChunks(a.id, { cache })), ["kc-mine.md", "kc-shared.md"]);
			assert.deepEqual(names(await loadKnowledgeChunks(b.id, { cache, scope: "personal" })), ["kc-theirs.md"]);
			assert.deepEqual(names(await loadKnowledgeChunks(b.id, { cache })), ["kc-shared.md", "kc-theirs.md"]);
		}
		const scoped = new KnowledgeSearch(async (u) => ({ parts: await loadKnowledgeParts(u, { cache }) }), [bm25Ranker]);
		assert.equal((await scoped.search(["secret"], b.id)).length, 0);
		assert.equal((await scoped.search(["secret"], a.id)).length, 1);
		assert.equal((await scoped.search(["private"], a.id)).length, 0);
	});

	it("an upload invalidates only the store written", async () => {
		const cache = new KnowledgeCache();
		await loadKnowledgeChunks(a.id, { cache });
		await loadKnowledgeChunks(b.id, { cache });
		const reads = cache.reads;
		await loadKnowledgeChunks(a.id, { cache });
		assert.equal(cache.reads, reads);
		await checkedStoresForUser(a.id).knowledgeStore.uploadDocument({ fileName: "kc-mine2.md", data: text("# Top\n\ndelta fresh upload\n") });
		assert.ok(names(await loadKnowledgeChunks(a.id, { cache })).includes("kc-mine2.md"));
		assert.equal(cache.reads, reads + 1); // a's personal only; shared and b untouched
		await loadKnowledgeChunks(b.id, { cache });
		assert.equal(cache.reads, reads + 1);
	});
});
