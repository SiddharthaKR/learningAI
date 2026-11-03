import assert from "node:assert/strict";
import { after, it } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "lh-chat-isolation-"));
process.env.LH_DATA_DIR = root;
process.env.LLM_BASE_URL = "http://127.0.0.1:1234/v1";
process.env.LLM_MODEL = "test-model";
process.env.LLM_CONTEXT_WINDOW = "8192";
process.env.LLM_MAX_TOKENS = "512";
process.env.LLM_VISION = "false";
process.env.LLM_REASONING = "false";
process.env.LLM_TOOL_MODE = "native";
process.env.NO_PROXY = "127.0.0.1";
process.env.SESSION_SECRET = "a-test-secret-longer-than-thirty-two-characters";
const { createAccountStore } = await import("../src/server/accounts.ts");
const { createSessionToken } = await import("../src/server/session-auth.ts");
const chats = await import("../app/api/chats/route.ts");
const oneChat = await import("../app/api/chats/[id]/route.ts");
after(async () => { await rm(root, { recursive: true, force: true }); });

it("keeps chat creation, listing, and direct reads separate for two users", async () => {
  const accounts = createAccountStore(root);
  const alice = await accounts.create("alice", "correct horse battery staple", "en");
  const bob = await accounts.create("bob", "correct horse battery staple", "ja");
  const request = (id: string, url: string, method = "GET", body?: object) => new Request(url, {
    method, headers: { cookie: `lh_session=${createSessionToken(id, process.env.SESSION_SECRET!)}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const created = await chats.POST(request(alice.id, "http://office.test/api/chats", "POST", { title: "Alice topic" }));
  assert.equal(created.status, 200);
  const { id } = await created.json();
  assert.equal((await oneChat.GET(request(bob.id, `http://office.test/api/chats/${id}`), { params: Promise.resolve({ id }) })).status, 404);
  assert.deepEqual((await (await chats.GET(request(bob.id, "http://office.test/api/chats"))).json()).chats, []);
  assert.equal((await readdir(path.join(root, "users", alice.id, "chats"))).length, 1);
  assert.equal((await readdir(path.join(root, "users", bob.id, "chats")).catch((): string[] => [])).length, 0);
});
