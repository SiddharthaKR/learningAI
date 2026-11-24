import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearStaleAccountLock, createAccountStore } from "../src/server/accounts.ts";

it("atomically allows only one concurrent signup for a username", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lh-accounts-"));
  try {
    const accounts = createAccountStore(root);
    const outcomes = await Promise.allSettled([
      accounts.create("colleague", "a long passphrase", "ja"),
      accounts.create("colleague", "another long passphrase", "en"),
    ]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
    const persisted = JSON.parse(await readFile(path.join(root, "accounts.json"), "utf8"));
    assert.equal(persisted.accounts.length, 1);
    assert.equal(persisted.accounts[0].username, "colleague");
    assert.equal("password" in persisted.accounts[0], false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("verifies the password without exposing the hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lh-accounts-"));
  try {
    const accounts = createAccountStore(root);
    const created = await accounts.create("learner", "correct horse battery staple", "en");
    assert.equal((await accounts.verify("learner", "wrong")), null);
    assert.equal((await accounts.verify("learner", "correct horse battery staple"))?.id, created.id);
    assert.equal("passwordHash" in created, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("a lock left by a crashed run blocks signup until server start clears it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lh-accounts-"));
  try {
    await writeFile(path.join(root, ".accounts.lock"), "");
    const accounts = createAccountStore(root);
    await assert.rejects(accounts.create("learner", "a long passphrase", "en"), /Account file is locked/);
    assert.equal(await clearStaleAccountLock(root), true);
    assert.equal(await clearStaleAccountLock(root), false, "nothing left to clear");
    assert.equal((await accounts.create("learner", "a long passphrase", "en")).username, "learner");
  } finally { await rm(root, { recursive: true, force: true }); }
});
