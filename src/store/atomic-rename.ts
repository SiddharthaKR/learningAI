import fs from "node:fs";

/** Windows lock codes that clear within milliseconds: a reader, the search
 *  indexer, or antivirus holding the destination or the fresh temp file. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
/** Backoff before each retry: at most ~0.8 s in total, and only on failure. */
export const RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400] as const;

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The atomic-publish rename with a bounded retry (owner, 2026-11-24): a
 * transient Windows EPERM on rename silently dropped a finished reply from the
 * saved chat (eval CHAT-01). Synchronous like the writers that call it; any
 * other error, or the last attempt, throws as before.
 */
export function renameSyncWithRetry(from: string, to: string, rename: (from: string, to: string) => void = fs.renameSync): void {
	for (let attempt = 0; ; attempt++) {
		try {
			rename(from, to);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (attempt >= RENAME_RETRY_DELAYS_MS.length || !code || !TRANSIENT.has(code)) throw error;
			sleepSync(RENAME_RETRY_DELAYS_MS[attempt]!);
		}
	}
}
