import assert from "node:assert/strict";
import { after, it } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { readKnowledgeSnapshot, validateKnowledgeSnapshot, writeKnowledgeSnapshotAtomic, type KnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import { indexKnowledgeDocument, loadKnowledgeChunks } from "../src/knowledge/service.ts";
import { indexSharedKnowledge, runIndexShared } from "../scripts/index-shared.ts";
import { Bm25Retriever } from "../src/knowledge/bm25.ts";
import { pdfFixture } from "./fixtures/knowledge/builders.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "lh-knowledge-index-"));
after(async () => { await rm(root, { recursive: true, force: true }); });
const id = "a".repeat(64);
const chunkId = "b".repeat(64);
function snapshot(text = "fire safety"): KnowledgeSnapshot {
	return { version: 1, generatedAt: "2026-11-05T00:00:00.000Z", documents: [{ id, fileName: "guide.txt", format: "txt", status: "ready" }], chunks: [{ id: chunkId, sourceId: id, text, citation: { format: "txt", fileName: "guide.txt", lineStart: 1, lineEnd: 1 } }] };
}

it("missing read returns a fresh frozen empty v1 snapshot without creating files", async () => {
	const file = path.join(root, "missing", "index.json");
	const first = await readKnowledgeSnapshot(file);
	assert.equal(first.version, 1);
	assert.deepEqual(first.documents, []);
	assert.deepEqual(first.chunks, []);
	assert.ok(Object.isFrozen(first) && Object.isFrozen(first.chunks));
	assert.notEqual(first, await readKnowledgeSnapshot(file));
	await assert.rejects(stat(path.dirname(file)), { code: "ENOENT" });
});

it("validates fresh deeply immutable snapshots and every citation variant", () => {
	const input = snapshot();
	const validated = validateKnowledgeSnapshot(input);
	input.chunks[0]!.text = "mutated";
	assert.equal(validated.chunks[0]!.text, "fire safety");
	assert.ok(Object.isFrozen(validated.documents[0]) && Object.isFrozen(validated.chunks[0]!.citation));
	assert.throws(() => { validated.chunks[0]!.citation.fileName = "changed"; }, TypeError);
	for (const citation of [
		{ format: "pdf", fileName: "guide.txt", page: 1 },
		{ format: "pptx", fileName: "guide.txt", slide: 1, title: "Safety" },
		{ format: "docx", fileName: "guide.txt", paragraph: 1, heading: "Safety" },
		{ format: "md", fileName: "guide.txt", lineStart: 1, lineEnd: 2 },
	]) {
		const raw = snapshot();
		raw.documents[0]!.format = citation.format as "pdf";
		(raw.chunks[0] as unknown as { citation: unknown }).citation = citation;
		assert.equal(validateKnowledgeSnapshot(raw).chunks.length, 1);
	}
});

it("rejects future/malformed snapshots and duplicate or dangling IDs without partial data", () => {
	const invalid: unknown[] = [null, {}, { ...snapshot(), version: 2 }, { ...snapshot(), generatedAt: 7 }, { ...snapshot(), documents: {} }, { ...snapshot(), chunks: null }];
	for (const change of [
		(s: KnowledgeSnapshot) => { s.documents.push({ ...s.documents[0]! }); },
		(s: KnowledgeSnapshot) => { s.chunks.push({ ...s.chunks[0]! }); },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.sourceId = "c".repeat(64); },
		(s: KnowledgeSnapshot) => { s.documents[0]!.id = "short"; },
		(s: KnowledgeSnapshot) => { s.documents[0]!.fileName = "../escape.txt"; },
		(s: KnowledgeSnapshot) => { s.documents[0]!.status = "broken" as "ready"; },
		(s: KnowledgeSnapshot) => { s.documents[0]!.format = "xlsx" as "txt"; },
		(s: KnowledgeSnapshot) => { s.documents[0]!.error = 5 as unknown as string; },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.id = "bad"; },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.text = null as unknown as string; },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.citation = { format: "pdf", fileName: "guide.txt", page: 0 }; },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.citation = { format: "pptx", fileName: "guide.txt", slide: 1, title: 3 as unknown as string }; },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.citation = { format: "docx", fileName: "guide.txt", paragraph: 1.5 }; },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.citation = { format: "txt", fileName: "guide.txt", lineStart: 3, lineEnd: 2 }; },
		(s: KnowledgeSnapshot) => { s.chunks[0]!.citation = { format: "txt", fileName: "guide.txt", lineStart: 1, lineEnd: 2, heading: 9 as unknown as string }; },
	]) { const raw = snapshot(); change(raw); invalid.push(raw); }
	for (const raw of invalid) assert.throws(() => validateKnowledgeSnapshot(raw), /knowledge snapshot/i);
});

it("opens with r, reports corrupt JSON, and atomically replaces a complete snapshot", async () => {
	const file = path.join(root, "atomic", "index.json");
	await writeKnowledgeSnapshotAtomic(file, snapshot());
	assert.equal((await readKnowledgeSnapshot(file)).chunks[0]!.text, "fire safety");
	const first = await readKnowledgeSnapshot(file);
	await writeKnowledgeSnapshotAtomic(file, snapshot("new fire policy"));
	assert.equal(first.chunks[0]!.text, "fire safety");
	assert.equal((await readKnowledgeSnapshot(file)).chunks[0]!.text, "new fire policy");
	assert.deepEqual(await readdir(path.dirname(file)), ["index.json"]);
	const source = await readFile(new URL("../src/knowledge/index-store.ts", import.meta.url), "utf8");
	assert.match(source, /open\(filePath, "r"\)/u);
	assert.match(source, /0o600/u);
	if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
	await writeFile(file, "{corrupt");
	await assert.rejects(readKnowledgeSnapshot(file), /knowledge snapshot/i);
});

it("a failed atomic rename cleans its temp and leaves the target intact", async () => {
	await writeKnowledgeSnapshotAtomic(path.join(root, "writer-ready.json"), snapshot());
	const target = path.join(root, "occupied");
	await mkdir(target);
	await writeFile(path.join(target, "sentinel"), "keep");
	await assert.rejects(writeKnowledgeSnapshotAtomic(target, snapshot()));
	assert.equal(await readFile(path.join(target, "sentinel"), "utf8"), "keep");
	assert.equal((await readdir(root)).some((name) => name.startsWith(".occupied.")), false);
});

it("indexes deterministic path/content identities and retains scanned/rejected statuses", async () => {
	const first = await indexKnowledgeDocument({ fileName: "a.txt", data: Buffer.from("fire safety") });
	const repeat = await indexKnowledgeDocument({ fileName: "a.txt", data: Buffer.from("fire safety") });
	const duplicate = await indexKnowledgeDocument({ fileName: "b.txt", data: Buffer.from("fire safety") });
	assert.deepEqual(first, repeat);
	assert.match(first.document.id, /^[a-f0-9]{64}$/u);
	assert.notEqual(first.document.id, duplicate.document.id);
	assert.notEqual(first.chunks[0]!.id, duplicate.chunks[0]!.id);
	assert.equal(first.chunks[0]!.sourceId, first.document.id);
	assert.equal((await indexKnowledgeDocument({ fileName: "scan.pdf", data: pdfFixture([null]) })).document.status, "no_text_layer");
	const unsupported = await indexKnowledgeDocument({ fileName: "sheet.xlsx", data: Buffer.from("bytes") });
	assert.equal(unsupported.document.status, "rejected");
	assert.match(unsupported.document.error!, /unsupported/i);
	assert.deepEqual(unsupported.chunks, []);
});

it("normalizes relative document paths before hashing and rejects unsafe source paths", async () => {
	const input = { fileName: "folder\\guide.txt", data: Buffer.from("fire safety") };
	const indexed = await indexKnowledgeDocument(input);
	assert.equal(indexed.document.fileName, "folder/guide.txt");
	assert.equal(indexed.chunks[0]!.citation.fileName, "folder/guide.txt");
	assert.deepEqual(indexed, await indexKnowledgeDocument({ ...input, fileName: "folder/guide.txt" }));
	for (const fileName of ["../escape.txt", "/absolute.txt", "C:\\absolute.txt", "folder//guide.txt", "folder/./guide.txt", "folder/../guide.txt", "nul\0.txt", ""]) {
		await assert.rejects(indexKnowledgeDocument({ ...input, fileName }), /relative.*path|file.*name/i);
	}
});

it("shared traversal sorts relative paths, skips hidden/temp/output/symlinks, and continues past bad files", async () => {
	const source = path.join(root, "shared");
	const output = path.join(source, "index.json");
	await mkdir(path.join(source, "nested"), { recursive: true });
	await mkdir(path.join(source, ".hidden"));
	for (const [name, data] of Object.entries({ "z.txt": "fire safety", "a.txt": "fire safety", "nested/guide.md": "# Guide\nSafety", "bad.docx": "broken zip", "binary.xlsx": "unsupported", ".secret.txt": "hidden", ".hidden/guide.txt": "hidden", "~$lock.txt": "temp", "draft.txt~": "temp", "draft.tmp": "temp", "draft.part": "temp", "draft.swp": "temp", [process.platform === "win32" ? "INDEX.JSON" : "index.json"]: "old output" })) await writeFile(path.join(source, name), data);
	// A directory junction is available to unprivileged Windows users and is still a symlink Dirent.
	await symlink(path.join(source, "nested"), path.join(source, "linked"), process.platform === "win32" ? "junction" : "dir");
	const first = await indexSharedKnowledge({ sourceDir: source, indexFile: output });
	assert.deepEqual(first.documents.map((d) => d.fileName), ["a.txt", "bad.docx", "binary.xlsx", "nested/guide.md", "z.txt"]);
	assert.deepEqual(first.documents.map((d) => d.status), ["ready", "rejected", "rejected", "ready", "ready"]);
	assert.match(first.documents[1]!.error!, /extract|zip|archive/i);
	assert.ok(!first.documents[1]!.error!.includes(source));
	assert.deepEqual(first.chunks.map((c) => c.citation.fileName), ["a.txt", "nested/guide.md", "z.txt"]);
	const second = await indexSharedKnowledge({ sourceDir: source, indexFile: output });
	assert.deepEqual(second.documents, first.documents);
	assert.deepEqual(second.chunks, first.chunks);
	assert.deepEqual((await readKnowledgeSnapshot(output)).documents, first.documents);
});

it("records unreadable sources deterministically and publishes later good files", async (context) => {
	const source = path.join(root, "unreadable-source");
	const output = path.join(root, "unreadable-index.json");
	await mkdir(source);
	const failedFile = path.join(source, "a-unreadable.txt");
	await writeFile(failedFile, "unreadable bytes");
	await writeFile(path.join(source, "z-good.txt"), "good office fire");
	const originalReadFile = fsPromises.readFile;
	const intercepted = context.mock.method(fsPromises, "readFile", async (...args: Parameters<typeof fsPromises.readFile>) => {
		if (path.relative(path.toNamespacedPath(failedFile), path.toNamespacedPath(String(args[0]))) === "") throw Object.assign(new Error(`Cannot read secret bytes at ${failedFile}`), { code: "EACCES" });
		return originalReadFile(...args);
	});
	syncBuiltinESMExports();
	context.after(() => { intercepted.mock.restore(); syncBuiltinESMExports(); });
	const first = await indexSharedKnowledge({ sourceDir: source, indexFile: output });
	assert.deepEqual(first.documents.map((document) => [document.fileName, document.status]), [["a-unreadable.txt", "rejected"], ["z-good.txt", "ready"]]);
	assert.equal(first.documents[0]!.format, "txt");
	assert.match(first.documents[0]!.id, /^[a-f0-9]{64}$/u);
	assert.match(first.documents[0]!.error!, /read/i);
	assert.ok(!first.documents[0]!.error!.includes(source));
	assert.ok(!first.documents[0]!.error!.includes("secret bytes"));
	assert.deepEqual(first.chunks.map((chunk) => chunk.text), ["good office fire"]);
	const second = await indexSharedKnowledge({ sourceDir: source, indexFile: output });
	assert.deepEqual(second.documents, first.documents);
	assert.deepEqual((await readKnowledgeSnapshot(output)).documents, first.documents);
});

it("excludes equivalent namespaced and case-variant Windows output paths", { skip: process.platform !== "win32" }, async () => {
	const source = path.join(root, "namespace-source");
	await mkdir(source);
	await writeFile(path.join(source, "guide.txt"), "office fire");
	const output = path.join(source, "index.json");
	await writeFile(output, "existing output");
	const first = await indexSharedKnowledge({ sourceDir: source, indexFile: path.toNamespacedPath(output) });
	assert.deepEqual(first.documents.map((document) => document.fileName), ["guide.txt"]);
	const second = await indexSharedKnowledge({ sourceDir: path.toNamespacedPath(source.toUpperCase()), indexFile: output.toUpperCase() });
	assert.deepEqual(second.documents, first.documents);
	assert.deepEqual((await readKnowledgeSnapshot(output)).documents, first.documents);
});

it("loader combines only the requested owner's snapshot and reopens shared snapshots every retrieval", async () => {
	const file = path.join(root, "loader.json");
	await writeKnowledgeSnapshotAtomic(file, snapshot());
	const owners: string[] = [];
	const load = (userId: string) => loadKnowledgeChunks(userId, { sharedIndexFile: file, loadPersonalSnapshot: async (owner) => {
		owners.push(owner);
		const value = snapshot(`${owner} personal fire`);
		value.chunks[0]!.id = owner === "alice" ? "c".repeat(64) : "d".repeat(64);
		return value;
	} });
	const first = await load("alice");
	assert.deepEqual(first.map((c) => c.text), ["fire safety", "alice personal fire"]);
	first.pop();
	assert.equal((await load("bob")).length, 2);
	await writeKnowledgeSnapshotAtomic(file, snapshot("new evacuation"));
	const results = await new Bm25Retriever(load).search(["evacuation"], "bob");
	assert.deepEqual(results.map((r) => r.text), ["new evacuation"]);
	assert.deepEqual(owners, ["alice", "bob", "bob"]);
});

it("shared CLI validates both paths and runs without LLM configuration or external commands", async () => {
	await assert.rejects(runIndexShared({}), /KNOWLEDGE_SHARED_DIR/u);
	await assert.rejects(runIndexShared({ KNOWLEDGE_SHARED_DIR: root }), /KNOWLEDGE_INDEX_FILE/u);
	const source = path.join(root, "cli-source");
	await mkdir(source);
	await writeFile(path.join(source, "guide.txt"), "office fire");
	const file = path.join(root, "cli-index.json");
	const removed = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^LLM_|^SESSION_SECRET$/u.test(name)));
	try {
		for (const name of Object.keys(removed)) delete process.env[name];
		await runIndexShared({ KNOWLEDGE_SHARED_DIR: source, KNOWLEDGE_INDEX_FILE: file });
	} finally {
		for (const [name, value] of Object.entries(removed)) if (value !== undefined) process.env[name] = value;
	}
	assert.equal((await readKnowledgeSnapshot(file)).documents[0]!.status, "ready");
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(pkg.scripts["index:shared"], "tsx scripts/index-shared.ts");
});
