import type { ExtractedBlock } from "../contracts.ts";

export function extractText(fileName: string, data: Uint8Array, format: "md" | "txt"): ExtractedBlock[] {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/\r\n?/g, "\n");
	} catch {
		throw new Error("The document must contain valid UTF-8 text.");
	}
	const lines = text.split("\n");
	const blocks: ExtractedBlock[] = [];
	let start = 0;
	let heading: string | undefined;
	let headingLine: number | undefined;
	// Heading path, outermost first. Only md has headings.
	let path: string[] = [];
	// True while the current segment is a run of markdown pipe-table lines.
	let inTable = false;
	// Emits the segment [start, end]; the current heading/path describe that segment.
	function append(end: number) {
		const section = path.length ? { section: [...path] } : {};
		if (inTable) {
			blocks.push({
				text: lines.slice(start, end + 1).join("\n"),
				citation: { format, fileName, ...(heading === undefined ? {} : { heading }), lineStart: start + 1, lineEnd: end + 1 },
				...section,
				kind: "table",
			});
			return;
		}
		let first = start;
		let last = end;
		while (first <= last && !lines[first]!.trim()) first++;
		while (last >= first && !lines[last]!.trim()) last--;
		if (first > last) return;
		blocks.push({
			text: lines.slice(first, last + 1).join("\n"),
			citation: { format, fileName, ...(heading === undefined ? {} : { heading }), lineStart: (headingLine ?? first) + 1, lineEnd: last + 1 },
			...section,
		});
	}
	let fence: { marker: string; length: number } | undefined;
	if (format === "md") {
		for (let index = 0; index < lines.length; index++) {
			const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]!);
			if (fence) {
				if (fenceMatch && fenceMatch[1]![0] === fence.marker && fenceMatch[1]!.length >= fence.length && !fenceMatch[2]!.trim()) fence = undefined;
				continue;
			}
			if (fenceMatch && (fenceMatch[1]![0] === "~" || !fenceMatch[2]!.includes("`"))) {
				fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
				continue;
			}
			const isTableLine = /^ {0,3}\|/.test(lines[index]!);
			if (isTableLine !== inTable) {
				append(index - 1);
				inTable = isTableLine;
				start = index;
				headingLine = undefined;
			}
			const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(lines[index]!);
			if (!match) continue;
			append(index - 1);
			const level = match[1]!.length;
			heading = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim() || undefined;
			path = [...path.slice(0, level - 1), ...(heading === undefined ? [] : [heading])];
			lines[index] = heading ?? "";
			headingLine = index;
			start = index;
		}
	}
	append(lines.length - 1);
	return blocks;
}
