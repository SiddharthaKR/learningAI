import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { checkedStoresForUser, sharedKnowledgeStore } from "../src/server/stores.ts";
import { loadKnowledgeChunks, openKnowledgeSection } from "../src/knowledge/service.ts";
import { parseSettingsBody } from "../src/server/settings-body.ts";
import { createKnowledgeTool, type KnowledgeToolContext } from "../src/agent/tools/knowledge.ts";
import { KnowledgeScopeSelect } from "../components/stats-bar.tsx";

const md = (tag: string) => new TextEncoder().encode(`# Top\n\nIntro ${tag}\n`);
const names = (chunks: Awaited<ReturnType<typeof loadKnowledgeChunks>>) => chunks.map((c) => c.citation.fileName).sort();

describe("knowledgeScope settings validation", () => {
	it("accepts the three values and treats absent as unset", () => {
		for (const v of ["all", "shared", "personal"]) {
			const r = parseSettingsBody({ knowledgeScope: v });
			assert.ok(r.ok && r.settings.knowledgeScope === v);
		}
		const absent = parseSettingsBody({ officeKnowledgeEnabled: true });
		assert.ok(absent.ok && absent.settings.knowledgeScope === undefined);
	});
	it("rejects anything else", () => {
		for (const v of ["other", "", null, 1, true, {}, "ALL"]) {
			assert.equal(parseSettingsBody({ knowledgeScope: v }).ok, false, JSON.stringify(v));
		}
	});
});

describe("scoped retrieval", () => {
	let a: Account;
	let b: Account;
	before(async () => {
		delete process.env.LH_TEST_USER_ID;
		const accounts = createAccountStore(PATHS.data);
		a = await accounts.create("scope-a", "correct horse battery staple", "en");
		b = await accounts.create("scope-b", "correct horse battery staple", "en");
		await checkedStoresForUser(a.id).knowledgeStore.uploadDocument({ fileName: "scope-mine.md", data: md("mine") });
		await checkedStoresForUser(b.id).knowledgeStore.uploadDocument({ fileName: "scope-theirs.md", data: md("theirs") });
		await sharedKnowledgeStore.uploadDocument({ fileName: "scope-shared.md", data: md("shared") });
	});

	it("all = shared + own personal; never another user's", async () => {
		const n = names(await loadKnowledgeChunks(a.id));
		assert.ok(n.includes("scope-mine.md") && n.includes("scope-shared.md"));
		assert.ok(!n.includes("scope-theirs.md"));
		assert.deepEqual(names(await loadKnowledgeChunks(a.id, { scope: "all" })), n);
	});
	it("shared never includes personal; personal never includes shared", async () => {
		const shared = names(await loadKnowledgeChunks(a.id, { scope: "shared" }));
		assert.ok(shared.includes("scope-shared.md"));
		assert.ok(!shared.includes("scope-mine.md") && !shared.includes("scope-theirs.md"));
		const personal = names(await loadKnowledgeChunks(a.id, { scope: "personal" }));
		assert.deepEqual(personal, ["scope-mine.md"]);
		assert.deepEqual(names(await loadKnowledgeChunks(b.id, { scope: "personal" })), ["scope-theirs.md"]);
	});
	it("openKnowledgeSection only resolves files within scope", async () => {
		assert.ok(await openKnowledgeSection(a.id, "scope-mine.md", ["Top"], { scope: "personal" }));
		assert.equal(await openKnowledgeSection(a.id, "scope-shared.md", ["Top"], { scope: "personal" }), null);
		assert.equal(await openKnowledgeSection(a.id, "scope-mine.md", ["Top"], { scope: "shared" }), null);
		assert.ok(await openKnowledgeSection(a.id, "scope-shared.md", ["Top"], { scope: "shared" }));
		assert.ok(await openKnowledgeSection(a.id, "scope-mine.md", ["Top"]));
		assert.ok(await openKnowledgeSection(a.id, "scope-shared.md", ["Top"]));
	});
});

describe("search_knowledge empty message", () => {
	const run = async (scope?: "all" | "shared" | "personal") => {
		const ctx: KnowledgeToolContext = {
			ownerId: "o", chatId: "c", scope,
			retriever: { search: async () => [] },
			markKnowledgeUsed: () => true,
			openSection: async () => null,
		};
		const tool = createKnowledgeTool(ctx).search_knowledge!;
		const r = await tool.execute("t", { queries: ["x"] } as never, undefined as never, undefined as never) as { content: Array<{ text: string }> } | string;
		return typeof r === "string" ? r : JSON.stringify(r);
	};
	it("names the restricted scope only when restricted", async () => {
		assert.match(await run("shared"), /searching shared knowledge only/);
		assert.match(await run("personal"), /searching your personal documents only/);
		assert.doesNotMatch(await run("all"), /only\)/);
		assert.doesNotMatch(await run(), /only\)/);
	});
});

describe("scope select", () => {
	it("is hidden unless office knowledge is ON, and reflects the saved value", () => {
		const html = (s: Parameters<typeof KnowledgeScopeSelect>[0]["settings"]) =>
			renderToStaticMarkup(<KnowledgeScopeSelect settings={s} disabled={false} onChange={() => {}} />);
		assert.equal(html(null), "");
		assert.equal(html({ officeKnowledgeEnabled: false, knowledgeScope: "shared" }), "");
		const on = html({ officeKnowledgeEnabled: true, knowledgeScope: "personal" });
		assert.match(on, /data-testid="knowledge-scope-select"/);
		assert.match(on, /aria-label="Knowledge scope"/);
		assert.match(on, /<option value="personal" selected/);
		assert.match(html({ officeKnowledgeEnabled: true }), /<option value="all" selected/);
	});
});

describe("controls audit line", () => {
	it("renders scope changes and leaves boolean entries as before", async () => {
		const { ControlsChangedLine } = await import("../components/chat.tsx");
		const scope = renderToStaticMarkup(<ControlsChangedLine data={{ at: "x", changes: [{ field: "knowledgeScope", from: "all", to: "shared" }] }} />);
		assert.match(scope, /Knowledge scope: Shared only/);
		const bool = renderToStaticMarkup(<ControlsChangedLine data={{ at: "x", changes: [
			{ field: "webResearchEnabled", from: false, to: true }, { field: "officeKnowledgeEnabled", from: true, to: false }] }} />);
		assert.match(bool, /Read linked pages ON|Web research ON/);
		assert.match(bool, /Use office knowledge OFF/);
	});
});
