/**
 * Which session type the current page belongs to — for the sidebar's
 * "Filter by type", which follows it (owner, 2026-11-19). `key` identifies
 * the page (a session id, or the new-session draft and its mode): the filter
 * follows only when the key changes, so a filter picked by hand stays until
 * you move to another session or draft.
 */
export type FollowedKind = "teach" | "practice" | "chat";

export function pageSessionKind(
	pathname: string,
	search: string,
	chats: ReadonlyArray<{ id: string; kind?: "teach" | "practice" | "chat" }> | null,
): { key: string; kind: FollowedKind } | null {
	if (pathname === "/chat/new") {
		const mode = new URLSearchParams(search).get("mode");
		const kind: FollowedKind = mode === "practice" ? "practice" : mode === "chat" ? "chat" : "teach";
		return { key: `new:${kind}`, kind };
	}
	const match = /^\/chat\/([^/]+)$/u.exec(pathname);
	if (!match || !chats) return null;
	const chat = chats.find((c) => c.id === match[1]);
	if (!chat) return null;
	return { key: chat.id, kind: chat.kind ?? "teach" };
}
