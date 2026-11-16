import { extractSelectedZipEntries, KnowledgeArchiveError } from "../archive.ts";
import type { ExtractedBlock } from "../contracts.ts";
import { descendants, officeElements, paragraphText, tableRows, type OfficeElement } from "./office.ts";

/** Where a picture sits in the body: its paragraph (same numbering as the text) and the heading above it. */
export interface DocxPlacement { paragraph: number; heading?: string; section: string[] }

export function extractDocx(fileName: string, data: Uint8Array): ExtractedBlock[] {
	return parseDocx(fileName, data).blocks;
}

/** Picture relationship id (r:embed / r:id) → its first placement in the body. Headers, footers and unused media are absent. */
export function docxImagePlacements(data: Uint8Array): Map<string, DocxPlacement> {
	return parseDocx("placements.docx", data).placements;
}

function parseDocx(fileName: string, data: Uint8Array): { blocks: ExtractedBlock[]; placements: Map<string, DocxPlacement> } {
	const entries = extractSelectedZipEntries(data, (name) => name === "word/document.xml" || name === "word/styles.xml");
	const document = entries.get("word/document.xml");
	if (!document) throw new KnowledgeArchiveError("XML_INVALID", "The DOCX archive is missing word/document.xml.");
	const body = descendants(officeElements(document), "w:body")[0];
	if (!body) throw new KnowledgeArchiveError("XML_INVALID", "The DOCX document has no body.");
	const headingLevels = new Map<string, number>();
	const styles = entries.get("word/styles.xml");
	if (styles) {
		for (const style of descendants(officeElements(styles), "w:style")) {
			const name = descendants(style.children, "w:name")[0]?.attributes["@_w:val"] ?? "";
			const level = /^heading ([1-9])$/i.exec(name)?.[1];
			if (level && style.attributes["@_w:styleId"]) headingLevels.set(style.attributes["@_w:styleId"], Number(level));
		}
	}
	const blocks: ExtractedBlock[] = [];
	const placements = new Map<string, DocxPlacement>();
	function place(paragraph: OfficeElement, index: number) {
		const ids = [
			...descendants(paragraph.children, "a:blip").map((blip) => blip.attributes["@_r:embed"]),
			...descendants(paragraph.children, "v:imagedata").map((legacy) => legacy.attributes["@_r:id"]),
		];
		for (const id of ids) {
			if (!id || placements.has(id)) continue;
			const heading = citationHeading();
			placements.set(id, { paragraph: index, ...(heading === undefined ? {} : { heading }), section: [...path] });
		}
	}
	// Heading path, outermost first. Headings are never body text; they only feed `section`.
	const path: string[] = [];
	let pending: { lines: string[]; paragraph: number; heading?: string; section: string[] } | undefined;
	let paragraphCount = 0;
	function flush() {
		if (!pending) return;
		blocks.push({
			text: pending.lines.join("\n"),
			citation: { format: "docx", fileName, ...(pending.heading === undefined ? {} : { heading: pending.heading }), paragraph: pending.paragraph },
			...(pending.section.length ? { section: pending.section } : {}),
		});
		pending = undefined;
	}
	function citationHeading(): string | undefined {
		return path[path.length - 1];
	}
	function walk(elements: OfficeElement[]) {
		for (const element of elements) {
			if (element.name === "w:p") {
				const index = ++paragraphCount;
				place(element, index);
				const text = paragraphText(element, "w:t");
				if (!text.trim()) continue;
				const styleId = descendants(element.children, "w:pStyle")[0]?.attributes["@_w:val"] ?? "";
				const level = headingLevels.get(styleId) ?? (/^Heading([1-9])$/i.test(styleId) ? Number(styleId.slice(-1)) : undefined);
				if (level !== undefined) {
					flush();
					path.splice(level - 1);
					path.push(text);
					continue;
				}
				pending ??= { lines: [], paragraph: index, heading: citationHeading(), section: [...path] };
				pending.lines.push(text);
			} else if (element.name === "w:tbl") {
				flush();
				const firstParagraph = paragraphCount + 1;
				const tableParagraphs = descendants(element.children, "w:p");
				tableParagraphs.forEach((paragraph, offset) => place(paragraph, firstParagraph + offset));
				paragraphCount += tableParagraphs.length;
				const rows = tableRows(element, { row: "w:tr", cell: "w:tc", paragraph: "w:p", text: "w:t" });
				if (!rows.length) continue;
				const heading = citationHeading();
				blocks.push({
					text: rows.join("\n"),
					citation: { format: "docx", fileName, ...(heading === undefined ? {} : { heading }), paragraph: firstParagraph },
					...(path.length ? { section: [...path] } : {}),
					kind: "table",
				});
			} else {
				// Containers such as w:sdt can wrap body paragraphs; keep document order.
				walk(element.children);
			}
		}
	}
	walk(body.children);
	flush();
	return { blocks, placements };
}
