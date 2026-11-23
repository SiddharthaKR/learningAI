/**
 * SERVER-ONLY (never in the core barrel, like layout-settle.ts). Runs graph settles in one long-lived worker thread (owner, 2026-11-24) so a
 * large layout never blocks other users' requests. If the worker cannot start
 * or dies, the settle computes on this thread instead: same result, the old
 * blocking cost, and an error in the log.
 */
import { Worker } from "node:worker_threads";
import type { Position } from "./contracts.ts";
import { computeSettledLayout, settleGraphLayoutOffThread, settleHoldingLedger, withLayoutLedger, type LayoutRunner, type SettleInput } from "./layout-settle.ts";

type Pending = { input: SettleInput; resolve: (positions: Record<string, Position> | null) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let unavailable = false;
let nextId = 0;
const pending = new Map<number, Pending>();

/** Finish every pending settle on this thread (worker crashed or failed to load). */
function computeInline(reason: unknown): void {
	console.error("[layout] worker unavailable, settling on the main thread:", reason instanceof Error ? reason.message : reason);
	for (const [id, request] of pending) {
		pending.delete(id);
		try { request.resolve(computeSettledLayout(request.input)); }
		catch (error) { request.reject(error instanceof Error ? error : new Error(String(error))); }
	}
}

/** The suite settles inline (a test process must exit promptly; the worker
 *  test opts in with LH_LAYOUT_WORKER=1 and stops it when done). */
function workerEnabled(): boolean {
	return process.env.NODE_ENV !== "test" || process.env.LH_LAYOUT_WORKER === "1";
}

function layoutWorker(): Worker | null {
	if (worker || unavailable || !workerEnabled()) return worker;
	try {
		const started = new Worker(new URL("./layout-worker.ts", import.meta.url));
		started.unref();
		started.on("message", ({ id, positions, error }: { id: number; positions?: Record<string, Position> | null; error?: string }) => {
			const request = pending.get(id);
			if (!request) return;
			pending.delete(id);
			if (!pending.size) started.unref();
			if (error !== undefined) request.reject(new Error(error));
			else request.resolve(positions ?? null);
		});
		started.on("error", (error) => {
			worker = null;
			unavailable = true;
			computeInline(error);
		});
		started.on("exit", (code) => {
			if (worker !== started) return;
			worker = null;
			if (pending.size) computeInline(new Error(`layout worker exited with code ${code}`));
		});
		worker = started;
	} catch (error) {
		unavailable = true;
		console.error("[layout] worker could not start:", error instanceof Error ? error.message : error);
	}
	return worker;
}

/** Stop the worker (tests, shutdown). Pending settles finish inline. */
export async function stopLayoutWorker(): Promise<void> {
	const active = worker;
	worker = null;
	if (!active) return;
	if (pending.size) computeInline(new Error("layout worker stopped"));
	await active.terminate();
}

/** Compute one settle in the worker (or inline when the worker is unavailable). */
export const runLayoutInWorker: LayoutRunner = (input) => {
	const active = layoutWorker();
	if (!active) return Promise.resolve(computeSettledLayout(input));
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { input, resolve, reject });
		active.ref();
		active.postMessage({ id, input });
	});
};

/** Settle a graph store's layout off the request thread. */
export function settleGraphLayoutInBackground(graphStore: Parameters<typeof settleGraphLayoutOffThread>[0]): Promise<void> {
	return settleGraphLayoutOffThread(graphStore, runLayoutInWorker);
}

/** Settle from inside withLayoutLedger (the positions commit holds the ledger across write + settle). */
export function settleGraphLayoutHoldingLedger(graphStore: Parameters<typeof settleHoldingLedger>[0]): Promise<void> {
	return settleHoldingLedger(graphStore, runLayoutInWorker);
}

export { withLayoutLedger };
