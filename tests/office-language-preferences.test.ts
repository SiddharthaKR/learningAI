import assert from "node:assert/strict";
import { it } from "node:test";
import { createAccountStore } from "../src/server/accounts.ts";
import { storesForUser } from "../src/server/stores.ts";
import { PATHS } from "../config.ts";

it("account preference changes do not alter the teaching language of an existing session", async () => {
  const accounts = createAccountStore(PATHS.data);
  const account = await accounts.create("japaneselearner", "long-test-password", "ja");
  assert.equal(account.uiLanguage, "ja");
  assert.equal(account.teachingLanguage, "ja");
  const chats = storesForUser(account.id).chatStore;
  const existing = chats.createChat("Existing lesson", undefined, account.teachingLanguage);
  assert.equal(existing.teachingLanguage, "ja");
  const updated = await accounts.updatePreferences(account.id, { uiLanguage: "en", teachingLanguage: "en", background: "FPGA engineer" });
  assert.equal(updated.uiLanguage, "en");
  assert.equal(updated.background, "FPGA engineer");
  assert.equal(chats.getChat(existing.id)?.teachingLanguage, "ja");
  const next = chats.createChat("New lesson", undefined, updated.teachingLanguage);
  assert.equal(next.teachingLanguage, "en");
});
