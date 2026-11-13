import assert from "node:assert/strict";
import { before, it } from "node:test";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { createSessionToken } from "../src/server/session-auth.ts";
import { POST } from "../app/api/knowledge/documents/route.ts";
import { GET as MAP } from "../app/api/knowledge/map/route.ts";
import { GET as SECTION } from "../app/api/knowledge/section/route.ts";
import type { KnowledgeMapResponse, KnowledgeSectionResponse } from "../src/knowledge/map-contracts.ts";

let a: Account;
let b: Account;
before(async () => {
	delete process.env.LH_TEST_USER_ID;
	const accounts = createAccountStore(PATHS.data);
	a = await accounts.create("map-a", "correct horse battery staple", "en");
	b = await accounts.create("map-b", "correct horse battery staple", "en");
});
function headers(owner?: Account): Headers {
	return new Headers(owner ? { cookie: `lh_session=${createSessionToken(owner.id, process.env.SESSION_SECRET!)}` } : {});
}
async function upload(owner: Account, fileName: string, text: string, destination: string): Promise<string> {
	const form = new FormData();
	form.set("file", new Blob([text]), fileName);
	form.set("destination", destination);
	const response = await POST(new Request("http://office.test/api/knowledge/documents", { method: "POST", headers: headers(owner), body: form }));
	assert.equal(response.status, 200);
	return (await response.json()).document.id;
}
const map = async (owner?: Account) => MAP(new Request("http://office.test/api/knowledge/map", { headers: headers(owner) }));
const section = (owner: Account | undefined, query: string) => SECTION(new Request(`http://office.test/api/knowledge/section?${query}`, { headers: headers(owner) }));
const enc = (value: unknown) => encodeURIComponent(JSON.stringify(value));

it("requires authentication", async () => {
	assert.equal((await map()).status, 401);
	assert.equal((await section(undefined, "scope=shared&doc=x")).status, 401);
});

it("map returns shared plus only the caller's personal documents", async () => {
	const shared = await upload(a, "shared-map.md", "# SharedTop\nshared text\n## SharedInner\ninner\n", "shared");
	const mine = await upload(a, "a-private.md", "# PrivA\nsecret a\n", "personal");
	const theirs = await upload(b, "b-private.md", "# PrivB\nsecret b\n", "personal");
	const forA = (await (await map(a)).json()) as KnowledgeMapResponse;
	const forB = (await (await map(b)).json()) as KnowledgeMapResponse;
	assert.ok(forA.nodes.some((n) => n.id === `shared:${shared}` && n.scope === "shared"));
	assert.ok(forA.nodes.some((n) => n.id === `personal:${mine}`));
	assert.ok(!forA.nodes.some((n) => n.documentId === theirs));
	assert.ok(forB.nodes.some((n) => n.id === `personal:${theirs}`));
	assert.ok(forB.nodes.some((n) => n.id === `shared:${shared}`));
	assert.ok(!forB.nodes.some((n) => n.documentId === mine));
	assert.ok(forA.nodes.some((n) => n.kind === "section" && n.label === "SharedInner"));
	assert.ok(forA.edges.length > 0);
});

it("section returns text, and validates parameters", async () => {
	const doc = await upload(a, "sec-doc.md", "# Alpha\nalpha body\n## Beta\nbeta body\n", "personal");
	const ok = await section(a, `scope=personal&doc=${doc}`);
	assert.equal(ok.status, 200);
	const whole = (await ok.json()) as KnowledgeSectionResponse;
	assert.match(whole.text, /alpha body/u);
	assert.match(whole.text, /beta body/u);
	assert.equal(whole.truncated, false);
	const beta = (await (await section(a, `scope=personal&doc=${doc}&path=${enc(["Alpha", "Beta"])}`)).json()) as KnowledgeSectionResponse;
	assert.match(beta.text, /beta body/u);
	assert.doesNotMatch(beta.text, /alpha body/u);
	for (const query of ["doc=x", `scope=bogus&doc=${doc}`, "scope=shared", `scope=shared&doc=${doc}&path=notjson`, `scope=shared&doc=${doc}&path=${enc({ a: 1 })}`, `scope=shared&doc=${doc}&path=${enc([1])}`]) {
		const response = await section(a, query);
		assert.equal(response.status, 400, query);
		assert.deepEqual(await response.json(), { error: "invalid_request" });
	}
	const missing = await section(a, `scope=personal&doc=${"f".repeat(64)}`);
	assert.equal(missing.status, 404);
	assert.deepEqual(await missing.json(), { error: "not_found" });
	assert.equal((await section(a, `scope=personal&doc=${doc}&path=${enc(["Nope"])}`)).status, 404);
});

it("personal scope cannot read another user's document", async () => {
	const doc = await upload(a, "only-a.md", "# Only\nonly a text\n", "personal");
	assert.equal((await section(a, `scope=personal&doc=${doc}`)).status, 200);
	assert.equal((await section(b, `scope=personal&doc=${doc}`)).status, 404);
	assert.equal((await section(b, `scope=shared&doc=${doc}`)).status, 404);
});
