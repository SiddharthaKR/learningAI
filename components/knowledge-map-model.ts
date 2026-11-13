/**
 * Pure model for the Knowledge page Map tab (owner-approved 2026-11-13):
 * layout, scope filtering, counts, find, citation text. No DOM and no React
 * here, so every rule is unit-testable; components/knowledge-map.tsx wires it
 * to GraphCanvasRenderer.
 */
import {
	fuzzyScore,
	formatMessage,
	type KnowledgeMapEdge,
	type KnowledgeMapNode,
	type KnowledgeMapResponse,
	type KnowledgeScope,
} from "@/src/core";
import type { KnowledgeCitation } from "../src/knowledge/contracts.ts";

/** Colors: shared = teal, personal = purple (readable on light and dark). */
export const SCOPE_COLORS: Record<KnowledgeScope, string> = {
	shared: "#14b8a6",
	personal: "#a855f7",
};

export type ScopeFilter = Record<KnowledgeScope, boolean>;
export const ALL_SCOPES: ScopeFilter = { shared: true, personal: true };

/** Toggle one chip. The LAST active chip cannot be turned off (no-op). */
export function toggleScope(filter: ScopeFilter, scope: KnowledgeScope): ScopeFilter {
	if (filter[scope] && !(filter.shared && filter.personal)) return filter;
	return { ...filter, [scope]: !filter[scope] };
}

export interface LaidOutNode {
	node: KnowledgeMapNode;
	x: number;
	y: number;
	/** Disc radius multiplier on the renderer's nodeSize. */
	radius: number;
}

export interface KnowledgeMapLayout {
	nodes: LaidOutNode[];
	edges: KnowledgeMapEdge[];
}

const RING = 14; // world units between tree depths
const CELL_PAD = 10;

export function nodeRadius(node: KnowledgeMapNode): number {
	const weight = Math.log10(Math.max(node.chunkCount, 0) + 1);
	return node.kind === "document"
		? 1.8 + Math.min(weight * 0.3, 0.6)
		: 0.8 + Math.min(weight * 0.4, 0.8);
}

/**
 * Deterministic radial-tree layout. Visible = nodes whose scope is on; edges
 * are kept only between visible nodes. Each document is the root of its own
 * radial tree (angular span proportional to leaf count); the trees sit in a
 * square grid of equal cells, in response order. Same input, same output.
 */
export function layoutKnowledgeMap(
	response: KnowledgeMapResponse,
	visibleScopes: ScopeFilter,
): KnowledgeMapLayout {
	const nodes = response.nodes.filter((n) => visibleScopes[n.scope]);
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const edges = response.edges.filter((e) => byId.has(e.from) && byId.has(e.to));

	const children = new Map<string, string[]>();
	const hasParent = new Set<string>();
	for (const e of edges) {
		if (hasParent.has(e.to)) continue; // a tree: first parent wins
		hasParent.add(e.to);
		const list = children.get(e.from);
		if (list) list.push(e.to);
		else children.set(e.from, [e.to]);
	}
	// Roots: documents first (in order), then any parentless orphan.
	const roots = nodes.filter((n) => !hasParent.has(n.id));

	const seen = new Set<string>();
	const leaves = new Map<string, number>();
	const countLeaves = (id: string, guard: Set<string>): number => {
		if (guard.has(id)) return 1;
		guard.add(id);
		const kids = children.get(id) ?? [];
		const total = kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + countLeaves(k, guard), 0);
		leaves.set(id, total);
		return total;
	};

	type Local = { id: string; x: number; y: number };
	const trees: { locals: Local[]; extent: number }[] = [];
	for (const root of roots) {
		countLeaves(root.id, new Set());
		const locals: Local[] = [];
		let extent = 0;
		const place = (id: string, depth: number, a0: number, a1: number) => {
			if (seen.has(id)) return;
			seen.add(id);
			const mid = (a0 + a1) / 2;
			const r = depth * RING;
			locals.push({ id, x: depth === 0 ? 0 : Math.cos(mid) * r, y: depth === 0 ? 0 : Math.sin(mid) * r });
			extent = Math.max(extent, r);
			const kids = children.get(id) ?? [];
			const total = kids.reduce((sum, k) => sum + (leaves.get(k) ?? 1), 0) || 1;
			let at = a0;
			for (const k of kids) {
				const span = ((a1 - a0) * (leaves.get(k) ?? 1)) / total;
				place(k, depth + 1, at, at + span);
				at += span;
			}
		};
		place(root.id, 0, -Math.PI / 2, (3 * Math.PI) / 2);
		trees.push({ locals, extent });
	}

	const cell = 2 * Math.max(0, ...trees.map((t) => t.extent)) + CELL_PAD * 2;
	const cols = Math.max(1, Math.ceil(Math.sqrt(trees.length)));
	const rows = Math.ceil(trees.length / cols);
	const placed = new Map<string, { x: number; y: number }>();
	trees.forEach((tree, i) => {
		const cx = ((i % cols) - (cols - 1) / 2) * cell;
		const cy = (Math.floor(i / cols) - (rows - 1) / 2) * cell;
		for (const l of tree.locals) placed.set(l.id, { x: cx + l.x, y: cy + l.y });
	});

	return {
		nodes: nodes
			.filter((n) => placed.has(n.id))
			.map((node) => ({ node, ...placed.get(node.id)!, radius: nodeRadius(node) })),
		edges,
	};
}

export function countVisible(nodes: readonly KnowledgeMapNode[]): { documents: number; sections: number } {
	let documents = 0;
	for (const n of nodes) if (n.kind === "document") documents++;
	return { documents, sections: nodes.length - documents };
}

export function nodePathText(node: KnowledgeMapNode): string {
	return node.kind === "document" ? node.fileName : node.path.join(" › ");
}

/** Fuzzy find over label and full path of the given (visible) nodes. */
export function findSections(nodes: readonly KnowledgeMapNode[], query: string, limit = 8): KnowledgeMapNode[] {
	if (!query.trim()) return [];
	return nodes
		.map((node, order) => ({ node, order, score: fuzzyScore(query, node.label, node.path.join(" › ")) }))
		.filter((r): r is typeof r & { score: number } => r.score !== null)
		.sort((a, b) => b.score - a.score || a.order - b.order)
		.slice(0, limit)
		.map((r) => r.node);
}

/** "page 3" / "slide 2" / "¶14" / "lines 10–24" (templates come from locales). */
export function formatCitation(
	citation: KnowledgeCitation,
	copy: { citationPage: string; citationSlide: string; citationLines: string },
): string {
	switch (citation.format) {
		case "pdf":
			return formatMessage(copy.citationPage, { n: citation.page });
		case "pptx":
			return formatMessage(copy.citationSlide, { n: citation.slide });
		case "docx":
			return `¶${citation.paragraph}`;
		default:
			return formatMessage(copy.citationLines, { from: citation.lineStart, to: citation.lineEnd });
	}
}

export function sectionUrl(node: KnowledgeMapNode): string {
	return `/api/knowledge/section?scope=${node.scope}&doc=${encodeURIComponent(node.documentId)}&path=${encodeURIComponent(JSON.stringify(node.path))}`;
}
