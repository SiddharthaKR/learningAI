import assert from "node:assert/strict";
import { after, it } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "lh-background-owner-"));
process.env.LH_DATA_DIR = root;
const { createAccountStore } = await import("../src/server/accounts.ts");
const { checkedStoresForUser } = await import("../src/server/stores.ts");
const { stores } = await import("../src/server/stores.ts");
const { runAsBackgroundOwner } = await import("../src/server/user-scope.ts");
const { runOwnedJob } = await import("../src/server/owned-job.ts");
after(async () => { await rm(root, { recursive: true, force: true }); });

it("rechecks the explicit owner before async graph and job writes", async () => {
  const accounts = createAccountStore(root);
  const owner = await accounts.create("researcher", "correct horse battery staple", "en");
  const stores = checkedStoresForUser(owner.id);
  const chat = stores.chatStore.createChat("Owned");
  const job = stores.jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call_one" });
  assert.equal(job.ownerId, owner.id);
  stores.graphStore.writePositions({});
  await accounts.delete("researcher");
  assert.throws(() => stores.graphStore.writePositions({}), /Owner account no longer exists/u);
  assert.throws(() => stores.jobStore.updateJob(job.id, { activity: "late write" }), /Owner account no longer exists/u);
  assert.deepEqual(await readdir(path.join(root, "users", owner.id, "graph")), ["positions.json"]);
});

it("refuses another owner's job and a deleted owner's job", async () => {
  const accounts = createAccountStore(root);
  const alice = await accounts.create("job_alice", "correct horse battery staple", "en");
  const bob = await accounts.create("job_bob", "correct horse battery staple", "en");
  const ownerStores = checkedStoresForUser(alice.id);
  const chat = ownerStores.chatStore.createChat("Job owner");
  const job = ownerStores.jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call_owner" });
  let calls = 0;
  await assert.rejects(runOwnedJob(bob.id, job.id, async () => { calls++; }), /Job does not belong/u);
  assert.equal(calls, 0);
  await accounts.delete("job_alice");
  await assert.rejects(runOwnedJob(alice.id, job.id, async () => { calls++; }), /Owner account no longer exists/u);
  assert.equal(calls, 0);
});

it("rechecks a deleted owner in a delayed background continuation", async () => {
  const accounts = createAccountStore(root);
  const owner = await accounts.create("delayed", "correct horse battery staple", "en");
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const task = runAsBackgroundOwner(owner.id, async () => { await gate; stores.graphStore.writePositions({}); });
  await accounts.delete("delayed");
  resume();
  await assert.rejects(task, /Owner account no longer exists/u);
});

it("rechecks background ownership on each personal knowledge read and write", async () => {
  const accounts = createAccountStore(root);
  const owner = await accounts.create("knowledge_owner", "correct horse battery staple", "en");
  const store = checkedStoresForUser(owner.id).knowledgeStore;
  const value = { version: 1 as const, generatedAt: new Date().toISOString(), documents: [], chunks: [] };
  await store.writeSnapshot(value);
  assert.deepEqual((await store.readSnapshot()).documents, []);
  await accounts.delete("knowledge_owner");
  assert.throws(() => store.readSnapshot(), /Owner account no longer exists/u);
  assert.throws(() => store.writeSnapshot(value), /Owner account no longer exists/u);
  await assert.rejects(runAsBackgroundOwner(owner.id, async () => { await stores.knowledgeStore.readSnapshot(); }), /Owner account no longer exists/u);
});

it("rejects an in-flight personal knowledge write after its owner and directory are deleted", async (context) => {
  const accounts = createAccountStore(root);
  const owner = await accounts.create("pending_knowledge", "correct horse battery staple", "en");
  const ownerStores = checkedStoresForUser(owner.id);
  const knowledgeDir = path.join(ownerStores.root, "knowledge");
  const originalMkdir = fsPromises.mkdir;
  let reached!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const intercepted = context.mock.method(fsPromises, "mkdir", async (...args: Parameters<typeof fsPromises.mkdir>) => {
    if (String(args[0]) === knowledgeDir) { reached(); await gate; }
    return originalMkdir(...args);
  });
  syncBuiltinESMExports();
  context.after(() => { intercepted.mock.restore(); syncBuiltinESMExports(); });
  const task = ownerStores.knowledgeStore.writeSnapshot({ version: 1, generatedAt: new Date().toISOString(), documents: [], chunks: [] });
  const refused = assert.rejects(task, /Owner account no longer exists/u);
  try {
    await paused;
    await accounts.delete("pending_knowledge");
    await rm(ownerStores.root, { recursive: true, force: true });
  } finally { resume(); }
  await refused;
  await assert.rejects(fsPromises.stat(path.join(knowledgeDir, "index.json")), { code: "ENOENT" });
  assert.deepEqual(await readdir(knowledgeDir).catch(() => []), []);
});

it("graph extraction keeps its explicit owner and rechecks before reading or writing", async () => {
  const accounts = createAccountStore(root);
  const alice = await accounts.create("extract_alice", "correct horse battery staple", "en");
  const bob = await accounts.create("extract_bob", "correct horse battery staple", "en");
  const aliceStores = checkedStoresForUser(alice.id);
  const bobStores = checkedStoresForUser(bob.id);
  const aliceChat = aliceStores.chatStore.createChat("Alice extraction");
  const bobChat = bobStores.chatStore.createChat("Bob extraction");
  const { extractionForOwner } = await import("../src/server/chat-handler.ts");
  const aliceExtraction = extractionForOwner(alice.id);

  await assert.rejects(aliceExtraction.runExtraction(bobChat.id), /Chat not found/u);
  assert.equal(aliceStores.chatStore.getChat(aliceChat.id)?.id, aliceChat.id);

  await accounts.delete("extract_alice");
  await assert.rejects(aliceExtraction.runExtraction(aliceChat.id), /Owner account no longer exists/u);
  assert.equal(bobStores.chatStore.getChat(bobChat.id)?.id, bobChat.id);
});
