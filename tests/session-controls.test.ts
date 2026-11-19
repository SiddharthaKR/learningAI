import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { it } from "node:test";
import type { ChatStore } from "../src/core/ports.ts";
import type { LhMarkerMessage, LhMessage } from "../src/core/native-messages.ts";
import { sessionControlsText } from "../src/core/contracts/chat.ts";

const { chatStore, TEST_USER_ROOT } = await import("./support/test-stores.ts");
const { storesForUser, checkedStoresForUser } = await import("../src/server/stores.ts");
const { createAccountStore } = await import("../src/server/accounts.ts");
const { createSessionToken } = await import("../src/server/session-auth.ts");
const { runAsUser } = await import("../src/server/user-scope.ts");
const { subscribeForOwner } = await import("../src/core/events.ts");
const { PUT } = await import("../app/api/chats/[id]/settings/route.ts");
const { GET } = await import("../app/api/chats/[id]/route.ts");
const { asAgentMessages, newUserMessage, toLlmMessages } = await import("../src/core/native-messages.ts");
const { projectView } = await import("../src/core/view.ts");
const { persistTurn } = await import("../src/server/turn-service.ts");
const { serializeForSummary } = await import("../src/core/compaction.ts");

const owner = process.env.LH_TEST_USER_ID!;
function request(id: string, body: unknown, userId = owner) {
  return new Request(`http://office.test/api/chats/${id}/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `lh_session=${createSessionToken(userId, process.env.SESSION_SECRET!)}` },
    body: JSON.stringify(body),
  });
}
function put(id: string, body: unknown, userId = owner) {
  return PUT(request(id, body, userId), { params: Promise.resolve({ id }) });
}
function markers(store: ChatStore, id: string) {
  return store.getChat(id)!.messages.filter((message): message is LhMarkerMessage =>
    message.role === "custom" && message.customType === "session-controls-changed");
}
function recordFile(id: string) { return path.join(TEST_USER_ROOT, "chats", `${id}.json`); }

const auditFixture = {
  id: "controls_fixture", role: "custom", customType: "session-controls-changed", content: "", display: true,
  timestamp: 1793836800000,
  details: { at: "2026-11-05T00:00:00.000Z", changes: [{ field: "webResearchEnabled", from: false, to: true }] },
} as LhMarkerMessage;

it("projects a native controls audit as a stable UI-only data part", () => {
  assert.deepEqual(projectView([auditFixture]), [{ id: "controls_fixture", role: "user", parts: [
    { type: "data-session-controls-changed", id: "sc_controls_fixture", data: auditFixture.details },
  ] }]);
});

it("explicitly omits controls audit markers from LLM messages", () => {
  assert.deepEqual(toLlmMessages(asAgentMessages([auditFixture])), []);
});

it("omits the UI-only controls audit from compaction's model input", () => {
  assert.equal(serializeForSummary([auditFixture]), "");
});

it("treats absent flags as OFF and an explicit OFF PUT as no semantic change", async () => {
  const chat = chatStore.createChat("Legacy absent controls");
  const before = fs.readFileSync(recordFile(chat.id), "utf8");
  const events: unknown[] = [];
  const off = subscribeForOwner(owner, (event) => events.push(event));
  try {
    const response = await put(chat.id, { webResearchEnabled: false, officeKnowledgeEnabled: false });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).settings, { webResearchEnabled: false, officeKnowledgeEnabled: false });
    assert.equal(markers(chatStore, chat.id).length, 0);
    assert.equal(chatStore.getChat(chat.id)!.updatedAt, chat.updatedAt);
    assert.deepEqual(events, []);
    // No-op does not publish a new record, even for an older optional-field record.
    assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), before);
  } finally { off(); }
});

it("leaves a server-stamped model pin untouched on no-op, then normalizes settings on the first controls change", async () => {
  const chat = chatStore.createChat("Server-stamped settings");
  chatStore.saveSettings(chat.id, { model: { provider: "office", id: "test-model" } });
  const before = fs.readFileSync(recordFile(chat.id), "utf8");
  const unchanged = await put(chat.id, {});
  assert.deepEqual((await unchanged.json()).settings, { webResearchEnabled: false, officeKnowledgeEnabled: false });
  assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), before);
  await put(chat.id, { webResearchEnabled: true });
  assert.deepEqual(chatStore.getChat(chat.id)!.settings, { webResearchEnabled: true, officeKnowledgeEnabled: false });
  assert.equal(markers(chatStore, chat.id).length, 1);
});

it("rejects invalid controls, model/provider/thinking overrides, and unknown fields without publication", async () => {
  const chat = chatStore.createChat("Validation");
  const before = fs.readFileSync(recordFile(chat.id), "utf8");
  const events: unknown[] = [];
  const off = subscribeForOwner(owner, (event) => events.push(event));
  try {
    for (const body of [null, [], { webResearchEnabled: "true" }, { officeKnowledgeEnabled: 1 },
      { webResearchEnabled: null }, { officeKnowledgeEnabled: {} }, { model: { provider: "x", id: "y" } },
      { provider: "x" }, { thinkingLevel: "high" }, { knowledgeUsed: false }, { other: true }]) {
      const response = await put(chat.id, body);
      assert.ok(response.status === 400 || response.status === 403, JSON.stringify(body));
      assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), before);
    }
    assert.deepEqual(events, []);
  } finally { off(); }
});

it("persists ON/OFF and both-at-once changes as one ordered neutral marker, with post-persist scoped events", async () => {
  const chat = chatStore.createChat("Audited controls", "practice", "ja");
  const initial = newUserMessage("Keep my history");
  chatStore.saveMessages(chat.id, [initial]);
  const before = chatStore.getChat(chat.id)!;
  const listOrder = chatStore.listChats().map((item) => item.id);
  const seen: unknown[] = [];
  const otherSeen: unknown[] = [];
  const off = subscribeForOwner(owner, (event) => {
    if (event.type === "record-changed") seen.push({ event, record: chatStore.getChat(chat.id) });
  });
  const offOther = subscribeForOwner("another_owner", (event) => otherSeen.push(event));
  try {
    for (const [body, expected] of [
      [{ webResearchEnabled: true, officeKnowledgeEnabled: false }, [{ field: "webResearchEnabled", from: false, to: true }]],
      [{ webResearchEnabled: false, officeKnowledgeEnabled: true }, [
        { field: "webResearchEnabled", from: true, to: false }, { field: "officeKnowledgeEnabled", from: false, to: true },
      ]],
      [{}, [{ field: "officeKnowledgeEnabled", from: true, to: false }]],
    ] as const) {
      const response = await put(chat.id, body);
      assert.equal(response.status, 200);
      const audit = markers(chatStore, chat.id).at(-1)!;
      assert.ok(audit, "a semantic settings change appends a native audit marker");
      // Owner, 2026-11-19: the note now carries one line per change for the model.
      assert.equal(audit.content, sessionControlsText({ at: (audit.details as { at: string }).at, changes: expected as never }));
      assert.equal(audit.display, true);
      const details = audit.details as { at: string; changes: unknown[] };
      assert.equal(new Date(details.at).toISOString(), details.at);
      assert.equal(audit.timestamp, Date.parse(details.at));
      assert.deepEqual(details.changes, expected);
      assert.deepEqual(Object.keys(details).sort(), ["at", "changes"]);
    }
    const loaded = chatStore.getChat(chat.id)!;
    assert.equal(markers(chatStore, chat.id).length, 3);
    assert.equal(loaded.updatedAt, before.updatedAt);
    assert.equal(loaded.title, before.title);
    assert.equal(loaded.teachingLanguage, "ja");
    assert.equal(loaded.kind, "practice");
    assert.deepEqual(loaded.messages[0], initial);
    assert.deepEqual(chatStore.listChats().map((item) => item.id), listOrder);
    assert.equal(seen.length, 3);
    assert.deepEqual(otherSeen, []);
    for (const [index, value] of seen.entries()) {
      const entry = value as { event: { chatId: string }; record: { messages: LhMessage[] } };
      assert.equal(entry.event.chatId, chat.id);
      assert.equal(entry.record.messages.length, index + 2, "event observers read already-persisted history");
    }
    const bytes = fs.readFileSync(recordFile(chat.id), "utf8");
    assert.equal((await put(chat.id, { webResearchEnabled: false, officeKnowledgeEnabled: false })).status, 200);
    assert.equal(seen.length, 3, "identical PUT is silent");
    assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), bytes);
  } finally { off(); offOther(); }
});

it("reloads the durable audit into a stable UI data part while keeping tool call/result adjacent on the wire", async () => {
  const chat = chatStore.createChat("Native protocol");
  const call = {
    id: "assistant_call", role: "assistant", api: "openai-completions", provider: "office", model: "test-model",
    content: [{ type: "toolCall", id: "question_1", name: "ask", arguments: { question: "Which?" } }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse", timestamp: 1,
  } as LhMessage;
  chatStore.saveMessages(chat.id, [call]);
  await put(chat.id, { webResearchEnabled: true, officeKnowledgeEnabled: true });
  const audit = markers(chatStore, chat.id)[0]!;
  assert.ok(audit, "the route persisted the audit");
  const result = { id: "answer", role: "toolResult", toolCallId: "question_1", toolName: "ask", content: [{ type: "text", text: "A" }], isError: false, timestamp: 2 } as LhMessage;
  chatStore.saveMessages(chat.id, [...chatStore.getChat(chat.id)!.messages, result]);
  const loaded = JSON.parse(fs.readFileSync(recordFile(chat.id), "utf8"));
  assert.deepEqual(markers(chatStore, chat.id), [audit]);
  const view = projectView(loaded.messages).find((message) => message.id === audit.id);
  assert.deepEqual(view, { id: audit.id, role: "user", parts: [{ type: "data-session-controls-changed", id: `sc_${audit.id}`, data: audit.details }] });
  // The note reaches the model (owner, 2026-11-19) but is HELD until after the
  // answer, so the tool call and its result stay adjacent on the wire.
  const wire = toLlmMessages(asAgentMessages(loaded.messages));
  assert.deepEqual(wire.map((message) => message.role), ["assistant", "toolResult", "user"]);
  assert.match(JSON.stringify(wire[2]), /web research is now ON/);
});

it("authenticates controls/history access and keeps Alice outside Bob's owner root", async () => {
  const accounts = createAccountStore(process.env.LH_DATA_DIR!);
  const bob = await accounts.create("controls-bob", "correct horse battery staple", "ja");
  const bobStore = storesForUser(bob.id).chatStore;
  const chat = runAsUser(bob.id, () => bobStore.createChat("Bob's controls"));
  assert.equal((await put(chat.id, { webResearchEnabled: true }, bob.id)).status, 200);
  const before = bobStore.getChat(chat.id);
  assert.equal((await put(chat.id, { officeKnowledgeEnabled: true })).status, 404);
  assert.equal((await GET(request(chat.id, {}), { params: Promise.resolve({ id: chat.id }) })).status, 404);
  assert.equal(chatStore.getChat(chat.id), null);
  assert.deepEqual(bobStore.getChat(chat.id), before);
  const previous = process.env.LH_TEST_USER_ID;
  delete process.env.LH_TEST_USER_ID;
  try {
    const response = await PUT(new Request(`http://office.test/api/chats/${chat.id}/settings`, { method: "PUT", body: "{}" }), { params: Promise.resolve({ id: chat.id }) });
    assert.equal(response.status, 401);
  } finally { process.env.LH_TEST_USER_ID = previous; }
});

it("marks knowledge use exactly once and preserves it through every other record writer and reload", async () => {
  const chat = chatStore.createChat("Sticky state");
  assert.equal(chatStore.markKnowledgeUsed(chat.id), true);
  const stickyBytes = fs.readFileSync(recordFile(chat.id), "utf8");
  assert.equal(chatStore.markKnowledgeUsed(chat.id), false);
  assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), stickyBytes, "idempotence performs no publication");
  assert.equal(chatStore.getChat(chat.id)!.updatedAt, chat.updatedAt);
  chatStore.saveSettings(chat.id, { webResearchEnabled: false, officeKnowledgeEnabled: false });
  chatStore.saveMessages(chat.id, [newUserMessage("Message after use")]);
  chatStore.appendTurnUsage(chat.id, { id: "turn_1", messageId: "message_1", at: chat.createdAt, model: "office:test", steps: [] });
  chatStore.appendExtractionUsage(chat.id, { startedAt: 1, at: chat.createdAt, durationMs: 1, stages: { extractor: { model: "office:test", steps: [] }, auditor: { model: "office:test", steps: [] } } });
  chatStore.saveTree(chat.id, { nodes: [], edges: [], version: 1 });
  chatStore.renameChat(chat.id, "Still sticky");
  assert.equal((await put(chat.id, { webResearchEnabled: true, officeKnowledgeEnabled: false })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(recordFile(chat.id), "utf8")).knowledgeUsed, true);
  assert.equal(chatStore.getChat(chat.id)!.knowledgeUsed, true);
  assert.equal(chatStore.markKnowledgeUsed(chat.id), false);
  assert.throws(() => chatStore.markKnowledgeUsed("chat_missing"), /not found/i);
});

it("transitions an explicitly false sticky record to true once", () => {
  const chat = chatStore.createChat("Explicit false legacy record");
  const file = recordFile(chat.id);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...record, knowledgeUsed: false }));
  assert.equal(chatStore.markKnowledgeUsed(chat.id), true);
  assert.equal(chatStore.markKnowledgeUsed(chat.id), false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).knowledgeUsed, true);
});

it("settles a deferred foreground turn against fresh state without erasing a mid-turn audit or sticky use", async () => {
  const chat = chatStore.createChat("Deferred turn");
  chatStore.saveMessages(chat.id, [newUserMessage("Start")]);
  const captured = chatStore.getChat(chat.id)!;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const turn = (async () => {
    await delayed;
    return persistTurn(chatStore, chat.id, captured.messages.length,
      asAgentMessages([...captured.messages, newUserMessage("Turn continuation")]), false);
  })();
  await put(chat.id, { officeKnowledgeEnabled: true, webResearchEnabled: false });
  assert.equal(chatStore.markKnowledgeUsed(chat.id), true);
  const audit = markers(chatStore, chat.id)[0]!;
  release();
  assert.equal((await turn).length, 1);
  assert.deepEqual(chatStore.getChat(chat.id)!.messages.map((message) => message.id), [captured.messages[0]!.id, audit.id, chatStore.getChat(chat.id)!.messages[2]!.id]);
  assert.equal(chatStore.getChat(chat.id)!.knowledgeUsed, true);
  assert.equal(chatStore.getChat(chat.id)!.settings?.officeKnowledgeEnabled, true);
});

for (const operation of ["writeFileSync", "fsyncSync", "renameSync"] as const) {
  it(`keeps the prior complete record, cleans private temps, and emits nothing when ${operation} fails`, async (context) => {
    const chat = chatStore.createChat(`Atomic failure: ${operation}`);
    const before = fs.readFileSync(recordFile(chat.id), "utf8");
    const directoryBefore = fs.readdirSync(path.dirname(recordFile(chat.id))).sort();
    const seen: unknown[] = [];
    const off = subscribeForOwner(owner, (event) => seen.push(event));
    const originalWrite = fs.writeFileSync;
    const restore = context.mock.method(fs, operation, (...args: unknown[]) => {
      // A torn write must damage only the unpublished temp, never the record.
      if (operation === "writeFileSync") originalWrite(args[0] as number, '{"incomplete":');
      throw new Error(`injected ${operation} failure`);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => put(chat.id, { webResearchEnabled: true }), /injected/);
      assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), before);
      assert.deepEqual(fs.readdirSync(path.dirname(recordFile(chat.id))).sort(), directoryBefore);
      assert.deepEqual(seen, []);
    } finally { restore.mock.restore(); syncBuiltinESMExports(); off(); }
  });
}

it("never exposes sticky success when atomic persistence fails", (context) => {
  const chat = chatStore.createChat("Sticky failure");
  const before = fs.readFileSync(recordFile(chat.id), "utf8");
  const restore = context.mock.method(fs, "renameSync", () => { throw new Error("rename unavailable"); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => chatStore.markKnowledgeUsed(chat.id), /rename unavailable/);
    assert.equal(chatStore.getChat(chat.id)!.knowledgeUsed, undefined);
    assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), before);
  } finally { restore.mock.restore(); syncBuiltinESMExports(); }
});

it("leaves an unowned temporary path untouched when exclusive creation fails", (context) => {
  const chat = chatStore.createChat("Exclusive temp creation");
  const before = fs.readFileSync(recordFile(chat.id), "utf8");
  let occupied = "";
  const restore = context.mock.method(fs, "openSync", (file: fs.PathLike) => {
    occupied = String(file);
    // Represent a coincident existing path without replacing the real store.
    fs.writeFileSync(occupied, "belongs to another publication");
    throw Object.assign(new Error("already exists"), { code: "EEXIST" });
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => chatStore.saveMessages(chat.id, []), /already exists/);
    assert.equal(fs.readFileSync(recordFile(chat.id), "utf8"), before);
    assert.equal(fs.existsSync(occupied), true, "failed exclusive open did not create a temp owned by this writer");
    assert.equal(fs.readFileSync(occupied, "utf8"), "belongs to another publication");
  } finally { restore.mock.restore(); syncBuiltinESMExports(); if (fs.existsSync(occupied)) fs.unlinkSync(occupied); }
});

it("publishes all chat mutations only inside the owner's chat directory and checked stores reject deleted owners", async (context) => {
  const chat = chatStore.createChat("Owner-bound atomic writes");
  const originalRename = fs.renameSync;
  const restore = context.mock.method(fs, "renameSync", (source: fs.PathLike, destination: fs.PathLike) => {
    assert.equal(path.dirname(String(source)), path.join(TEST_USER_ROOT, "chats"));
    assert.equal(path.dirname(String(destination)), path.join(TEST_USER_ROOT, "chats"));
    assert.notEqual(String(source), String(destination));
    assert.equal(fs.readFileSync(recordFile(chat.id), "utf8").includes('"title"'), true, "prior record remains readable before replacement");
    if (process.platform !== "win32") assert.equal(fs.statSync(source).mode & 0o777, 0o600);
    originalRename(source, destination);
  });
  syncBuiltinESMExports();
  try {
    chatStore.markKnowledgeUsed(chat.id);
    chatStore.saveSettings(chat.id, {});
    chatStore.saveMessages(chat.id, []);
    chatStore.saveTree(chat.id, { nodes: [], edges: [], version: 1 });
    chatStore.appendTurnUsage(chat.id, { id: "t", messageId: "m", at: chat.createdAt, model: "office:test", steps: [] });
    chatStore.appendExtractionUsage(chat.id, { startedAt: 1, at: chat.createdAt, durationMs: 1, stages: { extractor: { model: "office:test", steps: [] }, auditor: { model: "office:test", steps: [] } } });
    chatStore.renameChat(chat.id, "Owner-bound");
    await put(chat.id, { officeKnowledgeEnabled: true });
    assert.equal(chatStore.getChat(chat.id)!.knowledgeUsed, true);
    assert.equal(fs.existsSync(path.join(process.env.LH_DATA_DIR!, "chats")), false);
    assert.deepEqual(fs.readdirSync(path.join(TEST_USER_ROOT, "chats")).filter((file) => file.endsWith(".tmp")), []);
  } finally { restore.mock.restore(); syncBuiltinESMExports(); }
  const accounts = createAccountStore(process.env.LH_DATA_DIR!);
  const departing = await accounts.create("controls-departing", "correct horse battery staple", "en");
  const checked = checkedStoresForUser(departing.id).chatStore;
  const ownedChat = checked.createChat("Deleted owner");
  await accounts.delete("controls-departing");
  assert.throws(() => checked.markKnowledgeUsed(ownedChat.id), /no longer exists/);
  assert.throws(() => checked.saveSessionControls(ownedChat.id, { webResearchEnabled: true, officeKnowledgeEnabled: false }), /no longer exists/);
});

it("persists knowledgeScope, absent = all, with a scope audit entry and no marker for a no-op", async () => {
  const chat = chatStore.createChat("Scope controls");
  assert.equal(chatStore.getChat(chat.id)!.settings?.knowledgeScope, undefined);
  const base = { webResearchEnabled: false, officeKnowledgeEnabled: true };
  // explicit "all" on an absent scope is not a change
  await put(chat.id, base);
  const n = markers(chatStore, chat.id).length;
  assert.equal((await put(chat.id, { ...base, knowledgeScope: "all" })).status, 200);
  assert.equal(markers(chatStore, chat.id).length, n);
  const res = await put(chat.id, { ...base, knowledgeScope: "shared" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).settings.knowledgeScope, "shared");
  assert.equal(chatStore.getChat(chat.id)!.settings?.knowledgeScope, "shared");
  assert.deepEqual((markers(chatStore, chat.id).at(-1)!.details as { changes: unknown[] }).changes,
    [{ field: "knowledgeScope", from: "all", to: "shared" }]);
  await put(chat.id, { ...base, knowledgeScope: "personal" });
  assert.deepEqual((markers(chatStore, chat.id).at(-1)!.details as { changes: unknown[] }).changes,
    [{ field: "knowledgeScope", from: "shared", to: "personal" }]);
  // omitted scope on replace-whole PUT resets to all
  await put(chat.id, base);
  assert.equal(chatStore.getChat(chat.id)!.settings?.knowledgeScope, undefined);
  assert.deepEqual((markers(chatStore, chat.id).at(-1)!.details as { changes: unknown[] }).changes,
    [{ field: "knowledgeScope", from: "personal", to: "all" }]);
  for (const bad of ["everything", 3, null]) assert.equal((await put(chat.id, { ...base, knowledgeScope: bad })).status, 400);
});
