import assert from "node:assert/strict";
import { after, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "lh-approval-owner-"));
process.env.LH_DATA_DIR = root;
process.env.APPROVAL_TIMEOUT_SECONDS = "1";
const { runAsUser } = await import("../src/server/user-scope.ts");
const { storesForUser } = await import("../src/server/stores.ts");
const { requestWebApproval, pendingApprovalsForChat, decideWebApproval } = await import("../src/server/web-approvals.ts");
after(async () => { await rm(root, { recursive: true, force: true }); });

it("requires the recorded owner for listing and deciding approvals", async () => {
  const chat = storesForUser("alice").chatStore.createChat("Research");
  const decision = runAsUser("alice", () => requestWebApproval({ ownerId: "alice", chatId: chat.id, tool: "web_fetch", value: "https://example.com", reason: "read", chunks: [], validate: async () => {} }));
  const pending = runAsUser("alice", () => pendingApprovalsForChat({ userId: "alice" }, chat.id));
  assert.equal(pending?.length, 1);
  const callId = pending![0]!.callId;
  assert.equal(runAsUser("alice", () => pendingApprovalsForChat({ userId: "bob" }, chat.id)), null);
  assert.equal(await runAsUser("alice", () => decideWebApproval({ userId: "bob" }, chat.id, callId, "allow")), null);
  await runAsUser("alice", () => decideWebApproval({ userId: "alice" }, chat.id, callId, "deny"));
  assert.equal(await decision, null);
});
