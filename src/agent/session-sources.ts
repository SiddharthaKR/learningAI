/**
 * In-memory session source store: URL → fetched markdown content.
 *
 * The researcher's web_fetch calls pass through here so the verifier
 * sub-agent can compare teaching claims against the raw source material
 * without re-fetching. Ephemeral — cleared on server restart.
 */

export interface SourceEntry {
	url: string;
	markdown: string;
	fetchedAt: string;
}

const stores = new Map<string, Map<string, SourceEntry>>();

export function getSessionSources(chatId: string): Map<string, SourceEntry> {
	let store = stores.get(chatId);
	if (!store) {
		store = new Map();
		stores.set(chatId, store);
	}
	return store;
}

export function addSessionSource(chatId: string, url: string, markdown: string): void {
	const store = getSessionSources(chatId);
	store.set(url, { url, markdown, fetchedAt: new Date().toISOString() });
}

export function clearSessionSources(chatId: string): void {
	stores.delete(chatId);
}
