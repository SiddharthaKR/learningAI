/**
 * The sidebar's "Filter by type" follows the session you are in (owner,
 * 2026-11-19): opening a session, or a new Teaching/Practice/Chat draft,
 * switches the filter to that type; a filter picked by hand stays until you
 * move to another session or draft.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageSessionKind } from "../components/sidebar-kind.ts";

const chats = [
	{ id: "chat_a", kind: "practice" as const },
	{ id: "chat_b", kind: "chat" as const },
	{ id: "chat_c" }, // older records carry no kind: teaching
];

describe("pageSessionKind", () => {
	it("an open session: its own type, keyed by the session", () => {
		assert.deepEqual(pageSessionKind("/chat/chat_a", "", chats), { key: "chat_a", kind: "practice" });
		assert.deepEqual(pageSessionKind("/chat/chat_b", "", chats), { key: "chat_b", kind: "chat" });
		assert.deepEqual(pageSessionKind("/chat/chat_c", "", chats), { key: "chat_c", kind: "teach" });
	});

	it("a new-session draft: the mode in the address, teaching by default", () => {
		assert.deepEqual(pageSessionKind("/chat/new", "?mode=practice", chats), { key: "new:practice", kind: "practice" });
		assert.deepEqual(pageSessionKind("/chat/new", "?mode=chat", chats), { key: "new:chat", kind: "chat" });
		assert.deepEqual(pageSessionKind("/chat/new", "", chats), { key: "new:teach", kind: "teach" });
	});

	it("nothing to follow: home, other pages, or a session the list has not loaded yet", () => {
		assert.equal(pageSessionKind("/", "", chats), null);
		assert.equal(pageSessionKind("/knowledge", "", chats), null);
		assert.equal(pageSessionKind("/chat/chat_new_unknown", "", chats), null);
		assert.equal(pageSessionKind("/chat/chat_a", "", null), null);
	});
});
