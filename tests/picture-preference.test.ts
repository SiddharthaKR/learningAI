/** Each user's "read pictures" choice is remembered on their account (off until they turn it on). */
import assert from "node:assert/strict";
import { before, after, it } from "node:test";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { createSessionToken } from "../src/server/session-auth.ts";
import { GET, PATCH } from "../app/api/preferences/route.ts";

let alice: Account;
let bob: Account;
const savedUser = process.env.LH_TEST_USER_ID;
before(async () => {
	delete process.env.LH_TEST_USER_ID;
	const accounts = createAccountStore(PATHS.data);
	alice = await accounts.create("pictures-alice", "correct horse battery staple", "en");
	bob = await accounts.create("pictures-bob", "correct horse battery staple", "ja");
});
after(() => { if (savedUser === undefined) delete process.env.LH_TEST_USER_ID; else process.env.LH_TEST_USER_ID = savedUser; });

const as = (account: Account) => ({ cookie: `lh_session=${createSessionToken(account.id, process.env.SESSION_SECRET!)}` });
const patch = (account: Account, body: unknown) => PATCH(new Request("http://office.test/api/preferences", { method: "PATCH", headers: { ...as(account), "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = async (account: Account) => (await (await GET(new Request("http://office.test/api/preferences", { headers: as(account) }))).json()) as { preferences: { readPictures: boolean } };

it("is off by default", async () => {
	assert.equal(alice.readPictures, undefined);
	assert.equal((await get(alice)).preferences.readPictures, false);
});

it("is remembered per user, independently", async () => {
	assert.equal((await patch(alice, { readPictures: true })).status, 200);
	assert.equal((await get(alice)).preferences.readPictures, true);
	assert.equal((await get(bob)).preferences.readPictures, false, "bob's choice is his own");
	assert.equal((await createAccountStore(PATHS.data).byId(alice.id))?.readPictures, true, "stored on the account");
	await patch(alice, { readPictures: false });
	assert.equal((await get(alice)).preferences.readPictures, false);
});

it("rejects anything but a boolean, and leaves other preferences alone", async () => {
	assert.equal((await patch(bob, { readPictures: "yes" })).status, 400);
	assert.equal((await patch(bob, {})).status, 400);
	await patch(bob, { readPictures: true });
	const account = await createAccountStore(PATHS.data).byId(bob.id);
	assert.equal(account?.uiLanguage, "ja");
	assert.equal(account?.teachingLanguage, "ja");
});
