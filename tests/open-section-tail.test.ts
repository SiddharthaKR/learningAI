import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOpenSection } from "../src/knowledge/open-section.ts";
import type { KnowledgeSnapshot } from "../src/knowledge/index-store.ts";

const DOC = "a".repeat(64);
const id = (n: number) => n.toString(16).padStart(64, "0");
const chunk = (n: number, section: string[], text: string) => ({
	id: id(n), sourceId: DOC, text, ordinal: n,
	citation: { format: "pdf" as const, fileName: "guide.pdf", page: n + 1 },
	section,
});

const snapshot: KnowledgeSnapshot = {
	version: 1,
	generatedAt: "2026-11-14T00:00:00.000Z",
	documents: [{ id: DOC, fileName: "guide.pdf", format: "pdf", status: "ready" }],
	chunks: [
		chunk(1, ["Guide", "Ch. 2", "Switches"], "switch text"),
		chunk(2, ["Guide", "Ch. 3", "JTAG Options"], "jtag text"),
		chunk(3, ["Guide", "Ch. 3", "Reset"], "reset in ch3"),
		chunk(4, ["Guide", "Ch. 4", "Reset"], "reset in ch4"),
	],
};
const sources = [{ scope: "personal" as const, label: "personal", snapshot }];

describe("open_section path missing its leading segments", () => {
	it("exact paths still resolve as before", () => {
		const r = resolveOpenSection(sources, "guide.pdf", ["Guide", "Ch. 3", "JTAG Options"]);
		assert.ok(r && "text" in r);
		assert.match(r.text, /jtag text/);
	});

	it("resolves when the top title segment is dropped", () => {
		const r = resolveOpenSection(sources, "guide.pdf", ["Ch. 3", "JTAG Options"]);
		assert.ok(r && "text" in r);
		assert.deepEqual(r.path, ["Guide", "Ch. 3", "JTAG Options"]);
		assert.match(r.text, /jtag text/);
	});

	it("resolves a single unique section name", () => {
		const r = resolveOpenSection(sources, "guide.pdf", ["Switches"]);
		assert.ok(r && "text" in r);
		assert.deepEqual(r.path, ["Guide", "Ch. 2", "Switches"]);
	});

	it("refuses an ambiguous tail instead of guessing", () => {
		assert.equal(resolveOpenSection(sources, "guide.pdf", ["Reset"]), null);
	});

	it("still returns null for a path that does not exist", () => {
		assert.equal(resolveOpenSection(sources, "guide.pdf", ["Ch. 9", "Nope"]), null);
	});
});
