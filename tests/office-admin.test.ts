import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAccountStore } from "../src/server/accounts.ts";
import { withOfficeAdmin } from "../src/server/route-scope.ts";

const PASS = "a long passphrase";
const originalAdmin = process.env.LH_ADMIN_USERNAME;
afterEach(() => { if (originalAdmin === undefined) delete process.env.LH_ADMIN_USERNAME; else process.env.LH_ADMIN_USERNAME = originalAdmin; });
async function tmp() { return mkdtemp(path.join(os.tmpdir(), "lh-admin-")); }

it("list returns every account without password fields", async () => {
  const root = await tmp();
  try {
    const accounts = createAccountStore(root);
    await accounts.create("alice", PASS, "en");
    await accounts.create("bobby", PASS, "en");
    const listed = await accounts.list();
    assert.deepEqual(listed.map((a) => a.username), ["alice", "bobby"]);
    assert.ok(listed.every((a) => !("passwordHash" in a) && !("passwordSalt" in a)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("resetPassword replaces the hash and the old password stops working", async () => {
  const root = await tmp();
  try {
    const accounts = createAccountStore(root);
    await accounts.create("bobby", PASS, "en");
    const before = JSON.parse(await readFile(path.join(root, "accounts.json"), "utf8")).accounts[0].passwordHash;
    await accounts.resetPassword("bobby", "brand new passphrase");
    const after = JSON.parse(await readFile(path.join(root, "accounts.json"), "utf8")).accounts[0].passwordHash;
    assert.notEqual(before, after);
    assert.equal(await accounts.verify("bobby", PASS), null);
    assert.ok(await accounts.verify("bobby", "brand new passphrase"));
    await assert.rejects(accounts.resetPassword("bobby", "short"), /12 characters/);
    await assert.rejects(accounts.resetPassword("ghost", "brand new passphrase"), /not found/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("withOfficeAdmin: 401 anonymous, 403 non-admin or env unset, 200 for the LH_ADMIN_USERNAME account", async () => {
  const handler = withOfficeAdmin(async () => Response.json({ ok: true }), async (request) => {
    const who = request.headers.get("x-who");
    return who ? { id: who, username: who } : null;
  });
  const as = (who?: string) => handler(new Request("http://x/", { headers: who ? { "x-who": who } : {} }));
  process.env.LH_ADMIN_USERNAME = "  boss  ";
  assert.equal((await as()).status, 401);
  assert.equal((await as("worker")).status, 403);
  assert.equal((await as("boss")).status, 200);
  delete process.env.LH_ADMIN_USERNAME;
  assert.equal((await as("boss")).status, 403);
});
