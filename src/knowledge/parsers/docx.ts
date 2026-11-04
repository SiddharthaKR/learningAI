import { extractSelectedZipEntries, KnowledgeArchiveError } from "../archive.ts";
import type { ExtractedBlock } from "../contracts.ts";
import { descendants, officeElements, paragraphText } from "./office.ts";

export function extractDocx(fileName: string, data: Uint8Array): ExtractedBlock[] {
	const entries = extractSelectedZipEntries(data, (name) => name === "word/document.xml" || name === "word/styles.xml");
	const document = entries.get("word/document.xml");
	if (!document) throw new KnowledgeArchiveError("XML_INVALID", "The DOCX archive is missing word/document.xml.");
	const body = descendants(officeElements(document), "w:body")[0];
	if (!body) throw new KnowledgeArchiveError("XML_INVALID", "The DOCX document has no body.");
	const headingStyles = new Set<string>();
	const styles = entries.get("word/styles.xml");
	if (styles) {
		for (const style of descendants(officeElements(styles), "w:style")) {
			const name = descendants(style.children, "w:name")[0]?.attributes["@_w:val"] ?? "";
			if (/^heading [1-9]$/i.test(name) && style.attributes["@_w:styleId"]) headingStyles.add(style.attributes["@_w:styleId"]);
		}
	}
	const blocks: ExtractedBlock[] = [];
	let heading: string | undefined;
	for (const [index, paragraph] of descendants(body.children, "w:p").entries()) {
		const text = paragraphText(paragraph, "w:t");
		if (!text.trim()) continue;
		const styleId = descendants(paragraph.children, "w:pStyle")[0]?.attributes["@_w:val"] ?? "";
		if (/^Heading[1-9]$/i.test(styleId) || headingStyles.has(styleId)) heading = text;
		blocks.push({ text, citation: { format: "docx", fileName, ...(heading === undefined ? {} : { heading }), paragraph: index + 1 } });
	}
	return blocks;
}
