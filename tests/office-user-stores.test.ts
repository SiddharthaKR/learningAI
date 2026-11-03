import assert from "node:assert/strict";
import { after, it } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "lh-user-stores-"));
process.env.LH_DATA_DIR = root;
const { storesForUser } = await import("../src/server/stores.ts");
const { stores } = await import("../src/server/stores.ts");
const { runAsUser } = await import("../src/server/user-scope.ts");
after(async () => { await rm(root, { recursive: true, force: true }); });

it("keeps chat and job writes within each user's directory", async () => {
  const a = storesForUser("alice");
  const b = storesForUser("bob");
  const chatA = a.chatStore.createChat("Alice lesson");
  const chatB = b.chatStore.createChat("Bob lesson");
  const jobA = a.jobStore.createJob({ chatId: chatA.id, kind: "research", toolCallId: "call_a" });
  b.jobStore.createJob({ chatId: chatB.id, kind: "research", toolCallId: "call_b" });
  assert.equal(jobA.ownerId, "alice");
  assert.equal(a.chatStore.getChat(chatB.id), null);
  assert.equal(b.chatStore.getChat(chatA.id), null);
  assert.equal((await readdir(path.join(root, "users", "alice", "chats"))).length, 1);
  assert.equal((await readdir(path.join(root, "users", "bob", "jobs"))).length, 1);
  assert.match(await readFile(path.join(root, "users", "alice", "chats", `${chatA.id}.json`), "utf8"), /Alice lesson/u);
});

it("rejects unsafe user IDs before resolving a store path", () => {
  assert.throws(() => storesForUser("../bob"), /Invalid user ID/u);
});

it("writes graph ledgers only beneath the owner", async () => {
  const a = storesForUser("graph_alice");
  a.graphStore.writePositions({});
  assert.equal((await readdir(path.join(root, "users", "graph_alice", "graph"))).includes("positions.json"), true);
  assert.equal((await readdir(path.join(root, "graph")).catch((): string[] => [])).includes("positions.json"), false);
});

it("writes settings only beneath the owner", async () => {
  const a = storesForUser("settings_alice");
  a.settingsStore.writeSettings({ version: 1 });
  assert.match(await readFile(path.join(root, "users", "settings_alice", "settings.json"), "utf8"), /"version"/u);
});

it("routes legacy service store access through the current owner", async () => {
  const chat = runAsUser("service_alice", () => stores.chatStore.createChat("Scoped lesson"));
  assert.equal(runAsUser("service_bob", () => stores.chatStore.getChat(chat.id)), null);
  assert.match(await readFile(path.join(root, "users", "service_alice", "chats", `${chat.id}.json`), "utf8"), /Scoped lesson/u);
});
