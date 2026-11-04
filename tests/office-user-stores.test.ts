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

it("keeps every personal knowledge index under its owner and resolves the runtime loader by owner", async () => {
  const { indexKnowledgeDocument, loadKnowledgeChunks } = await import("../src/knowledge/service.ts");
  const { createAccountStore } = await import("../src/server/accounts.ts");
  const accounts = createAccountStore(root);
  const aliceAccount = await accounts.create("knowledge_alice", "correct horse battery staple", "en");
  const bobAccount = await accounts.create("knowledge_bob", "correct horse battery staple", "en");
  const a = storesForUser(aliceAccount.id);
  const b = storesForUser(bobAccount.id);
  const alice = await indexKnowledgeDocument({ fileName: "alice.txt", data: Buffer.from("alice fire") });
  const bob = await indexKnowledgeDocument({ fileName: "bob.txt", data: Buffer.from("bob fire") });
  await a.knowledgeStore.writeSnapshot({ version: 1, generatedAt: new Date().toISOString(), documents: [alice.document], chunks: alice.chunks });
  assert.deepEqual((await b.knowledgeStore.readSnapshot()).documents, []);
  await b.knowledgeStore.writeSnapshot({ version: 1, generatedAt: new Date().toISOString(), documents: [bob.document], chunks: bob.chunks });
  assert.deepEqual((await a.knowledgeStore.readSnapshot()).documents.map((d) => d.fileName), ["alice.txt"]);
  assert.deepEqual((await b.knowledgeStore.readSnapshot()).documents.map((d) => d.fileName), ["bob.txt"]);
  assert.deepEqual(await readdir(path.join(root, "users", aliceAccount.id, "knowledge")), ["index.json"]);
  assert.deepEqual(await readdir(path.join(root, "users", bobAccount.id, "knowledge")), ["index.json"]);
  assert.match(await readFile(path.join(root, "users", aliceAccount.id, "knowledge", "index.json"), "utf8"), /alice fire/u);
  assert.deepEqual((await loadKnowledgeChunks(aliceAccount.id, { sharedIndexFile: path.join(root, "absent-shared.json") })).map((c) => c.text), ["alice fire"]);
  assert.deepEqual((await loadKnowledgeChunks(bobAccount.id, { sharedIndexFile: path.join(root, "absent-shared.json") })).map((c) => c.text), ["bob fire"]);
});
