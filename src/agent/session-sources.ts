/**
 * Persistent session source store: URL → fetched content, one JSON file per chat.
 *
 * The researcher's web_fetch calls pass through here so the verifier
 * sub-agent can compare teaching claims against the raw source material
 * without re-fetching. Persisted to data/users/<userId>/sources/<chatId>.json
 * so sources survive server restarts. Entries older than 30 days are
 * auto-pruned on read.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { currentUserId } from "../server/user-scope.ts";

export interface SourceEntry {
	url: string;
	fetchedAt: string;
	contentType: string;
	markdownContent: string;
}

const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sourcesDir(): string {
	const userId = currentUserId();
	return path.join(PATHS.data, "users", userId, "sources");
}

function sourceFile(chatId: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(chatId)) throw new Error(`Invalid chat id: ${chatId}`);
	return path.join(sourcesDir(), `${chatId}.json`);
}

function readRaw(chatId: string): Record<string, SourceEntry> {
	try {
		return JSON.parse(fs.readFileSync(sourceFile(chatId), "utf-8")) as Record<string, SourceEntry>;
	} catch {
		return {};
	}
}

function writeRaw(chatId: string, entries: Record<string, SourceEntry>): void {
	const dir = sourcesDir();
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(sourceFile(chatId), JSON.stringify(entries, null, "\t"), "utf-8");
}

function prune(entries: Record<string, SourceEntry>): Record<string, SourceEntry> {
	const cutoff = Date.now() - PRUNE_AGE_MS;
	const result: Record<string, SourceEntry> = {};
	for (const [url, entry] of Object.entries(entries)) {
		if (new Date(entry.fetchedAt).getTime() >= cutoff) {
			result[url] = entry;
		}
	}
	return result;
}

export function getSessionSources(chatId: string): Map<string, SourceEntry> {
	const raw = prune(readRaw(chatId));
	const map = new Map<string, SourceEntry>();
	for (const [url, entry] of Object.entries(raw)) {
		map.set(url, entry);
	}
	return map;
}

export function addSessionSource(chatId: string, url: string, markdown: string): void {
	const entries = readRaw(chatId);
	entries[url] = {
		url,
		fetchedAt: new Date().toISOString(),
		contentType: "text/markdown",
		markdownContent: markdown,
	};
	writeRaw(chatId, entries);
}

export function clearSessionSources(chatId: string): void {
	try {
		fs.unlinkSync(sourceFile(chatId));
	} catch {
		// File didn't exist — nothing to clear.
	}
}
