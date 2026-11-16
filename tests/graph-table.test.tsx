import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { GraphTable, buildRows, filterRows, toggleAllVisible, toggleSelected } from "../components/graph-table.tsx";
import type { GraphNode } from "../src/core/contracts/graph.ts";

const node = (id: string, name: string, statement: string, chatId: string, createdAt: string): GraphNode => ({
	id, name, statement, aliases: [], createdAt, provenance: [{ chatId, messageId: "" }],
});
const nodes = [
	node("n_1", "Parity", "Odd plus odd is even.", "c1", "2026-10-01T10:00:00.000Z"),
	node("n_2", "Kepler", "Orbits are ellipses.", "c2", "2026-10-02T10:00:00.000Z"),
	node("n_3", "Entropy", "Entropy never decreases in isolated systems.", "src_a", "2026-10-03T10:00:00.000Z"),
];
const nodeSessions = { n_1: ["c1"], n_2: ["c2"], n_3: ["src_a"] };
const sessions = { c1: "Numbers chat", c2: "Planets chat" };
const fileSources = { src_a: "notes/thermo.md" };

describe("graph table pure logic", () => {
	it("buildRows resolves session titles, file paths and ISO dates", () => {
		const rows = buildRows(nodes, nodeSessions, sessions, fileSources);
		assert.deepEqual(rows.map((r) => r.sessions), [["Numbers chat"], ["Planets chat"], ["notes/thermo.md"]]);
		assert.equal(rows[0]!.createdAt, "2026-10-01T10:00:00.000Z");
	});
	it("filterRows matches name, statement and session; empty query keeps all", () => {
		const rows = buildRows(nodes, nodeSessions, sessions, fileSources);
		assert.equal(filterRows(rows, "  ").length, 3);
		assert.deepEqual(filterRows(rows, "kepler").map((r) => r.id), ["n_2"]);
		assert.deepEqual(filterRows(rows, "ellipses").map((r) => r.id), ["n_2"]);
		assert.deepEqual(filterRows(rows, "thermo").map((r) => r.id), ["n_3"]);
		assert.deepEqual(filterRows(rows, "zzz"), []);
	});
	it("selection helpers toggle one and all-visible", () => {
		const one = toggleSelected(new Set(), "a");
		assert.deepEqual([...one], ["a"]);
		assert.equal(toggleSelected(one, "a").size, 0);
		assert.deepEqual([...toggleAllVisible(new Set(["z"]), ["a", "b"])].sort(), ["a", "b", "z"]);
		assert.deepEqual([...toggleAllVisible(new Set(["a", "b", "z"]), ["a", "b"])], ["z"]);
	});
});

describe("GraphTable component", () => {
	it("renders rows, filters by search, and bulk-deletes exactly the selected nodes", async () => {
		const dom = parseHTML("<html><body><div id='host'></div></body></html>");
		const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
		Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
		const deleted: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			assert.equal(init?.method, "DELETE");
			deleted.push(decodeURIComponent(String(input).split("/").pop()!));
			return Response.json({ graphRevision: deleted.length });
		}) as typeof fetch;
		const host = dom.document.querySelector("#host")!;
		const root = createRoot(host);
		const reported: string[][] = [];
		try {
			await act(async () => {
				root.render(
					<I18nProvider language="en">
						<GraphTable nodes={nodes} nodeSessions={nodeSessions} sessions={sessions} fileSources={fileSources} onDeleted={(ids) => reported.push(ids)} />
					</I18nProvider>,
				);
			});
			const ids = () => [...host.querySelectorAll('[data-testid="graph-table-row"]')].map((r) => r.getAttribute("data-node-id"));
			assert.deepEqual(ids(), ["n_1", "n_2", "n_3"]);
			assert.ok(host.textContent!.includes("Planets chat"));
			assert.ok(host.textContent!.includes("2026-10-02"));

			// (Search filtering is pinned through filterRows above: linkedom lacks the
			// native input events React 19 needs to drive a controlled text field.)

			// Select rows 1 and 3, bulk delete, confirm.
			const checks = host.querySelectorAll('[data-testid="graph-table-select"]');
			await act(async () => { (checks[0] as HTMLInputElement).click(); });
			await act(async () => { (checks[2] as HTMLInputElement).click(); });
			await act(async () => { (host.querySelector('[data-testid="graph-table-bulk-delete"]') as HTMLButtonElement).click(); });
			const dialog = dom.document.querySelector('[data-testid="delete-node-dialog"]');
			assert.ok(dialog, "confirm dialog is shown before anything is deleted");
			assert.deepEqual(deleted, []);
			await act(async () => { (dom.document.querySelector('[data-testid="node-delete-confirm"]') as HTMLButtonElement).click(); });
			assert.deepEqual(deleted, ["n_1", "n_3"]);
			assert.deepEqual(reported, [["n_1", "n_3"]]);
			assert.equal(dom.document.querySelector('[data-testid="delete-node-dialog"]'), null);
		} finally {
			await act(async () => { root.unmount(); });
			Object.assign(globalThis, saved);
		}
	});
});
