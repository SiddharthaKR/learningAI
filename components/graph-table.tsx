"use client";

/**
 * The table view of the graph page: every stored proposition as a row
 * (name, statement, the session(s) it came from, date) with a search box,
 * per-row delete and row-checkbox bulk delete. Deletion reuses the graph's
 * one confirm + endpoint flow (DeleteNodeDialog → DELETE /api/graph/nodes/:id,
 * sequential per id). Filtering and selection are pure functions, exported
 * for tests; the component only wires them to state.
 */

import { useMemo, useState } from "react";
import { SearchIcon, Trash2Icon } from "lucide-react";
import { DeleteNodeDialog } from "@/components/delete-node-dialog.tsx";
import { useI18n } from "@/components/i18n-provider";
import { formatMessage } from "@/src/core";
import type { GraphNode } from "@/src/core";

export interface GraphTableRow {
	id: string;
	name: string;
	statement: string;
	/** Display names of every session / imported file that touched the node. */
	sessions: string[];
	/** ISO creation timestamp. */
	createdAt: string;
}

/** Rows from the snapshot's stored propositions. Session names resolve
 *  chat titles first, then imported-file paths, then the raw id. */
export function buildRows(
	nodes: readonly GraphNode[],
	nodeSessions: Record<string, string[]>,
	sessions: Record<string, string>,
	fileSources: Record<string, string>,
): GraphTableRow[] {
	return nodes.map((node) => {
		const ids = nodeSessions[node.id] ?? [...new Set(node.provenance.map((p) => p.chatId))];
		return {
			id: node.id,
			name: node.name,
			statement: node.statement,
			sessions: ids.map((id) => sessions[id] ?? fileSources[id] ?? id),
			createdAt: node.createdAt,
		};
	});
}

/** Case-insensitive match on name, statement or session; empty query = all. */
export function filterRows(rows: readonly GraphTableRow[], query: string): GraphTableRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...rows];
	return rows.filter(
		(r) =>
			r.name.toLowerCase().includes(q) ||
			r.statement.toLowerCase().includes(q) ||
			r.sessions.some((s) => s.toLowerCase().includes(q)),
	);
}

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
	const next = new Set(selected);
	if (!next.delete(id)) next.add(id);
	return next;
}

/** Select-all over the visible rows: all visible selected → deselect them,
 *  otherwise add every visible id. Hidden selections are left untouched. */
export function toggleAllVisible(selected: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
	const next = new Set(selected);
	if (visibleIds.length > 0 && visibleIds.every((id) => next.has(id))) {
		for (const id of visibleIds) next.delete(id);
	} else {
		for (const id of visibleIds) next.add(id);
	}
	return next;
}

export function GraphTable({
	nodes,
	nodeSessions,
	sessions,
	fileSources,
	onDeleted,
}: {
	nodes: readonly GraphNode[];
	nodeSessions: Record<string, string[]>;
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	/** Fires after a confirmed delete with the ids that actually died. */
	onDeleted: (nodeIds: string[], graphRevision: number) => void;
}) {
	const copy = useI18n().graphUi;
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [deleting, setDeleting] = useState<{ id: string; name: string }[] | null>(null);
	const rows = useMemo(
		() => buildRows(nodes, nodeSessions, sessions, fileSources),
		[nodes, nodeSessions, sessions, fileSources],
	);
	const visible = useMemo(() => filterRows(rows, query), [rows, query]);
	const visibleIds = visible.map((r) => r.id);
	const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
	const selectedRows = rows.filter((r) => selected.has(r.id));

	return (
		<div data-testid="graph-table" className="flex h-full min-h-0 flex-col gap-3 px-4 pb-4 pt-16">
			<div className="flex items-center gap-3">
				<div className="relative w-64 max-w-full">
					<SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={copy.searchPlaceholder}
						aria-label={copy.searchNodes}
						data-testid="graph-table-search"
						spellCheck={false}
						className="h-8 w-full rounded-lg border bg-background pl-8 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
					/>
				</div>
				{selectedRows.length > 0 && (
					<button
						type="button"
						data-testid="graph-table-bulk-delete"
						onClick={() => setDeleting(selectedRows.map((r) => ({ id: r.id, name: r.name })))}
						className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20"
					>
						{formatMessage(copy.deleteSelected, { count: selectedRows.length, nodes: selectedRows.length === 1 ? copy.node : copy.nodes })}
					</button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-card/60">
				<table className="w-full border-collapse text-left text-xs">
					<thead className="sticky top-0 bg-card text-muted-foreground">
						<tr>
							<th className="w-8 px-3 py-2">
								<input
									type="checkbox"
									aria-label={copy.selectAllNodes}
									data-testid="graph-table-select-all"
									checked={allVisibleSelected}
									onChange={() => setSelected(toggleAllVisible(selected, visibleIds))}
									className="accent-primary"
								/>
							</th>
							<th className="px-3 py-2 font-medium">{copy.name}</th>
							<th className="px-3 py-2 font-medium">{copy.statement}</th>
							<th className="px-3 py-2 font-medium">{copy.sessions}</th>
							<th className="px-3 py-2 font-medium">{copy.created}</th>
							<th className="w-10 px-3 py-2" />
						</tr>
					</thead>
					<tbody>
						{visible.map((row) => (
							<tr key={row.id} data-testid="graph-table-row" data-node-id={row.id} className="border-t align-top">
								<td className="px-3 py-2">
									<input
										type="checkbox"
										aria-label={formatMessage(copy.selectNode, { name: row.name })}
										data-testid="graph-table-select"
										checked={selected.has(row.id)}
										onChange={() => setSelected(toggleSelected(selected, row.id))}
										className="accent-primary"
									/>
								</td>
								<td className="px-3 py-2 font-medium text-foreground">{row.name}</td>
								<td className="px-3 py-2 text-muted-foreground">{row.statement}</td>
								<td className="px-3 py-2 text-muted-foreground">{row.sessions.join(", ")}</td>
								<td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{row.createdAt.slice(0, 10)}</td>
								<td className="px-3 py-2">
									<button
										type="button"
										aria-label={formatMessage(copy.deleteNodeRow, { name: row.name })}
										data-testid="graph-table-delete"
										onClick={() => setDeleting([{ id: row.id, name: row.name }])}
										className="text-muted-foreground transition-colors hover:text-destructive"
									>
										<Trash2Icon className="size-3.5" />
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{visible.length === 0 && (
					<div className="px-3 py-4 text-xs text-muted-foreground">{copy.noMatchingNodes}</div>
				)}
			</div>
			<DeleteNodeDialog
				nodes={deleting}
				onClose={() => setDeleting(null)}
				onDeleted={(ids, revision) => {
					setDeleting(null);
					setSelected((cur) => {
						const next = new Set(cur);
						for (const id of ids) next.delete(id);
						return next;
					});
					onDeleted(ids, revision);
				}}
			/>
		</div>
	);
}
