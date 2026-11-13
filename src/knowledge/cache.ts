import { stat } from "node:fs/promises";
import { readKnowledgeSnapshot, type KnowledgeSnapshot } from "./index-store.ts";
import type { ChunkPart, PreparedRankerData, Ranker } from "./search.ts";

/** Personal entries unused for this long are dropped (lazily, on the next cache access). */
export const PERSONAL_IDLE_TTL_MS = 30 * 60 * 1000;

export interface CachedStore {
	snapshot: KnowledgeSnapshot;
	part: ChunkPart;
}

interface Entry {
	revision: string;
	store: CachedStore;
	personal: boolean;
	lastUsed: number;
}

export interface KnowledgeCacheOptions {
	now?: () => number;
	personalIdleTtlMs?: number;
}

/** mtime + size: every write is an atomic rename, so any change moves at least one of them. */
async function revisionOf(file: string): Promise<string> {
	try {
		const info = await stat(file);
		return `${info.mtimeMs}:${info.size}`;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		throw error;
	}
}

/**
 * Per-process cache of parsed knowledge snapshots, one entry per index file (store identity =
 * its path: admin index, shared uploads root, one personal root per user). Each access stats the
 * file (cheap); only a changed revision re-reads and re-parses THAT store. Each entry also
 * memoizes every ranker's prepared data (keyed by ranker name), so tokenizing happens once per
 * store revision instead of once per search.
 */
export class KnowledgeCache {
	private readonly entries = new Map<string, Entry>();
	private readonly pending = new Map<string, Promise<Entry>>();
	private readonly now: () => number;
	private readonly ttl: number;
	/** Test/diagnostic counter: snapshot file reads performed. */
	reads = 0;

	constructor(options: KnowledgeCacheOptions = {}) {
		this.now = options.now ?? Date.now;
		this.ttl = options.personalIdleTtlMs ?? PERSONAL_IDLE_TTL_MS;
	}

	get size(): number { return this.entries.size; }
	has(file: string): boolean { return this.entries.has(file); }

	private evictIdlePersonal(): void {
		const cutoff = this.now() - this.ttl;
		for (const [key, entry] of this.entries) if (entry.personal && entry.lastUsed < cutoff) this.entries.delete(key);
	}

	/** `kind` only decides eviction: shared/admin entries stay while valid, personal ones expire when idle. */
	async get(file: string, kind: "shared" | "personal"): Promise<CachedStore> {
		this.evictIdlePersonal();
		// Stat BEFORE reading: if the file is replaced in between we hold newer data under an
		// older revision, which just triggers one extra rebuild, never a stale hit.
		const revision = await revisionOf(file);
		const existing = this.entries.get(file);
		if (existing && existing.revision === revision) {
			existing.lastUsed = this.now();
			return existing.store;
		}
		const flightKey = `${file}|${revision}`;
		let flight = this.pending.get(flightKey);
		if (!flight) {
			flight = this.build(file, revision, kind === "personal").finally(() => this.pending.delete(flightKey));
			this.pending.set(flightKey, flight);
		}
		const entry = await flight;
		entry.lastUsed = this.now();
		this.entries.set(file, entry);
		return entry.store;
	}

	private async build(file: string, revision: string, personal: boolean): Promise<Entry> {
		this.reads++;
		const snapshot = await readKnowledgeSnapshot(file);
		const prepared = new Map<string, PreparedRankerData>();
		const part: ChunkPart = {
			chunks: snapshot.chunks,
			prepared(ranker: Ranker) {
				if (!ranker.prepare || !ranker.name) return undefined;
				if (!prepared.has(ranker.name)) prepared.set(ranker.name, ranker.prepare(snapshot.chunks));
				return prepared.get(ranker.name);
			},
		};
		return { revision, store: { snapshot, part }, personal, lastUsed: this.now() };
	}
}

const g = globalThis as typeof globalThis & { __lhKnowledgeCache?: KnowledgeCache };
/** globalThis-backed (like src/server/user-scope.ts): Next bundles routes separately, each with its own module copy. */
export function processKnowledgeCache(): KnowledgeCache {
	return (g.__lhKnowledgeCache ??= new KnowledgeCache());
}
