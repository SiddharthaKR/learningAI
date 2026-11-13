import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { zlibSync } from "fflate";
import { itemsToText, outlineSections, pdfPageTexts } from "../src/agent/subagents/pdf-ops.ts";
import { extractPdf } from "../src/knowledge/parsers/pdf.ts";

const enc = (s: string) => new TextEncoder().encode(s);

/** Minimal real PDF: Helvetica text pages (content streams given verbatim),
 *  optional outline [{title, page(0-based), children?}], optional image-only pages. */
interface Outline { title: string; page: number; children?: Outline[] }
function buildPdf(opts: { contents: string[]; outline?: Outline[]; images?: Array<{ w: number; h: number; rgb: Uint8Array } | null> }): Uint8Array {
	const n = opts.contents.length;
	const objs: Array<Uint8Array | string> = [];
	const pageObj = (i: number) => 4 + i * 3; // page, content, image
	// 1 catalog, 2 pages, 3 font, then per page 3 objs, then outline objs
	const outlineBase = 4 + n * 3;
	const flat: Array<{ o: Outline; parent: number; id: number }> = [];
	let next = outlineBase + 1;
	const assign = (items: Outline[], parent: number) => { for (const o of items) { const id = next++; flat.push({ o, parent, id }); if (o.children) assign(o.children, id); } };
	if (opts.outline) assign(opts.outline, outlineBase);
	objs.push(`<< /Type /Catalog /Pages 2 0 R${opts.outline ? ` /Outlines ${outlineBase} 0 R` : ""} >>`);
	objs.push(`<< /Type /Pages /Kids [${opts.contents.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${n} >>`);
	objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	for (let i = 0; i < n; i++) {
		const img = opts.images?.[i];
		objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${img ? ` /XObject << /Im0 ${pageObj(i) + 2} 0 R >>` : ""} >> /Contents ${pageObj(i) + 1} 0 R >>`);
		const c = opts.contents[i]!;
		objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
		if (img) {
			const z = zlibSync(img.rgb);
			objs.push(Buffer.concat([enc(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, enc("\nendstream")]) as unknown as Uint8Array);
		} else objs.push("<< >>");
	}
	if (opts.outline) {
		const top = flat.filter((f) => f.parent === outlineBase);
		objs.push(`<< /Type /Outlines /First ${top[0]!.id} 0 R /Last ${top[top.length - 1]!.id} 0 R /Count ${flat.length} >>`);
		for (const f of flat) {
			const sibs = flat.filter((x) => x.parent === f.parent);
			const idx = sibs.indexOf(f);
			const kids = flat.filter((x) => x.parent === f.id);
			objs.push(`<< /Title (${f.o.title}) /Parent ${f.parent} 0 R${idx > 0 ? ` /Prev ${sibs[idx - 1]!.id} 0 R` : ""}${idx < sibs.length - 1 ? ` /Next ${sibs[idx + 1]!.id} 0 R` : ""}${kids.length ? ` /First ${kids[0]!.id} 0 R /Last ${kids[kids.length - 1]!.id} 0 R /Count ${kids.length}` : ""} /Dest [${pageObj(f.o.page)} 0 R /Fit] >>`);
		}
	}
	const parts: Uint8Array[] = [enc("%PDF-1.7\n")];
	const offsets: number[] = [];
	let len = parts[0]!.length;
	objs.forEach((o, i) => {
		const body = typeof o === "string" ? enc(o) : o;
		const chunk = Buffer.concat([enc(`${i + 1} 0 obj\n`), body, enc("\nendobj\n")]);
		offsets.push(len);
		len += chunk.length;
		parts.push(chunk);
	});
	const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
	parts.push(enc(xref));
	return new Uint8Array(Buffer.concat(parts));
}

const text = (s: string, x = 72, y = 700) => `BT /F1 12 Tf ${x} ${y} Td (${s}) Tj ET`;

describe("PDF text spacing", () => {
	it("keeps separate lines apart and spaces separate runs on a line", async () => {
		const pdf = buildPdf({ contents: [`BT /F1 12 Tf 72 700 Td (Alpha) Tj 0 -20 Td (Beta) Tj ET BT /F1 12 Tf 72 600 Td (Left) Tj 60 0 Td (Right) Tj ET`] });
		const [page] = await pdfPageTexts(pdf);
		assert.match(page!.text, /Alpha\s*\nBeta/);
		assert.match(page!.text, /Left Right/);
		assert.ok(!page!.text.includes("AlphaBeta"));
		assert.ok(!page!.text.includes("LeftRight"));
	});

	it("never inserts spaces around CJK runs and never doubles whitespace", () => {
		const item = (str: string, x: number, hasEOL = false) => ({ str, hasEOL, width: 20, height: 10, transform: [10, 0, 0, 10, x, 100] });
		assert.equal(itemsToText([item("日本", 0), item("語", 40)]), "日本語");
		assert.equal(itemsToText([item("a", 0), item("b", 40)]), "a b");
		assert.equal(itemsToText([item("a ", 0), item("b", 40)]), "a b");
		assert.equal(itemsToText([item("a", 0, true), item("b", 0)]), "a\nb");
		assert.equal(itemsToText([item("a", 0), item("b", 20)]), "ab");
	});
});

describe("PDF outline sections", () => {
	it("maps outline entries to per-page section paths", async () => {
		const pdf = buildPdf({
			contents: [text("p1 text"), text("p2 text"), text("p3 text"), text("p4 text")],
			outline: [{ title: " Intro ", page: 0 }, { title: "Body", page: 1, children: [{ title: "Detail", page: 2 }] }, { title: "End", page: 3 }],
		});
		const doc = await extractPdf("outline.pdf", pdf);
		assert.deepEqual(doc.blocks.map((b) => b.section), [["Intro"], ["Body"], ["Body", "Detail"], ["End"]]);
	});

	it("leaves section unset without an outline", async () => {
		const doc = await extractPdf("plain.pdf", buildPdf({ contents: [text("hello")] }));
		assert.equal(doc.blocks[0]!.section, undefined);
	});

	it("outlineSections handles a preamble before the first entry", () => {
		assert.deepEqual(outlineSections([{ title: "A", depth: 0, pageIndex: 1 }], 3), [undefined, ["A"], ["A"]]);
	});
});

describe("PDF OCR fallback", () => {
	it("reads text out of an image-only PDF (eng+jpn, offline)", { timeout: 180_000 }, async () => {
		const w = 800, h = 300;
		const canvas = createCanvas(w, h);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = "#000"; ctx.font = "72px sans-serif"; ctx.fillText("Hello Scanned", 40, 150);
		const rgba = ctx.getImageData(0, 0, w, h).data;
		const rgb = new Uint8Array(w * h * 3);
		for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]!; rgb[i * 3 + 1] = rgba[i * 4 + 1]!; rgb[i * 3 + 2] = rgba[i * 4 + 2]!; }
		const pdf = buildPdf({
			contents: ["q 600 0 0 225 6 400 cm /Im0 Do Q"],
			images: [{ w, h, rgb }],
			outline: [{ title: "Scans", page: 0 }],
		});
		const doc = await extractPdf("scan.pdf", pdf);
		assert.equal(doc.status, "ready");
		assert.equal(doc.blocks.length, 1);
		assert.match(doc.blocks[0]!.text, /Hello/i);
		assert.deepEqual(doc.blocks[0]!.citation, { format: "pdf", fileName: "scan.pdf", page: 1, ocr: true });
		assert.deepEqual(doc.blocks[0]!.section, ["Scans"]);
	});
});
