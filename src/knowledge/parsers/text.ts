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
	function append(start: number, end: number, heading?: string, headingLine?: number) {
		while (start <= end && !lines[start]!.trim()) start++;
		while (end >= start && !lines[end]!.trim()) end--;
		if (start > end) return;
		blocks.push({
			text: lines.slice(start, end + 1).join("\n"),
			citation: { format, fileName, ...(heading === undefined ? {} : { heading }), lineStart: (headingLine ?? start) + 1, lineEnd: end + 1 },
		});
	}
	let start = 0;
	let heading: string | undefined;
	let headingLine: number | undefined;
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
			const match = /^ {0,3}#{1,6}(?:[ \t]+(.*?)|[ \t]*)$/.exec(lines[index]!);
			if (!match) continue;
			append(start, index - 1, heading, headingLine);
			heading = (match[1] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim() || undefined;
			lines[index] = heading ?? "";
			headingLine = index;
			start = index;
		}
	}
	append(start, lines.length - 1, heading, headingLine);
	return blocks;
}
