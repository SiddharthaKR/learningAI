import { XMLParser } from "fast-xml-parser";
import { KnowledgeArchiveError } from "./archive.ts";

export function parseOfficeXml(xml: Uint8Array): unknown {
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(xml);
		if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) {
			throw new KnowledgeArchiveError("XML_UNSAFE_DECLARATION", "Office XML must not contain DOCTYPE or ENTITY declarations.");
		}
		return new XMLParser({
			processEntities: false,
			ignoreAttributes: false,
			parseTagValue: false,
			parseAttributeValue: false,
			trimValues: false,
		}).parse(text, true);
	} catch (error) {
		if (error instanceof KnowledgeArchiveError) throw error;
		throw new KnowledgeArchiveError("XML_INVALID", "The Office XML document is malformed or is not valid UTF-8.");
	}
}
