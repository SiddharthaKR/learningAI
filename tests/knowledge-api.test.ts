import assert from "node:assert/strict";
import { before, it } from "node:test";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { createSessionToken } from "../src/server/session-auth.ts";
import { checkedStoresForUser } from "../src/server/stores.ts";
import { GET, POST } from "../app/api/knowledge/documents/route.ts";
import { DELETE } from "../app/api/knowledge/documents/[id]/route.ts";
import { MAX_KNOWLEDGE_UPLOAD_BYTES } from "../src/knowledge/upload.ts";
import { pdfFixture, officeZip, slideXml, documentXml, paragraphXml } from "./fixtures/knowledge/builders.ts";
import nextConfig from "../next.config.ts";
import { loadKnowledgeChunks } from "../src/knowledge/service.ts";

let a: Account;
let b: Account;
before(async () => {
  delete process.env.LH_TEST_USER_ID;
  const accounts = createAccountStore(PATHS.data);
  a = await accounts.create("knowledge-a", "correct horse battery staple", "en");
  b = await accounts.create("knowledge-b", "correct horse battery staple", "ja");
});
function headers(owner?: Account): Headers {
  return new Headers(owner ? { cookie: `lh_session=${createSessionToken(owner.id, process.env.SESSION_SECRET!)}` } : {});
}
function upload(owner: Account | undefined, fileName: string, data: Uint8Array | string, type = "", destination?: string): Request {
  const form = new FormData();
  form.set("file", new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type }), fileName);
  if (destination) form.set("destination", destination);
  return new Request("http://office.test/api/knowledge/documents", { method: "POST", headers: headers(owner), body: form });
}

it("extracts a chat-only presentation without publishing it, and shares only explicitly shared uploads", async () => {
  const deck = officeZip({ "ppt/slides/slide1.xml": slideXml(["Unique attachment slide"]) });
  const attached = await POST(upload(a, "attach.pptx", deck, "", "chat"));
  assert.equal(attached.status, 200);
  assert.match((await attached.json()).text, /Unique attachment slide/);
  assert.ok(!(await loadKnowledgeChunks(a.id)).some((chunk) => chunk.citation.fileName === "attach.pptx"));
  assert.equal((await POST(upload(a, "personal.pptx", deck, "", "personal"))).status, 200);
  assert.ok(!(await loadKnowledgeChunks(b.id)).some((chunk) => chunk.citation.fileName === "personal.pptx"));
  assert.equal((await POST(upload(a, "shared.pptx", deck, "", "shared"))).status, 200);
  for (const owner of [a, b]) {
    assert.ok((await loadKnowledgeChunks(owner.id)).some((chunk) => chunk.citation.fileName === "shared.pptx"));
  }
});
const list = (owner?: Account) => GET(new Request("http://office.test/api/knowledge/documents", { headers: headers(owner) }));
const remove = (owner: Account | undefined, id: string) => DELETE(new Request(`http://office.test/api/knowledge/documents/${id}`, { method: "DELETE", headers: headers(owner) }), { params: Promise.resolve({ id }) });

it("rejects unauthenticated list, upload, and delete consistently", async () => {
  for (const response of [await list(), await POST(upload(undefined, "guide.txt", "text")), await remove(undefined, "a".repeat(64))]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Authentication required" });
  }
});

it("uploads all five accepted formats and preserves extracted citation metadata", async () => {
  const fixtures: Array<[string, Uint8Array | string, object]> = [
    ["guide.md", "# Safety\nJapanese office safety", { format: "md", fileName: "guide.md", heading: "Safety", lineStart: 1, lineEnd: 2 }],
    ["guide.txt", "Fire evacuation guide", { format: "txt", fileName: "guide.txt", lineStart: 1, lineEnd: 1 }],
    ["guide.pdf", pdfFixture(["Safety PDF"]), { format: "pdf", fileName: "guide.pdf", page: 1 }],
    ["guide.pptx", officeZip({ "ppt/slides/slide1.xml": slideXml(["Safety slide"]) }), { format: "pptx", fileName: "guide.pptx", slide: 1, title: "Safety slide" }],
    ["guide.docx", officeZip({ "word/document.xml": documentXml([paragraphXml("Safety paragraph")]) }), { format: "docx", fileName: "guide.docx", paragraph: 1 }],
  ];
  for (const [fileName, data, citation] of fixtures) {
    const response = await POST(upload(a, fileName, data));
    assert.equal(response.status, 200);
    const { document } = await response.json();
    assert.equal(document.fileName, fileName);
    assert.equal(document.status, "ready");
    const snapshot = await checkedStoresForUser(a.id).knowledgeStore.readSnapshot();
    assert.deepEqual(snapshot.chunks.find((chunk) => chunk.sourceId === document.id)?.citation, citation);
    assert.ok((await readFile(path.join(checkedStoresForUser(a.id).root, "knowledge", "documents", document.id))).length > 0);
  }
});

it("deduplicates identical bytes across names, including simultaneous uploads, separately per owner", async () => {
  const responses = await Promise.all([POST(upload(a, "first.txt", "unique duplicate bytes")), POST(upload(a, "renamed.md", "unique duplicate bytes"))]);
  for (const response of responses) assert.equal(response.status, 200);
  const [first, second] = await Promise.all(responses.map((response) => response.json()));
  assert.equal(first.document.id, second.document.id);
  const store = checkedStoresForUser(a.id);
  const snapshot = await store.knowledgeStore.readSnapshot();
  assert.equal(snapshot.documents.filter((document) => document.id === first.document.id).length, 1);
  assert.equal(snapshot.chunks.filter((chunk) => chunk.sourceId === first.document.id).length, 1);
  assert.equal((await readdir(path.join(store.root, "knowledge", "documents"))).filter((name) => name === first.document.id).length, 1);
  const other = await POST(upload(b, "first.txt", "unique duplicate bytes"));
  assert.equal(other.status, 200);
  assert.equal((await (await list(b)).json()).documents.length, 1);
});

it("hides another owner's IDs and deletes only the selected owner's source, record, and chunks", async () => {
  const { document } = await (await POST(upload(b, "private.txt", "only owner B secret"))).json();
  assert.equal((await (await list(a)).json()).documents.some((item: { id: string }) => item.id === document.id), false);
  const forbidden = await remove(a, document.id);
  const unknown = await remove(a, "f".repeat(64));
  assert.equal(forbidden.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await forbidden.json(), await unknown.json());
  const aBefore = await checkedStoresForUser(a.id).knowledgeStore.readSnapshot();
  assert.equal((await remove(b, document.id)).status, 200);
  const bStore = checkedStoresForUser(b.id);
  const bAfter = await bStore.knowledgeStore.readSnapshot();
  assert.equal(bAfter.documents.some((item) => item.id === document.id), false);
  assert.equal(bAfter.chunks.some((chunk) => chunk.sourceId === document.id), false);
  await assert.rejects(stat(path.join(bStore.root, "knowledge", "documents", document.id)), { code: "ENOENT" });
  assert.deepEqual(await checkedStoresForUser(a.id).knowledgeStore.readSnapshot(), aBefore);
});

it("rejects unsupported extensions and mismatched MIME types before storing", async () => {
  for (const [name, mime] of [["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["app.exe", ""], ["fake.txt", "application/vnd.ms-excel"]]) {
    const response = await POST(upload(a, name!, "unaccepted bytes", mime));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "unsupported_format" });
  }
});

it("enforces exactly 100 MiB on actual bytes, even when reported size lies", async () => {
  assert.equal(MAX_KNOWLEDGE_UPLOAD_BYTES, 104_857_600);
  const store = checkedStoresForUser(a.id).knowledgeStore;
  // Whitespace keeps extraction/chunking cheap while exercising real byte-length enforcement.
  const bytes = new Uint8Array(MAX_KNOWLEDGE_UPLOAD_BYTES + 1).fill(32);
  const exact = await store.uploadDocument({ fileName: "boundary.txt", data: bytes.subarray(0, MAX_KNOWLEDGE_UPLOAD_BYTES) });
  assert.equal(exact.status, "ready");
  await assert.rejects(store.uploadDocument({ fileName: "over.txt", data: bytes }), /too_large/u);
  const request = upload(a, "oversized.txt", bytes);
  request.headers.set("content-length", "1");
  assert.equal((await POST(request)).status, 413);
  const snapshot = await store.readSnapshot();
  assert.equal(snapshot.documents.some((document) => document.fileName === "over.txt" || document.fileName === "oversized.txt"), false);
});

it("preserves the supported 100 MiB multipart upload envelope through the Next proxy configuration", () => {
  assert.equal(MAX_KNOWLEDGE_UPLOAD_BYTES, 104_857_600);
  const supportedMultipartEnvelope = MAX_KNOWLEDGE_UPLOAD_BYTES + 65_536;
  assert.equal(supportedMultipartEnvelope, 104_923_136);
  const configuredProxyLimit = nextConfig.experimental?.proxyClientMaxBodySize;
  assert.equal(typeof configuredProxyLimit, "number", "Next proxy must have an explicit numeric body-buffer limit");
  assert.ok((configuredProxyLimit as number) >= supportedMultipartEnvelope, "Next proxy must preserve the complete supported multipart envelope");
});

it("returns scanned PDF status with a stable explanation and no chunks", async () => {
  const response = await POST(upload(a, "scan.pdf", pdfFixture([null])));
  assert.equal(response.status, 200);
  const { document } = await response.json();
  assert.equal(document.status, "no_text_layer");
  assert.equal(document.explanationCode, "no_text_layer");
  assert.equal((await checkedStoresForUser(a.id).knowledgeStore.readSnapshot()).chunks.some((chunk) => chunk.sourceId === document.id), false);
});
