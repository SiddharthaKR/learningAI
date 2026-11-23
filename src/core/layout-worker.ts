/**
 * The graph layout worker (owner, 2026-11-24): runs computeSettledLayout off
 * the request thread. One message in ({ id, input }), one message out
 * ({ id, positions } or { id, error }). Started by layout-runner.ts.
 */
import { parentPort } from "node:worker_threads";
import { computeSettledLayout, type SettleInput } from "./layout-settle.ts";

parentPort?.on("message", ({ id, input }: { id: number; input: SettleInput }) => {
	try {
		parentPort!.postMessage({ id, positions: computeSettledLayout(input) });
	} catch (error) {
		parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
});
