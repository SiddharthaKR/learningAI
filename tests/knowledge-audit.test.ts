import assert from "node:assert/strict";
import { after, before, beforeEach, it } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import {
  appendSharedKnowledgeAudit,
  isAdminUser,
  readSharedKnowledgeAudit,
  type SharedKnowledgeAuditEvent,
} from "../src/server/knowledge-audit.ts";

// bootstrap.mjs points LH_DATA_DIR at a mkdtemp directory; guard that these tests never touch the real data/.
const auditDir = path.join(PATHS.data, "shared", "knowledge");
const auditFile = path.join(auditDir, "audit.jsonl");
const originalAdmin = process.env.LH_ADMIN_USERNAME;

let admin: Account;
let other: Account;

before(async () => {
  assert.ok(PATHS.data.startsWith(os.tmpdir()), `audit tests must use a temp data dir, got ${PATHS.data}`);
  const accounts = createAccountStore(PATHS.data);
  admin = await accounts.create("audit-admin", "correct horse battery staple", "en");
  other = await accounts.create("audit-other", "correct horse battery staple", "en");
});

beforeEach(async () => {
  await rm(auditFile, { force: true });
});

after(() => {
  if (originalAdmin === undefined) delete process.env.LH_ADMIN_USERNAME;
  else process.env.LH_ADMIN_USERNAME = originalAdmin;
});

function event(overrides: Partial<SharedKnowledgeAuditEvent> = {}): SharedKnowledgeAuditEvent {
  return {
    at: "2026-11-13T00:00:00.000Z",
    userId: admin.id,
    username: admin.username,
    action: "add",
    fileName: "notes.pdf",
    documentId: "a".repeat(64),
    ...overrides,
  };
}

it("appends events and reads them back newest first", async () => {
  const first = event({ fileName: "first.pdf", at: "2026-11-13T00:00:01.000Z" });
  const second = event({ fileName: "second.pdf", action: "delete", at: "2026-11-13T00:00:02.000Z" });
  await appendSharedKnowledgeAudit(first);
  await appendSharedKnowledgeAudit(second);
  assert.deepEqual(await readSharedKnowledgeAudit(), [second, first]);
});

it("returns an empty list when the audit file is missing", async () => {
  assert.deepEqual(await readSharedKnowledgeAudit(), []);
});

it("skips malformed lines", async () => {
  await mkdir(auditDir, { recursive: true });
  const good = event({ fileName: "good.pdf" });
  const later = event({ fileName: "later.pdf", at: "2026-11-13T00:00:05.000Z" });
  await writeFile(auditFile, [JSON.stringify(good), "{not json", "", JSON.stringify(later)].join("\n") + "\n");
  assert.deepEqual(await readSharedKnowledgeAudit(), [later, good]);
});

it("isAdminUser is true only for the configured username", async () => {
  process.env.LH_ADMIN_USERNAME = `  ${admin.username}  `;
  assert.equal(await isAdminUser(admin.id), true);
  assert.equal(await isAdminUser(other.id), false);
  assert.equal(await isAdminUser("no-such-user-id"), false);
});

it("isAdminUser is false when LH_ADMIN_USERNAME is unset or empty", async () => {
  delete process.env.LH_ADMIN_USERNAME;
  assert.equal(await isAdminUser(admin.id), false);
  process.env.LH_ADMIN_USERNAME = "   ";
  assert.equal(await isAdminUser(admin.id), false);
});
