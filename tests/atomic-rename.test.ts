/**
 * CHAT-01 (eval 2026-11-24): a transient Windows EPERM on the atomic-publish
 * rename dropped a finished reply from the saved chat. Every store rename now
 * retries briefly on EPERM/EBUSY/EACCES and still throws anything else.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it, mock } from "node:test";
import { RENAME_RETRY_DELAYS_MS, renameSyncWithRetry } from "../src/store/atomic-rename.ts";

const fail = (code: string) => Object.assign(new Error(code), { code });

describe("renameSyncWithRetry", () => {
	it("retries transient lock errors, then succeeds", () => {
		let calls = 0;
		renameSyncWithRetry("a", "b", () => { calls++; if (calls < 3) throw fail(calls === 1 ? "EPERM" : "EBUSY"); });
		assert.equal(calls, 3);
	});

	it("throws other errors at once, and a lock that never clears after the last retry", () => {
		let calls = 0;
		assert.throws(() => renameSyncWithRetry("a", "b", () => { calls++; throw fail("ENOENT"); }), /ENOENT/);
		assert.equal(calls, 1);
		calls = 0;
		assert.throws(() => renameSyncWithRetry("a", "b", () => { calls++; throw fail("EACCES"); }), /EACCES/);
		assert.equal(calls, RENAME_RETRY_DELAYS_MS.length + 1);
	});

	it("a chat save survives a transient EPERM on publish (the reply is not lost)", async () => {
		const { chatStore } = await import("./support/test-stores.ts");
		const chat = chatStore.createChat("Test: rename retry");
		const real = fs.renameSync;
		let failed = 0;
		const spy = mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
			if (failed < 2) { failed++; throw fail("EPERM"); }
			return real(from, to);
		});
		try {
			chatStore.saveMessages(chat.id, [{ id: "u1", role: "user", content: "2", timestamp: 1 }, { id: "a1", role: "assistant", content: [{ type: "text", text: "Correct!" }], stopReason: "stop", timestamp: 2 }] as never);
		} finally { spy.mock.restore(); }
		assert.equal(failed, 2);
		assert.deepEqual(chatStore.getChat(chat.id)!.messages.map((m) => m.id), ["u1", "a1"]);
	});
});
