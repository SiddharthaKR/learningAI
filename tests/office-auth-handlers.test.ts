import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAccountStore } from "../src/server/accounts.ts";
import { createAuthHandlers } from "../src/server/auth-handlers.ts";

const secret = "a-test-secret-longer-than-thirty-two-characters";
const jsonRequest = (route: string, body: object, language = "en-US") => new Request(`http://office.test${route}`, {
  method: "POST", headers: { "content-type": "application/json", "accept-language": language }, body: JSON.stringify(body),
});

it("signs up, logs in, and logs out with scoped cookies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lh-auth-handlers-"));
  try {
    const handlers = createAuthHandlers(createAccountStore(root), secret);
    const signup = await handlers.signup(jsonRequest("/api/auth/signup", { username: "colleague", password: "correct horse battery staple" }, "ja-JP, en;q=0.8"));
    assert.equal(signup.status, 201);
    assert.equal((await signup.json()).account.uiLanguage, "ja");
    assert.match(signup.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax; Path=\/; Max-Age=/u);
    const login = await handlers.login(jsonRequest("/api/auth/login", { username: "colleague", password: "correct horse battery staple" }));
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie") ?? "", /^lh_session=/u);
    const logout = await handlers.logout();
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects invalid login and rate limits both public endpoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lh-auth-handlers-"));
  try {
    const handlers = createAuthHandlers(createAccountStore(root), secret, { signupLimit: 1, loginLimit: 1 });
    assert.equal((await handlers.signup(jsonRequest("/api/auth/signup", { username: "learner", password: "correct horse battery staple", language: "en" }))).status, 201);
    assert.equal((await handlers.signup(jsonRequest("/api/auth/signup", { username: "another", password: "correct horse battery staple" }))).status, 429);
    assert.equal((await handlers.login(jsonRequest("/api/auth/login", { username: "learner", password: "wrong" }))).status, 401);
    assert.equal((await handlers.login(jsonRequest("/api/auth/login", { username: "learner", password: "correct horse battery staple" }))).status, 429);
  } finally { await rm(root, { recursive: true, force: true }); }
});
