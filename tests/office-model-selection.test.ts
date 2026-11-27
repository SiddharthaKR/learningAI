/**
 * Model selection (owner, 2026-11-27): model 1 is LLM_*, then LLM_2_*,
 * LLM_3_*… each with its own server URL. A session is created with a picked
 * model (by name) and keeps it for everything it runs; a model that is no
 * longer configured moves the session to model 1 with one UI-only line.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "lh-office-model-selection-"));
process.env.LH_DATA_DIR = tmpData;
// Model 2 on another host (the Mac at .187 in production).
process.env.LLM_2_BASE_URL = "http://10.0.0.187:1234/v1";
process.env.LLM_2_MODEL = "openai/gpt-oss-20b";
process.env.LLM_2_CONTEXT_WINDOW = "32768";
process.env.LLM_2_MAX_TOKENS = "4096";
process.env.LLM_2_VISION = "false";
process.env.LLM_2_REASONING = "true";
process.env.NO_PROXY = `${process.env.NO_PROXY},10.0.0.187`;

const { officeModels, officeModel, officeModelSpecFor, fixedOfficeModelSpec } = await import("../src/server/office-config.ts");
const { POST } = await import("../app/api/chats/route.ts");
const { chatStore } = await import("./support/test-stores.ts");
const { piEngineForSpec } = await import("../src/agent/models.ts");
const { sessionModelSpec } = await import("../src/server/chat-handler.ts");
const { newModelSwitchedMessage } = await import("../src/core/model-switch.ts");
const { toLlmMessages } = await import("../src/core/native-messages.ts");
const { projectView } = await import("../src/core/view.ts");

after(() => fs.rmSync(tmpData, { recursive: true, force: true }));

const MODEL_1 = process.env.LLM_MODEL!;

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
	for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
	try { fn(); } finally {
		for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
	}
}

function post(body: Record<string, unknown>): Promise<Response> {
	return POST(new Request("http://test/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "teach me ohms law", ...body }),
	}));
}

describe("officeModels", () => {
	it("reads model 1 from LLM_* and model 2 from LLM_2_*, each with its own URL", () => {
		const models = officeModels();
		assert.deepEqual(models.map((m) => m.model), [MODEL_1, "openai/gpt-oss-20b"]);
		assert.deepEqual(officeModel("openai/gpt-oss-20b"), {
			baseUrl: "http://10.0.0.187:1234/v1", model: "openai/gpt-oss-20b",
			contextWindow: 32768, maxTokens: 4096, vision: false, reasoning: true,
		});
		assert.equal(models[0]!.baseUrl, process.env.LLM_BASE_URL!.replace(/\/$/u, ""));
	});

	it("stops at the first missing number", () => {
		withEnv({ LLM_4_BASE_URL: "http://10.0.0.187:1234/v1", LLM_4_MODEL: "skipped" }, () => {
			assert.equal(officeModels().length, 2, "no LLM_3_* — LLM_4_* is not read");
		});
	});

	it("names the missing setting, the unlisted host and a repeated name", () => {
		withEnv({ LLM_3_BASE_URL: "http://10.0.0.187:1234/v1", LLM_3_MODEL: "qwen/qwen3.5-9b" }, () => {
			assert.throws(() => officeModels(), /LLM_3_CONTEXT_WINDOW is required/);
		});
		withEnv({ LLM_3_BASE_URL: "http://10.9.9.9:1234/v1", LLM_3_MODEL: "x" }, () => {
			assert.throws(() => officeModels(), /NO_PROXY must include the internal LLM host 10\.9\.9\.9/);
		});
		withEnv({
			LLM_3_BASE_URL: "http://10.0.0.187:1234/v1", LLM_3_MODEL: "openai/gpt-oss-20b", LLM_3_CONTEXT_WINDOW: "1",
			LLM_3_MAX_TOKENS: "1", LLM_3_VISION: "false", LLM_3_REASONING: "false",
		}, () => {
			assert.throws(() => officeModels(), /configured twice/);
		});
	});

	it("keeps the old single-model .env working unchanged", () => {
		withEnv({ LLM_2_BASE_URL: undefined, LLM_2_MODEL: undefined }, () => {
			assert.deepEqual(officeModels().map((m) => m.model), [MODEL_1]);
		});
	});
});

describe("a session's model", () => {
	it("is the stored model while configured, else model 1", () => {
		assert.deepEqual(officeModelSpecFor("openai/gpt-oss-20b"), { provider: "office", id: "openai/gpt-oss-20b" });
		assert.deepEqual(officeModelSpecFor("removed-model"), fixedOfficeModelSpec());
		assert.deepEqual(officeModelSpecFor(undefined), fixedOfficeModelSpec());
	});

	it("builds its engine against its own server and limits", () => {
		const engine = piEngineForSpec({ provider: "office", id: "openai/gpt-oss-20b" });
		assert.equal(engine.model.baseUrl, "http://10.0.0.187:1234/v1");
		assert.equal(engine.model.contextWindow, 32768);
		assert.equal(engine.model.maxTokens, 4096);
	});
});

describe("POST /api/chats with a picked model", () => {
	it("stamps the picked model on the new session; jobs and compaction read it", async () => {
		const response = await post({ model: "openai/gpt-oss-20b" });
		assert.equal(response.status, 200);
		const { id } = await response.json() as { id: string };
		assert.deepEqual(chatStore.getChat(id)?.settings, { model: { provider: "office", id: "openai/gpt-oss-20b" } });
		assert.deepEqual(sessionModelSpec(id, chatStore), { provider: "office", id: "openai/gpt-oss-20b" });
	});

	it("uses model 1 when no model is sent, and refuses an unknown name", async () => {
		const { id } = await (await post({})).json() as { id: string };
		assert.deepEqual(chatStore.getChat(id)?.settings, { model: fixedOfficeModelSpec() });
		assert.equal((await post({ model: "not-configured" })).status, 400);
		assert.equal((await post({ model: 7 })).status, 400);
	});

	it("moves a session whose office model was removed — or with another provider's pin — to model 1", async () => {
		const { id } = await (await post({ model: "openai/gpt-oss-20b" })).json() as { id: string };
		chatStore.saveSettings(id, { model: { provider: "office", id: "removed-model" } });
		assert.deepEqual(sessionModelSpec(id, chatStore), fixedOfficeModelSpec());
		chatStore.saveSettings(id, { model: { provider: "openrouter", id: "openai/gpt-oss-20b" } });
		assert.deepEqual(sessionModelSpec(id, chatStore), fixedOfficeModelSpec(), "only office pins select a model");
	});

	it("gives notes extraction (no chat) model 1", () => {
		assert.deepEqual(sessionModelSpec(undefined, chatStore), fixedOfficeModelSpec());
		assert.deepEqual(sessionModelSpec("src_notes", chatStore), fixedOfficeModelSpec());
	});
});

describe("the model-switched line", () => {
	it("is shown in the chat and never sent to the model", () => {
		const line = newModelSwitchedMessage("chat_x", "openai/gpt-oss-20b", MODEL_1);
		const record = [{ id: "u1", role: "user", content: "hi", timestamp: 1 }, line];
		assert.ok(!JSON.stringify(toLlmMessages(record as never)).includes("gpt-oss"));
		const parts = projectView(record as never).flatMap((m) => m.parts);
		assert.deepEqual(parts.find((p) => p.type === "data-model-switched")?.data, { from: "openai/gpt-oss-20b", to: MODEL_1 });
	});

	it("uses the approved wording in both languages", async () => {
		const en = JSON.parse(fs.readFileSync("locales/en.json", "utf8"));
		const ja = JSON.parse(fs.readFileSync("locales/ja.json", "utf8"));
		assert.equal(en.chat.modelSwitched, "{old} is no longer available. Continuing with {new}.");
		assert.equal(ja.chat.modelSwitched, "{old} は利用できなくなりました。{new} で続けます。");
	});
});
