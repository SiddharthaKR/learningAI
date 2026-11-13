/**
 * Mermaid label healing (owner, 2026-11-13): models often write flowchart
 * node labels with characters that are syntax in Mermaid — e.g.
 * `A[Path 1: Terminal/SSH (Active Change)]`, where the "(" opens a shape and
 * the parse fails. Quoting the label (`A["Path 1: …"]`) is the fix Mermaid
 * itself recommends. Used only as a retry after a failed render, so a chart
 * that already parses is never touched. Pure; flowcharts only.
 */

const RISKY = /[()[\]{}:;/\\|<>#&]/;
const OPENERS: Record<string, string> = { "[": "]", "(": ")", "{": "}" };

/** Is this a flowchart/graph diagram (the only kind whose labels we heal)? */
function isFlowchart(chart: string): boolean {
	const first = chart.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("%%"));
	return !!first && /^\s*(flowchart|graph)\b/i.test(first);
}

/** Index of the bracket closing `open` at `start` (nesting-aware), or -1. */
function matchClose(line: string, start: number, open: string, close: string): number {
	let depth = 0;
	for (let i = start; i < line.length; i++) {
		const c = line[i];
		if (c === open) depth++;
		else if (c === close && --depth === 0) return i;
	}
	return -1;
}

function healLine(line: string): string {
	let out = "";
	let i = 0;
	// A node id immediately followed by a label opener: id[...], id(...), id{...}
	const nodeStart = /[A-Za-z0-9_][A-Za-z0-9_-]*\s*([[({])/g;
	for (let m = nodeStart.exec(line); m; m = nodeStart.exec(line)) {
		const openIndex = m.index + m[0].length - 1;
		if (openIndex < i) continue;
		const open = m[1]!;
		const close = OPENERS[open]!;
		const end = matchClose(line, openIndex, open, close);
		if (end === -1) break;
		const inner = line.slice(openIndex + 1, end);
		// Shape syntax ([[..]], ((..)), {{..}}, [(..)], [/..], [\..]) or an
		// already-quoted label: leave it exactly as written.
		const shaped = /^[[({/\\]/.test(inner) || /^\s*"/.test(inner);
		if (!shaped && RISKY.test(inner)) {
			out += line.slice(i, openIndex + 1) + `"${inner.replace(/"/g, "#quot;")}"` + close;
			i = end + 1;
			nodeStart.lastIndex = end + 1;
		}
	}
	return out + line.slice(i);
}

/** Quote risky flowchart node labels; returns the chart unchanged otherwise. */
export function quoteMermaidLabels(chart: string): string {
	if (!isFlowchart(chart)) return chart;
	return chart
		.split(/(\r?\n)/)
		.map((part) => (part === "\n" || part === "\r\n" ? part : healLine(part)))
		.join("");
}
