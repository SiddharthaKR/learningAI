import { zipSync } from "fflate";

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export function officeZip(entries: Record<string, string | Uint8Array>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, typeof value === "string" ? utf8(value) : value])));
}

// Keep real compressed payloads/CRCs, but understate both local and central
// original sizes to exercise the actual-output budget independently of preflight.
export function understateZipEntrySizes(data: Uint8Array): Uint8Array {
	const bytes = data.slice();
	const view = new DataView(bytes.buffer);
	const end = bytes.length - 22;
	let cursor = view.getUint32(end + 16, true);
	for (let index = 0; index < view.getUint16(end + 10, true); index++) {
		const local = view.getUint32(cursor + 42, true);
		view.setUint32(local + 22, 1, true);
		view.setUint32(cursor + 24, 1, true);
		cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
	}
	return bytes;
}

export function slideXml(texts: string[]): string {
	return `<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree>${texts.map((text) => `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`).join("")}</p:spTree></p:cSld></p:sld>`;
}

export function notesXml(text: string): string {
	return `<p:notes xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
}

export const notesRelationship = (target: string): string => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="${target}"/></Relationships>`;

export function paragraphXml(text: string, style?: string): string {
	return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

export const documentXml = (paragraphs: string[]): string => `<w:document xmlns:w="urn:w"><w:body>${paragraphs.join("")}<w:sectPr/></w:body></w:document>`;

// Real PDF bytes, with a ToUnicode map for Japanese rather than a mocked PDF engine.
// A null page contains a painted rectangle only: no text layer and no OCR fallback.
export function pdfFixture(pages: Array<string | null>): Uint8Array {
	const chars = [...new Set(pages.flatMap((page) => [...(page ?? "")]))];
	const hex = (value: number) => value.toString(16).padStart(4, "0");
	const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Fixture def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${chars.length} beginbfchar\n${chars.map((char, index) => `<${hex(index + 1)}> <${hex(char.charCodeAt(0))}>`).join("\n")}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
	const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${pages.map((_, index) => `${7 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
		"<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>",
		"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 500 >>",
		"<< /Type /FontDescriptor /FontName /Fixture /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
		stream(cmap),
	];
	for (const [index, page] of pages.entries()) {
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${8 + index * 2} 0 R >>`);
		objects.push(stream(page === null ? "0.5 g 20 20 200 200 re f" : `BT /F1 18 Tf 40 700 Td <${[...page].map((char) => hex(chars.indexOf(char) + 1)).join("")}> Tj ET`));
	}
	let pdf = "%PDF-1.7\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return utf8(pdf);
}
