/**
 * The Probing preference (owner, 2026-11-25): Short (default) ends probing
 * after 3 answers; Long lets the tutor decide. Stored like Reasoning: only
 * the non-default "long" is written.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAccountStore } from "../src/server/accounts.ts";
import { PATHS } from "../config.ts";

describe("the Probing preference on the account", () => {
	it("defaults to short, stores only long, and switches back", async () => {
		const accounts = createAccountStore(PATHS.data);
		const account = await accounts.create("probingpref", "long-test-password", "en");
		assert.equal(account.probing, undefined, "absent means short");
		const long = await accounts.updatePreferences(account.id, { probing: "long" });
		assert.equal(long.probing, "long");
		const languageOnly = await accounts.updatePreferences(account.id, { uiLanguage: "ja" });
		assert.equal(languageOnly.probing, "long", "other preference saves keep the setting");
		const short = await accounts.updatePreferences(account.id, { probing: "short" });
		assert.equal(short.probing, undefined, "short is stored as absent");
	});

	it("rejects anything but short or long", async () => {
		const accounts = createAccountStore(PATHS.data);
		const account = await accounts.create("probingbad", "long-test-password", "en");
		await assert.rejects(
			accounts.updatePreferences(account.id, { probing: "medium" as never }),
			/Probing must be short or long/,
		);
	});
});
