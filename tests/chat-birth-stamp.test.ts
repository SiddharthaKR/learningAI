import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "lh-office-session-model-"));
process.env.LH_DATA_DIR = tmpData;
const { POST } = await import("../app/api/chats/route.ts");
const { writeSettings, TEST_SETTINGS_FILE, chatStore } = await import("./support/test-stores.ts");
const { fixedOfficeModelSpec } = await import("../src/server/office-config.ts");

after(() => fs.rmSync(tmpData, { recursive: true, force: true }));

function post(): Promise<Response> {
  return POST(new Request("http://test/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "teach me the chain rule" }),
  }));
}

describe("POST /api/chats — fixed office model", () => {
  it("ignores configurable account model settings", async () => {
    writeSettings({ version: 1, models: { strong: { model: { provider: "openrouter", id: "some-user-model" }, thinkingLevel: "low" } } });
    const response = await post();
    assert.equal(response.status, 200);
    const { id } = await response.json() as { id: string };
    assert.deepEqual(chatStore.getChat(id)?.settings, { model: fixedOfficeModelSpec() });
  });

  it("uses the fixed office model when no personal settings exist", async () => {
    fs.rmSync(TEST_SETTINGS_FILE, { force: true });
    const response = await post();
    assert.equal(response.status, 200);
    const { id } = await response.json() as { id: string };
    assert.deepEqual(chatStore.getChat(id)?.settings, { model: fixedOfficeModelSpec() });
  });

  it("settings changes do not alter existing or new sessions", async () => {
    writeSettings({ version: 1, models: { strong: { model: { provider: "openrouter", id: "old-model" } } } });
    const first = await (await post()).json() as { id: string };
    writeSettings({ version: 1, models: { strong: { model: { provider: "openai", id: "new-model" } } } });
    const second = await (await post()).json() as { id: string };
    assert.deepEqual(chatStore.getChat(first.id)?.settings, { model: fixedOfficeModelSpec() });
    assert.deepEqual(chatStore.getChat(second.id)?.settings, { model: fixedOfficeModelSpec() });
  });
});
