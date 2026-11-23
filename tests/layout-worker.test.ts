/**
 * THE OFF-THREAD SETTLE (owner, 2026-11-24): graph layout computes in a worker
 * thread so a large settle never stalls other users. Same result as the inline
 * compute; reruns when the graph changes mid-compute; settles and position
 * writes are serialized.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { GraphChain, GraphNode, Position } from "../src/core/contracts.ts";
process.env.LH_LAYOUT_WORKER = "1";
const { runLayoutInWorker, stopLayoutWorker } = await import("../src/core/layout-runner.ts");
after(() => stopLayoutWorker());
import { computeSettledLayout, settleGraphLayoutOffThread, withLayoutLedger, type SettleInput } from "../src/core/layout-settle.ts";

const node = (id: string): GraphNode => ({ id, name: id, statement: id, aliases: [], createdAt: "2026-09-13T00:00:00.000Z", provenance: [] });
const chain = (id: string, premises: string[], conclusion: string): GraphChain => ({ id, premises, conclusion, provenance: [], createdAt: "2026-09-13T00:00:00.000Z" });

describe("off-thread graph settle", () => {
	it("the worker returns exactly the inline result", async () => {
		const input: SettleInput = {
			nodes: ["a", "b", "c", "d", "e"].map(node),
			chains: [chain("arg_ab", ["a"], "b"), chain("arg_bcd", ["b", "c"], "d")],
			previous: { a: { x: 10, y: 20 } },
		};
		assert.deepEqual(await runLayoutInWorker(input), computeSettledLayout(input));
		assert.equal(await runLayoutInWorker({ nodes: [], chains: [], previous: {} }), null);
	});

	it("reruns when nodes are added while computing, so the ledger covers them", async () => {
		const lines = ["a", "b"].map(node);
		const written: Array<Record<string, Position>> = [];
		let runs = 0;
		const store = {
			readNodes: () => [...lines],
			readChains: () => [],
			readPositions: () => ({}),
			writePositions: (positions: Record<string, Position>) => void written.push(positions),
		};
		await settleGraphLayoutOffThread(store, async (input) => {
			runs++;
			if (runs === 1) lines.push(node("c")); // a merge lands mid-compute
			return computeSettledLayout(input);
		});
		assert.equal(runs, 2);
		assert.equal(written.length, 1);
		assert.deepEqual(Object.keys(written[0]!).sort(), ["a", "b", "c"]);
	});

	it("serializes ledger work: a write queued during a settle runs after it", async () => {
		const order: string[] = [];
		let release!: () => void;
		const settle = settleGraphLayoutOffThread(
			{ readNodes: () => [node("a")], readChains: () => [], readPositions: () => ({}), writePositions: () => void order.push("settle-write") },
			async (input) => { await new Promise<void>((resolve) => { release = resolve; }); return computeSettledLayout(input); },
		);
		const commit = withLayoutLedger(() => void order.push("commit"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.deepEqual(order, [], "the commit waits for the in-flight settle");
		release();
		await Promise.all([settle, commit]);
		assert.deepEqual(order, ["settle-write", "commit"]);
	});
});
