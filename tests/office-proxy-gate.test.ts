import assert from "node:assert/strict";
import { after, it } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const root = await mkdtemp(path.join(os.tmpdir(), "lh-proxy-gate-"));
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
const { proxy } = await import("../proxy.ts");
const { createAccountStore } = await import("../src/server/accounts.ts");
const { createSessionToken } = await import("../src/server/session-auth.ts");
after(async () => { await rm(root, { recursive: true, force: true }); });

async function routePaths(dir: string, segments: string[] = []): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) output.push(...await routePaths(path.join(dir, entry.name), [...segments, entry.name]));
    else if (entry.name === "route.ts") output.push("/api/" + segments.map((segment) => segment.startsWith("[") ? "sample" : segment).join("/"));
  }
  return output;
}

it("returns 401 for every protected API route without a session", async () => {
  const paths = await routePaths(path.join(process.cwd(), "app", "api"));
  assert.ok(paths.length > 20);
  for (const route of paths) {
    const response = await proxy(new NextRequest(`http://office.test${route}`));
    assert.equal(response.status, route === "/api/auth/login" || route === "/api/auth/signup" ? 200 : 401, route);
  }
});

it("allows a valid account and rejects its cookie after deletion", async () => {
  const accounts = createAccountStore(root);
  const account = await accounts.create("colleague", "correct horse battery staple", "en");
  const cookie = `lh_session=${createSessionToken(account.id, process.env.SESSION_SECRET!)}`;
  const request = () => new NextRequest("http://office.test/api/chats", { headers: { cookie } });
  assert.equal((await proxy(request())).status, 200);
  await accounts.delete("colleague");
  assert.equal((await proxy(request())).status, 401);
});
