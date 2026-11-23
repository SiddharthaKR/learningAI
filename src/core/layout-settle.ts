import type { GraphChain, GraphNode, Position } from "./contracts.ts";
import { incrementalLayout } from "./layout.ts";
import { attachImpToCommunities, birthSessionPartition } from "./session-clusters.ts";
import { deriveView, getGraph } from "./graph.ts";

/**
 * The merge-time settle: recompute the resting layout from the CURRENT
 * graph + the positions ledger, and replace the ledger. Called by the
 * extraction pipeline after every merge (the sole writer) and by the
 * positions-commit endpoint when the graph grew under a live-physics
 * commit (client positions become the anchor set). Synchronous — it must
 * finish before the next /api/graph fetch reflects the change.
 *
 * CHAINS-PRIMARY (owner, 2026-09-30): the settle lays out the DERIVED
 * view — propositions AND the derived implication nodes (one per chain,
 * arg_ ids) over the derived untyped arrows — so positions exist for
 * every node the canvas renders. Implication nodes participate in the
 * physics as regular nodes (rendering specialization comes later).
 *
 * SPLIT FROM layout.ts deliberately (2026-09-13): layout.ts is in the
 * browser barrel, and the settle needs the cluster partition for the
 * cluster centroid pull — this module must not ship in the client bundle.
 * Server code imports it DIRECTLY; it is never re-exported through
 * src/core/index.ts.
 */
/** What one settle reads: raw node and chain lines plus the current ledger. */
export interface SettleInput {
	nodes: GraphNode[];
	chains: GraphChain[];
	previous: Record<string, Position>;
}

/** The pure settle: the resting ledger for the graph, or null for an empty
 *  graph. Runs in the layout worker (layout-worker.ts) or inline. */
export function computeSettledLayout(input: SettleInput): Record<string, Position> | null {
	const graph = getGraph({ readNodes: () => input.nodes, readChains: () => input.chains });
	if (graph.nodes.length === 0) return null;
	const view = deriveView(graph);
	const previous = new Map(Object.entries(input.previous));
	// The cluster partition for the centroid pull: the SAME birth-session
	// partition the snapshot renders (derived from provenance on read —
	// core/session-clusters.ts, wave 7) — one cluster concept everywhere.
	// PROPOSITIONS ONLY (owner, 2026-09-30): implication nodes never
	// partition; the stored world clusters, its image follows.
	const communities = birthSessionPartition(graph.nodes);
	// The SAME imp-node assignment the snapshot renders (majority among
	// premises' births — core/session-clusters.ts): the resting ledger and
	// the live sim must agree on where bundles belong, or the first live
	// tick would fight the settle. Unfiltered here (settle pulls every
	// community, hulls are a canvas-only concern).
	attachImpToCommunities(communities, graph.nodes, graph.chains);
	const next = incrementalLayout(view.nodes, view.edges, previous, {
		clusters: communities,
		logicalEdges: view.logicalEdges,
		impLinks: view.impLinks,
	});
	return Object.fromEntries(next);
}

type SettleStore = {
	readNodes(): GraphNode[];
	readChains(): GraphChain[];
	readPositions(): Record<string, Position>;
	writePositions(positions: Record<string, Position>): void;
};

function settleInput(graphStore: SettleStore): SettleInput {
	return { nodes: graphStore.readNodes(), chains: graphStore.readChains(), previous: graphStore.readPositions() };
}

/** Synchronous settle on the calling thread (tests, and the worker fallback). */
export function settleGraphLayout(graphStore: SettleStore): void {
	const positions = computeSettledLayout(settleInput(graphStore));
	if (positions) graphStore.writePositions(positions);
}

/** The derived view's node ids, sorted: what a settle result must cover. */
function viewNodeIds(input: Pick<SettleInput, "nodes" | "chains">): string {
	return deriveView(getGraph({ readNodes: () => input.nodes, readChains: () => input.chains })).nodes.map((n) => n.id).sort().join("\n");
}

/** Computes a settle off the event loop; resolves to computeSettledLayout's result. */
export type LayoutRunner = (input: SettleInput) => Promise<Record<string, Position> | null>;

// One settle or position commit at a time, process-wide (owner, 2026-11-24):
// the off-thread compute must never interleave with another ledger write.
let ledgerQueue: Promise<unknown> = Promise.resolve();
/** Run a ledger read-modify-write after every earlier one has finished. */
export function withLayoutLedger<T>(operation: () => Promise<T> | T): Promise<T> {
	const current = ledgerQueue.catch(() => {}).then(operation);
	ledgerQueue = current;
	return current;
}

/**
 * THE OFF-THREAD SETTLE (owner, 2026-11-24): the 300-tick layout ran on the
 * request thread and stalled every user (~1.3 s at 1,000 nodes). The compute
 * now runs in a worker; the read and write stay here, serialized through
 * withLayoutLedger. If the graph changed while computing, the settle reruns
 * (up to 3 tries) so the written ledger covers the current nodes.
 */
export function settleGraphLayoutOffThread(graphStore: SettleStore, run: LayoutRunner): Promise<void> {
	return withLayoutLedger(() => settleHoldingLedger(graphStore, run));
}

/** The settle body for a caller ALREADY inside withLayoutLedger (re-entering the queue would deadlock). */
export async function settleHoldingLedger(graphStore: SettleStore, run: LayoutRunner): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		const input = settleInput(graphStore);
		const positions = await run(input);
		if (!positions) return;
		const current = { nodes: graphStore.readNodes(), chains: graphStore.readChains() };
		if (attempt < 2 && viewNodeIds(current) !== viewNodeIds(input)) continue;
		graphStore.writePositions(positions);
		return;
	}
}
