import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { createSessionToken } from "../src/server/session-auth.ts";
import { PUT } from "../app/api/admin/users/[username]/password/route.ts";
import { DELETE } from "../app/api/admin/users/[username]/route.ts";

const PASS = "correct horse battery staple";
let admin: Account;
let user: Account;
const originalAdmin = process.env.LH_ADMIN_USERNAME;
after(() => { if (originalAdmin === undefined) delete process.env.LH_ADMIN_USERNAME; else process.env.LH_ADMIN_USERNAME = originalAdmin; });
before(async () => {
  delete process.env.LH_TEST_USER_ID;
  const accounts = createAccountStore(PATHS.data);
  admin = await accounts.create("admin-api-root", PASS, "en");
  user = await accounts.create("admin-api-user", PASS, "en");
  process.env.LH_ADMIN_USERNAME = admin.username;
});
const cookie = (a?: Account) => new Headers(a ? { cookie: `lh_session=${createSessionToken(a.id, process.env.SESSION_SECRET!)}` } : {});
const put = (who: Account | undefined, username: string, body: unknown) =>
  PUT(new Request("http://office.test/", { method: "PUT", headers: cookie(who), body: JSON.stringify(body) }), { params: Promise.resolve({ username }) });
const del = (who: Account | undefined, username: string) =>
  DELETE(new Request("http://office.test/", { method: "DELETE", headers: cookie(who) }), { params: Promise.resolve({ username }) });

it("non-admin and anonymous cannot reset passwords", async () => {
  assert.equal((await put(undefined, user.username, { password: "another long passphrase" })).status, 401);
  assert.equal((await put(user, user.username, { password: "another long passphrase" })).status, 403);
  assert.ok(await createAccountStore(PATHS.data).verify(user.username, PASS));
});

it("admin resets a password; validates input and target", async () => {
  assert.equal((await put(admin, user.username, { password: "short" })).status, 400);
  assert.equal((await put(admin, user.username, {})).status, 400);
  assert.equal((await put(admin, "nobody-here", { password: "another long passphrase" })).status, 404);
  assert.equal((await put(admin, user.username, { password: "another long passphrase" })).status, 200);
  const accounts = createAccountStore(PATHS.data);
  assert.equal(await accounts.verify(user.username, PASS), null);
  assert.ok(await accounts.verify(user.username, "another long passphrase"));
});

it("admin deletes users but not admins; non-admin cannot delete", async () => {
  assert.equal((await del(user, admin.username)).status, 403);
  assert.equal((await del(admin, admin.username)).status, 400);
  assert.equal((await del(admin, "nobody-here")).status, 404);
  assert.equal((await del(admin, user.username)).status, 200);
  assert.equal(await createAccountStore(PATHS.data).byUsername(user.username), null);
});
