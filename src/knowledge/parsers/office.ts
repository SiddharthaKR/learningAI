import { parseOfficeXml } from "../xml.ts";

export interface OfficeElement {
	name: string;
	attributes: Record<string, string>;
	children: OfficeElement[];
	text: Array<{ value: string; cdata: boolean }>;
}

// The secure parser's ordered representation retains interleaved runs/fields.
export function officeElements(data: Uint8Array): OfficeElement[] {
	function textParts(value: unknown): OfficeElement["text"] {
		if (!Array.isArray(value)) return [];
		return value.flatMap((part: Record<string, unknown>): OfficeElement["text"] => {
			if (typeof part["#text"] === "string") return [{ value: part["#text"], cdata: false }];
			if (!Array.isArray(part["#cdata"])) return [];
			return part["#cdata"].flatMap((literal: Record<string, unknown>) => typeof literal["#text"] === "string" ? [{ value: literal["#text"], cdata: true }] : []);
		});
	}
	function elements(value: unknown): OfficeElement[] {
		if (!Array.isArray(value)) return [];
		return value.flatMap((entry: Record<string, unknown>) => Object.entries(entry)
			.filter(([name]) => name !== ":@" && name !== "#text" && name !== "#cdata" && !name.startsWith("?"))
			.map(([name, content]) => ({
				name,
				attributes: Object.fromEntries(Object.entries((entry[":@"] ?? {}) as Record<string, string>).map(([attribute, value]) => [attribute, characterReferences(value)])),
				children: elements(content),
				text: textParts(content),
			})));
	}
	return elements(parseOfficeXml(data, { preserveOrder: true }));
}

export function descendants(elements: OfficeElement[], name: string): OfficeElement[] {
	return elements.flatMap((element) => element.name === name ? [element] : descendants(element.children, name));
}

// processEntities stays disabled in the XML parser. Decode only standard XML
// character references at the text boundary; declarations are never expanded.
export function characterReferences(text: string): string {
	const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
	return text.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (reference, name: string) => {
		if (!name.startsWith("#")) return predefined[name]!;
		const point = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
		return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : reference;
	});
}

export function paragraphText(element: OfficeElement, textTag: string): string {
	return descendants(element.children, textTag).flatMap((text) => text.text.map((part) => part.cdata ? part.value : characterReferences(part.value))).join("");
}
