import assert from "node:assert/strict";
import os from "node:os";
import { after, before, it } from "node:test";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { createSessionToken } from "../src/server/session-auth.ts";
import { readSharedKnowledgeAudit } from "../src/server/knowledge-audit.ts";
import { sharedKnowledgeStore } from "../src/server/stores.ts";
import { GET, POST } from "../app/api/knowledge/documents/route.ts";
import { DELETE } from "../app/api/knowledge/documents/[id]/route.ts";
import { GET as AUDIT_GET } from "../app/api/knowledge/audit/route.ts";

let a: Account;
let b: Account;
const originalAdmin = process.env.LH_ADMIN_USERNAME;

before(async () => {
  assert.ok(PATHS.data.startsWith(os.tmpdir()), `tests must use a temp data dir, got ${PATHS.data}`);
  delete process.env.LH_TEST_USER_ID;
  const accounts = createAccountStore(PATHS.data);
  a = await accounts.create("shared-a", "correct horse battery staple", "en");
  b = await accounts.create("shared-b", "correct horse battery staple", "en");
});
after(() => {
  if (originalAdmin === undefined) delete process.env.LH_ADMIN_USERNAME;
  else process.env.LH_ADMIN_USERNAME = originalAdmin;
});

function headers(owner: Account): Headers {
  return new Headers({ cookie: `lh_session=${createSessionToken(owner.id, process.env.SESSION_SECRET!)}` });
}
function upload(owner: Account, fileName: string, text: string, destination?: string): Request {
  const form = new FormData();
  form.set("file", new Blob([text]), fileName);
  if (destination) form.set("destination", destination);
  return new Request("http://office.test/api/knowledge/documents", { method: "POST", headers: headers(owner), body: form });
}
const list = (owner: Account) => GET(new Request("http://office.test/api/knowledge/documents", { headers: headers(owner) }));
const remove = (owner: Account, id: string, scoped: boolean) =>
  DELETE(new Request(`http://office.test/api/knowledge/documents/${id}${scoped ? "?scope=shared" : ""}`, { method: "DELETE", headers: headers(owner) }), { params: Promise.resolve({ id }) });
const audit = (owner: Account) => AUDIT_GET(new Request("http://office.test/api/knowledge/audit", { headers: headers(owner) }));

it("shared upload by A appends one add event and lists in shared", async () => {
  const before = (await readSharedKnowledgeAudit()).length;
  const response = await POST(upload(a, "shared-one.txt", "shared handbook text one", "shared"));
  assert.equal(response.status, 200);
  const { document } = await response.json();
  const events = await readSharedKnowledgeAudit();
  assert.equal(events.length, before + 1);
  assert.equal(events[0]!.action, "add");
  assert.equal(events[0]!.username, a.username);
  assert.equal(events[0]!.fileName, "shared-one.txt");
  assert.equal(events[0]!.documentId, document.id);
  const listed = await (await list(b)).json();
  assert.ok(listed.sharedDocuments.some((d: { id: string }) => d.id === document.id));
  assert.ok(!listed.documents.some((d: { id: string }) => d.id === document.id));
});

it("any user can delete a shared doc with scope=shared, and the delete is audited", async () => {
  const { document } = await (await POST(upload(a, "shared-two.txt", "shared handbook text two", "shared"))).json();
  const response = await remove(b, document.id, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  const snapshot = await sharedKnowledgeStore.readSnapshot();
  assert.equal(snapshot.documents.some((d) => d.id === document.id), false);
  const newest = (await readSharedKnowledgeAudit())[0]!;
  assert.equal(newest.action, "delete");
  assert.equal(newest.username, b.username);
  assert.equal(newest.fileName, "shared-two.txt");
  assert.equal(newest.documentId, document.id);
});

it("shared delete of an unknown id is 404 and adds no audit event", async () => {
  const before = (await readSharedKnowledgeAudit()).length;
  const response = await remove(a, "e".repeat(64), true);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal((await readSharedKnowledgeAudit()).length, before);
});

it("delete without scope cannot touch a shared document", async () => {
  const { document } = await (await POST(upload(a, "shared-three.txt", "shared handbook text three", "shared"))).json();
  const before = (await readSharedKnowledgeAudit()).length;
  const response = await remove(a, document.id, false);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.ok((await sharedKnowledgeStore.readSnapshot()).documents.some((d) => d.id === document.id));
  assert.equal((await readSharedKnowledgeAudit()).length, before);
});

it("personal upload (no destination) writes no audit event", async () => {
  const before = (await readSharedKnowledgeAudit()).length;
  const response = await POST(upload(a, "personal-only.txt", "personal only text"));
  assert.equal(response.status, 200);
  assert.equal((await readSharedKnowledgeAudit()).length, before);
  assert.ok(!(await readSharedKnowledgeAudit()).some((e) => e.fileName === "personal-only.txt"));
});

it("GET /api/knowledge/audit is 403 unless the caller is the configured admin", async () => {
  try {
    delete process.env.LH_ADMIN_USERNAME;
    let response = await audit(a);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "forbidden" });
    process.env.LH_ADMIN_USERNAME = a.username;
    response = await audit(b);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "forbidden" });
    response = await audit(a);
    assert.equal(response.status, 200);
    const { events } = await response.json();
    assert.ok(events.length >= 2);
    assert.deepEqual(events, await readSharedKnowledgeAudit());
    const times = events.map((e: { at: string }) => Date.parse(e.at));
    for (let i = 1; i < times.length; i++) assert.ok(times[i - 1]! >= times[i]!, "newest first");
  } finally {
    if (originalAdmin === undefined) delete process.env.LH_ADMIN_USERNAME;
    else process.env.LH_ADMIN_USERNAME = originalAdmin;
  }
});
