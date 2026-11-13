import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { checkedStoresForUser, sharedKnowledgeStore } from "../src/server/stores.ts";
import { openKnowledgeSection } from "../src/knowledge/service.ts";
import type { KnowledgeToolContext } from "../src/agent/tools/knowledge.ts";
import type { KnowledgeSectionResponse } from "../src/knowledge/map-contracts.ts";

const { createKnowledgeTool } = await import("../src/agent/tools/knowledge.ts");

function section(overrides: Partial<KnowledgeSectionResponse> = {}): KnowledgeSectionResponse {
	return {
		scope: "personal", documentId: "d1", fileName: "guide.pdf", path: ["A", "B"], text: "Body text.", truncated: false,
		citation: { format: "pdf", fileName: "guide.pdf", page: 12 }, ...overrides,
	};
}
function ctx(overrides: Partial<KnowledgeToolContext> = {}): KnowledgeToolContext {
	return {
		ownerId: "o", chatId: "c", retriever: { search: async () => [] },
		markKnowledgeUsed: () => true, openSection: async () => section(), ...overrides,
	};
}
const run = async (c: KnowledgeToolContext, input: object): Promise<string> => {
	const result = await createKnowledgeTool(c).open_section!.execute("call", input);
	return typeof result === "string" ? result : ((result as { content: Array<{ text: string }> }).content[0]?.text ?? JSON.stringify(result));
};

describe("open_section tool", () => {
	it("passes file and array path, header carries page and section", async () => {
		const seen: unknown[] = [];
		const text = await run(ctx({ openSection: async (...args) => { seen.push(args); return section(); } }), { file: "guide.pdf", section: ["A", "B"] });
		assert.deepEqual(seen, [["o", "guide.pdf", ["A", "B"]]]);
		assert.ok(text.startsWith("[guide.pdf, page 12, §A › B]\nBody text."), text);
	});
	it("splits the ' › ' string form", async () => {
		const seen: string[][] = [];
		await run(ctx({ openSection: async (_o, _f, s) => { seen.push(s); return section(); } }), { file: "guide.pdf", section: "A › B" });
		assert.deepEqual(seen, [["A", "B"]]);
	});
	it("empty path reads the whole document", async () => {
		const seen: string[][] = [];
		const text = await run(ctx({ openSection: async (_o, _f, s) => { seen.push(s); return section({ path: [] }); } }), { file: "guide.pdf", section: [] });
		assert.deepEqual(seen, [[]]);
		assert.ok(text.startsWith("[guide.pdf, page 12]"), text);
	});
	it("appends the truncation note", async () => {
		const text = await run(ctx({ openSection: async () => section({ truncated: true }) }), { file: "guide.pdf", section: [] });
		assert.ok(text.includes("[Section truncated at 12,000 characters — open a deeper subsection for the rest.]"));
	});
	it("returns a plain not-found message", async () => {
		const text = await run(ctx({ openSection: async () => null }), { file: "nope.pdf", section: ["X"] });
		assert.match(text, /No section found.*search_knowledge/s);
	});
	it("lists ambiguous matches without content or sticky mark", async () => {
		let marked = 0;
		const text = await run(ctx({ markKnowledgeUsed: () => { marked++; return true; }, openSection: async () => ({ ambiguous: ["a.pdf (shared, id 1)", "a.pdf (shared index, id 2)"] }) }), { file: "a.pdf", section: [] });
		assert.match(text, /Several documents match/);
		assert.equal(marked, 0);
	});
	it("marks knowledge used before returning content", async () => {
		const order: string[] = [];
		const c = ctx({
			markKnowledgeUsed: (id) => { order.push(`mark:${id}`); return true; },
			openSection: async () => { order.push("open"); return section(); },
		});
		const text = await run(c, { file: "guide.pdf", section: [] });
		assert.deepEqual(order, ["open", "mark:c"]);
		assert.ok(text.includes("Body text."));
	});
	it("withholds content when the sticky persist fails", async () => {
		const text = await run(ctx({ markKnowledgeUsed: () => { throw new Error("disk"); } }), { file: "guide.pdf", section: [] });
		assert.ok(!text.includes("Body text."));
		assert.match(text, /could not be updated/);
	});
});

describe("openKnowledgeSection port", () => {
	let a: Account;
	let b: Account;
	before(async () => {
		delete process.env.LH_TEST_USER_ID;
		const accounts = createAccountStore(PATHS.data);
		a = await accounts.create("open-a", "correct horse battery staple", "en");
		b = await accounts.create("open-b", "correct horse battery staple", "en");
		const md = (tag: string) => new TextEncoder().encode(`# Top\n\nIntro ${tag}\n\n## Sub\n\nDetail ${tag}\n`);
		await checkedStoresForUser(a.id).knowledgeStore.uploadDocument({ fileName: "notes.md", data: md("personal-a") });
		await checkedStoresForUser(a.id).knowledgeStore.uploadDocument({ fileName: "private.md", data: md("secret-a") });
		await sharedKnowledgeStore.uploadDocument({ fileName: "notes.md", data: md("shared") });
		await sharedKnowledgeStore.uploadDocument({ fileName: "Handbook.md", data: md("handbook") });
	});

	it("resolves by file and heading path", async () => {
		const r = await openKnowledgeSection(a.id, "notes.md", ["Top", "Sub"]) as KnowledgeSectionResponse;
		assert.match(r.text, /Detail/);
		assert.ok(!r.text.includes("Intro"));
	});
	it("prefers the personal document over a shared one with the same name", async () => {
		const r = await openKnowledgeSection(a.id, "notes.md", ["Top"]) as KnowledgeSectionResponse;
		assert.equal(r.scope, "personal");
		assert.match(r.text, /personal-a/);
		const other = await openKnowledgeSection(b.id, "notes.md", ["Top"]) as KnowledgeSectionResponse;
		assert.equal(other.scope, "shared");
		assert.match(other.text, /shared/);
	});
	it("falls back to a case-insensitive file name match", async () => {
		const r = await openKnowledgeSection(a.id, "handbook.md", ["Top"]) as KnowledgeSectionResponse;
		assert.equal(r.fileName, "Handbook.md");
	});
	it("never resolves another user's personal document", async () => {
		assert.equal(await openKnowledgeSection(b.id, "private.md", []), null);
		assert.ok(await openKnowledgeSection(a.id, "private.md", []));
	});
	it("returns null for an unknown section", async () => {
		assert.equal(await openKnowledgeSection(a.id, "notes.md", ["Missing"]), null);
	});
});
