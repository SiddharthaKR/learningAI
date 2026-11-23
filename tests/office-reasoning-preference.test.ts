/**
 * The office Reasoning preference (owner, 2026-11-23): a per-user switch on
 * the Preferences page, default on, governing tutor turns only. Off reaches
 * the wire as reasoning_effort "none" (Ollama) plus
 * chat_template_kwargs.enable_thinking false (the Gemma 4 proxy).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAccountStore } from "../src/server/accounts.ts";
import { withOfficeThinking } from "../src/agent/models.ts";
import { PATHS } from "../config.ts";

describe("the Reasoning preference on the account", () => {
	it("defaults to on, stores only off, and switches back on", async () => {
		const accounts = createAccountStore(PATHS.data);
		const account = await accounts.create("reasoningpref", "long-test-password", "en");
		assert.equal(account.reasoning, undefined, "absent means on");
		const off = await accounts.updatePreferences(account.id, { reasoning: false });
		assert.equal(off.reasoning, false);
		assert.equal((await accounts.byId(account.id))?.reasoning, false);
		const languageOnly = await accounts.updatePreferences(account.id, { uiLanguage: "ja" });
		assert.equal(languageOnly.reasoning, false, "other preference saves keep the switch");
		const on = await accounts.updatePreferences(account.id, { reasoning: true });
		assert.equal(on.reasoning, undefined, "on is stored as absent");
	});

	it("rejects a non-boolean value", async () => {
		const accounts = createAccountStore(PATHS.data);
		const account = await accounts.create("reasoningbad", "long-test-password", "en");
		await assert.rejects(
			accounts.updatePreferences(account.id, { reasoning: "no" as unknown as boolean }),
			/Reasoning must be on or off/,
		);
	});
});

describe("withOfficeThinking (the wire signals)", () => {
	it("on: keeps pi's reasoning_effort and enables the template switch", () => {
		assert.deepEqual(withOfficeThinking({ model: "m", reasoning_effort: "medium" }), {
			model: "m",
			reasoning_effort: "medium",
			chat_template_kwargs: { enable_thinking: true },
		});
	});

	it("off: sends reasoning_effort none and disables the template switch", () => {
		assert.deepEqual(withOfficeThinking({ model: "m" }), {
			model: "m",
			reasoning_effort: "none",
			chat_template_kwargs: { enable_thinking: false },
		});
	});

	it("keeps other template kwargs and never mutates the input", () => {
		const input = { reasoning_effort: "none", chat_template_kwargs: { preserve: 1 } };
		const out = withOfficeThinking(input);
		assert.deepEqual(out, { reasoning_effort: "none", chat_template_kwargs: { preserve: 1, enable_thinking: false } });
		assert.deepEqual(input, { reasoning_effort: "none", chat_template_kwargs: { preserve: 1 } });
	});

	it("passes non-object payloads through", () => {
		assert.equal(withOfficeThinking(null), null);
		assert.equal(withOfficeThinking("x"), "x");
	});
});
