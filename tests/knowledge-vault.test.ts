import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, open, readFile, readdir, rm, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { KnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import { writeKnowledgeVault } from "../src/knowledge/vault.ts";
import { createKnowledgeStore } from "../src/store/knowledge.ts";

const D1 = "a".repeat(64), D2 = "b".repeat(64);
const snap: KnowledgeSnapshot = {
	version: 1, generatedAt: "x",
	documents: [
		{ id: D1, fileName: "dir/spec: v1?.md", format: "md", status: "ready" },
		{ id: D2, fileName: "other.pdf", format: "pdf", status: "ready" },
	],
	chunks: [
		{ id: "1".repeat(64), sourceId: D1, text: "alpha body", citation: { format: "md", fileName: "dir/spec: v1?.md", lineStart: 1, lineEnd: 2 }, section: ["A/B: C", "Sub"], ordinal: 0 },
		{ id: "2".repeat(64), sourceId: D1, text: "beta body", citation: { format: "md", fileName: "dir/spec: v1?.md", lineStart: 3, lineEnd: 4 }, section: ["A/B: C", "Sub2"], ordinal: 1 },
		{ id: "3".repeat(64), sourceId: D2, text: "pdf body", citation: { format: "pdf", fileName: "other.pdf", page: 7 }, section: ["A/B: C"], ordinal: 0 },
	],
};

it("writes one safe, unique, linked note per document and section", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "vault-"));
	try {
		await writeKnowledgeVault(root, snap);
		const dir = path.join(root, "knowledge", "vault");
		const files = await readdir(dir);
		assert.equal(files.length, 6); // doc1 + 3 sections, doc2 + 1 section
		assert.equal(new Set(files.map((f) => f.toLowerCase())).size, files.length);
		for (const file of files) {
			assert.ok(file.endsWith(".md"));
			assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/u.test(file), file);
			assert.ok(file.length <= 123);
		}
		const names = new Set(files.map((f) => f.slice(0, -3)));
		const texts: string[] = [];
		for (const file of files) {
			const text = await readFile(path.join(dir, file), "utf8");
			texts.push(text);
			for (const [, link] of text.matchAll(/\[\[([^\]]+)\]\]/gu)) assert.ok(names.has(link!), `unresolved ${link} in ${file}`);
		}
		const pdfSection = texts.find((t) => t.includes("pdf body") && t.includes("Parent:"))!;
		assert.match(pdfSection, /page: 7/u);
		assert.match(pdfSection, /documentId: "b{64}"/u);
		assert.match(pdfSection, /^# A\/B: C$/mu);
	} finally { await rm(root, { recursive: true, force: true }); }
});

it("rebuilds from scratch after upload and delete; deleted documents' notes disappear", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "vault-"));
	try {
		const store = createKnowledgeStore(root, () => {});
		const doc = await store.uploadDocument({ fileName: "guide.md", data: new TextEncoder().encode("# Top\ntext one\n## Inner\ntext two\n") });
		await store.uploadDocument({ fileName: "other.md", data: new TextEncoder().encode("# Else\nzzz\n") });
		const dir = path.join(root, "knowledge", "vault");
		const before = await readdir(dir);
		assert.ok(before.some((f) => f.startsWith("guide")));
		assert.ok(before.some((f) => f.startsWith("other")));
		assert.equal(await store.deleteDocument(doc.id), true);
		const after = await readdir(dir);
		assert.ok(!after.some((f) => f.startsWith("guide")));
		assert.ok(after.some((f) => f.startsWith("other")));
		assert.equal((await readdir(path.join(root, "knowledge"))).filter((f) => f.startsWith(".vault")).length, 0);
	} finally { await rm(root, { recursive: true, force: true }); }
});

// Simulation: hold an open handle on a file inside the live vault. On Windows this
// makes renaming the vault directory fail (EPERM/EBUSY); POSIX allows it, so skip there.
it("vault failure is logged and does not fail upload", { skip: process.platform !== "win32" }, async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "vault-"));
	const logged: unknown[][] = [];
	const original = console.error;
	let handle: FileHandle | undefined;
	try {
		const store = createKnowledgeStore(root, () => {});
		await store.uploadDocument({ fileName: "one.md", data: new TextEncoder().encode("# One\nx\n") });
		const dir = path.join(root, "knowledge", "vault");
		const [first] = await readdir(dir);
		handle = await open(path.join(dir, first!), "r");
		console.error = (...args: unknown[]) => { logged.push(args); };
		const second = await store.uploadDocument({ fileName: "two.md", data: new TextEncoder().encode("# Two\ny\n") });
		assert.equal(second.status, "ready");
		assert.equal((await store.readSnapshot()).documents.length, 2);
		assert.ok(logged.length >= 1);
	} finally {
		console.error = original;
		await handle?.close();
		await rm(root, { recursive: true, force: true });
	}
});
