import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractDocument } from "../src/knowledge/extract.ts";
import { documentXml, notesRelationship, notesXml, officeZip, paragraphXml, pdfFixture, slideXml, understateZipEntrySizes, utf8 } from "./fixtures/knowledge/builders.ts";

describe("knowledge document extraction", () => {
	for (const [language, title, body, note] of [
		["English", "Safety", "Read the handbook.", "Check the exit."],
		["Japanese", "安全", "手引きを読んでください。", "出口を確認してください。"],
	]) {
		it(`extracts ${language} PDF pages with stable 1-based citations`, async () => {
			assert.deepEqual(await extractDocument({ fileName: "guide.PDF", data: pdfFixture([title!, null, body!]) }), {
				fileName: "guide.PDF", format: "pdf", status: "ready", blocks: [
					{ text: title, citation: { format: "pdf", fileName: "guide.PDF", page: 1 } },
					{ text: body, citation: { format: "pdf", fileName: "guide.PDF", page: 3 } },
				],
			});
		});

		it(`extracts ${language} PPTX slides and related notes in document order`, async () => {
			const data = officeZip({
				"ppt/slides/slide10.xml": slideXml(["Last"]),
				"ppt/slides/slide2.xml": slideXml(["", title!, body!]),
				"ppt/slides/_rels/slide2.xml.rels": notesRelationship("../notesSlides/notesSlide7.xml"),
				"ppt/notesSlides/notesSlide7.xml": notesXml(note!),
				"ppt/notesSlides/notesSlide2.xml": notesXml("Unrelated notes"),
				"ppt/media/bad.xml": "<!DOCTYPE forbidden><bad>",
				"ppt/embeddings/bad.xml": "not XML",
			});
			assert.deepEqual(await extractDocument({ fileName: "slides.pptx", data }), {
				fileName: "slides.pptx", format: "pptx", status: "ready", blocks: [
					{ text: `${title}\n${body}\n\n${note}`, citation: { format: "pptx", fileName: "slides.pptx", slide: 2, title }, section: [title] },
					{ text: "Last", citation: { format: "pptx", fileName: "slides.pptx", slide: 10, title: "Last" }, section: ["Last"] },
				],
			});
		});

		it(`extracts ${language} DOCX paragraphs with nearest headings and empty-paragraph indexes`, async () => {
			const data = officeZip({
				"word/document.xml": documentXml([paragraphXml(body!), paragraphXml(""), paragraphXml(title!, "Custom"), paragraphXml(body!), paragraphXml(note!, "Heading2"), paragraphXml(body!)]),
				"word/styles.xml": '<w:styles xmlns:w="urn:w"><w:style w:type="paragraph" w:styleId="Custom"><w:name w:val="HeAdInG 1"/></w:style></w:styles>',
				"word/media/ignored.xml": "<!DOCTYPE forbidden><bad>",
			});
			assert.deepEqual(await extractDocument({ fileName: "guide.docx", data }), {
				fileName: "guide.docx", format: "docx", status: "ready", blocks: [
					{ text: body, citation: { format: "docx", fileName: "guide.docx", paragraph: 1 } },
					{ text: body, citation: { format: "docx", fileName: "guide.docx", heading: title, paragraph: 4 }, section: [title] },
					{ text: body, citation: { format: "docx", fileName: "guide.docx", heading: note, paragraph: 6 }, section: [title, note] },
				],
			});
		});

		it(`extracts ${language} MD sections with headings and exact inclusive line ranges`, async () => {
			assert.deepEqual(await extractDocument({ fileName: "guide.md", data: utf8(`\uFEFF${body}\r\n# ${title}\r\n${body}\r\n\r\n## ${note}\r${body}`) }), {
				fileName: "guide.md", format: "md", status: "ready", blocks: [
					{ text: body, citation: { format: "md", fileName: "guide.md", lineStart: 1, lineEnd: 1 } },
					{ text: `${title}\n${body}`, citation: { format: "md", fileName: "guide.md", heading: title, lineStart: 2, lineEnd: 3 }, section: [title] },
					{ text: `${note}\n${body}`, citation: { format: "md", fileName: "guide.md", heading: note, lineStart: 5, lineEnd: 6 }, section: [title, note] },
				],
			});
		});

		it(`extracts ${language} TXT as one block, normalizing newlines and stripping BOM`, async () => {
			assert.deepEqual(await extractDocument({ fileName: "guide.txt", data: utf8(`\uFEFF${title}\r\n${body}\r`) }), {
				fileName: "guide.txt", format: "txt", status: "ready", blocks: [
					{ text: `${title}\n${body}`, citation: { format: "txt", fileName: "guide.txt", lineStart: 1, lineEnd: 2 } },
				],
			});
		});
	}

	it("reports a PDF without a text layer and does not produce blocks", async () => {
		assert.deepEqual(await extractDocument({ fileName: "scan.pdf", data: pdfFixture([null, null]) }), { fileName: "scan.pdf", format: "pdf", status: "no_text_layer", blocks: [] });
	});

	for (const format of ["md", "txt"]) {
		it(`rejects invalid UTF-8 ${format} instead of replacing undecodable bytes`, async () => {
			await assert.rejects(() => extractDocument({ fileName: `bad.${format}`, data: new Uint8Array([0xc3, 0x28]) }), /UTF-8/);
		});
		it(`produces no block for whitespace-only ${format}`, async () => {
			assert.deepEqual((await extractDocument({ fileName: `empty.${format}`, data: utf8(" \r\n\t") })).blocks, []);
		});
	}

	for (const extension of ["xlsx", "xls", "csv", "exe", ""]) {
		it(`clearly rejects unsupported extension ${extension || "(missing)"}`, async () => {
			await assert.rejects(() => extractDocument({ fileName: extension ? `data.${extension}` : "data", data: utf8("text") }), /Unsupported.*PDF.*PPTX.*DOCX.*MD.*TXT/i);
		});
	}

	for (const format of ["pptx", "docx"]) {
		it(`rejects malformed ${format} ZIP input`, async () => {
			await assert.rejects(() => extractDocument({ fileName: `bad.${format}`, data: utf8("not a zip") }), { code: "ZIP_INVALID" });
		});
		it(`rejects malformed selected ${format} XML`, async () => {
			const name = format === "pptx" ? "ppt/slides/slide1.xml" : "word/document.xml";
			await assert.rejects(() => extractDocument({ fileName: `bad.${format}`, data: officeZip({ [name]: "<broken>" }) }), { code: "XML_INVALID" });
		});
		it(`rejects unsafe selected ${format} XML`, async () => {
			const name = format === "pptx" ? "ppt/slides/slide1.xml" : "word/document.xml";
			await assert.rejects(() => extractDocument({ fileName: `bad.${format}`, data: officeZip({ [name]: '<!DOCTYPE bad [<!ENTITY x "bad">]><bad/>' }) }), { code: "XML_UNSAFE_DECLARATION" });
		});
	}

	it("keeps interleaved PPTX run and field text in XML order", async () => {
		const xml = '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>First</a:t></a:r><a:fld><a:t>Second</a:t></a:fld><a:r><a:t>Third</a:t></a:r></a:p></p:sld>';
		assert.deepEqual((await extractDocument({ fileName: "order.pptx", data: officeZip({ "ppt/slides/slide1.xml": xml }) })).blocks, [
			{ text: "FirstSecondThird", citation: { format: "pptx", fileName: "order.pptx", slide: 1, title: "FirstSecondThird" }, section: ["FirstSecondThird"] },
		]);
	});

	it("concatenates interleaved DOCX runs and hyperlinks in paragraph order", async () => {
		const paragraph = '<w:p><w:r><w:t>First </w:t></w:r><w:hyperlink><w:r><w:t>second </w:t></w:r></w:hyperlink><w:r><w:t>third</w:t></w:r></w:p>';
		assert.deepEqual((await extractDocument({ fileName: "order.docx", data: officeZip({ "word/document.xml": documentXml([paragraph]) }) })).blocks, [
			{ text: "First second third", citation: { format: "docx", fileName: "order.docx", paragraph: 1 } },
		]);
	});

	it("decodes only XML character references in Office text", async () => {
		assert.deepEqual((await extractDocument({ fileName: "entities.docx", data: officeZip({ "word/document.xml": documentXml([paragraphXml("A &amp; B &lt; C &#x65E5;&#26412;")]) }) })).blocks, [
			{ text: "A & B < C 日本", citation: { format: "docx", fileName: "entities.docx", paragraph: 1 } },
		]);
	});

	it("decodes DOCX heading citations exactly once", async () => {
		assert.deepEqual((await extractDocument({ fileName: "heading.docx", data: officeZip({ "word/document.xml": documentXml([paragraphXml("Literal &amp;lt;", "Heading1"), paragraphXml("Body")]) }) })).blocks, [
			{ text: "Body", citation: { format: "docx", fileName: "heading.docx", heading: "Literal &lt;", paragraph: 2 }, section: ["Literal &lt;"] },
		]);
	});

	it("keeps external or unrelated PPTX notes out of extracted blocks", async () => {
		const data = officeZip({
			"ppt/slides/slide1.xml": slideXml(["Title"]),
			"ppt/slides/_rels/slide1.xml.rels": notesRelationship("https://example.test/notesSlide1.xml").replace('Target="', 'TargetMode="External" Target="'),
			"ppt/notesSlides/notesSlide1.xml": "<!DOCTYPE unsafe><bad>",
		});
		assert.deepEqual((await extractDocument({ fileName: "external.pptx", data })).blocks, [
			{ text: "Title", citation: { format: "pptx", fileName: "external.pptx", slide: 1, title: "Title" }, section: ["Title"] },
		]);
	});

	it("applies one cumulative actual-output budget to PPTX slides and notes", async () => {
		const size = 15 * 1024 * 1024;
		const padded = (xml: string) => utf8(xml + " ".repeat(size - Buffer.byteLength(xml)));
		const slide = padded(slideXml(["Title"]));
		const notes = padded(notesXml("Note"));
		const entries: Record<string, Uint8Array | string> = {};
		for (let index = 1; index <= 4; index++) entries[`ppt/slides/slide${index}.xml`] = slide;
		for (let index = 1; index <= 3; index++) {
			entries[`ppt/slides/_rels/slide${index}.xml.rels`] = notesRelationship(`../notesSlides/notesSlide${index}.xml`);
			entries[`ppt/notesSlides/notesSlide${index}.xml`] = notes;
		}
		const data = understateZipEntrySizes(officeZip(entries));
		await assert.rejects(() => extractDocument({ fileName: "cumulative.pptx", data }), { code: "ZIP_ACTUAL_TOTAL_LIMIT" });
	});

	it("decodes encoded PPTX relationship attributes once before resolving notes", async () => {
		const data = officeZip({
			"ppt/slides/slide1.xml": slideXml(["Title"]),
			"ppt/slides/_rels/slide1.xml.rels": notesRelationship("../notesSlides/notesSlide&#49;.xml"),
			"ppt/notesSlides/notesSlide1.xml": notesXml("Related note"),
		});
		assert.deepEqual((await extractDocument({ fileName: "encoded.pptx", data })).blocks, [
			{ text: "Title\n\nRelated note", citation: { format: "pptx", fileName: "encoded.pptx", slide: 1, title: "Title" }, section: ["Title"] },
		]);
	});

	it("decodes encoded DOCX style names and style IDs once before heading matching", async () => {
		const data = officeZip({
			"word/document.xml": documentXml([paragraphXml("Heading", "Custom&#38;Style"), paragraphXml("Body")]),
			"word/styles.xml": '<w:styles xmlns:w="urn:w"><w:style w:type="paragraph" w:styleId="Custom&amp;Style"><w:name w:val="head&#105;ng&#32;1"/></w:style></w:styles>',
		});
		assert.deepEqual((await extractDocument({ fileName: "encoded.docx", data })).blocks, [
			{ text: "Body", citation: { format: "docx", fileName: "encoded.docx", heading: "Heading", paragraph: 2 }, section: ["Heading"] },
		]);
	});

	for (const format of ["pptx", "docx"]) {
		it(`preserves literal CDATA while decoding ordinary ${format} XML text once`, async () => {
			const mixed = "Before &amp; <![CDATA[&amp; &#65; 日本]]> after &lt;";
			const data = officeZip(format === "pptx" ? { "ppt/slides/slide1.xml": slideXml([mixed]) } : { "word/document.xml": documentXml([paragraphXml(mixed, "Heading1"), paragraphXml("Body")]) });
			const text = "Before & &amp; &#65; 日本 after <";
			if (format === "pptx") {
				assert.deepEqual((await extractDocument({ fileName: `cdata.${format}`, data })).blocks, [{ text, citation: { format, fileName: `cdata.${format}`, slide: 1, title: text }, section: [text] }]);
			} else {
				assert.deepEqual((await extractDocument({ fileName: `cdata.${format}`, data })).blocks, [{ text: "Body", citation: { format, fileName: `cdata.${format}`, paragraph: 2, heading: text }, section: [text] }]);
			}
		});
	}

	for (const format of ["md", "txt"]) {
		it(`trims only blank boundary lines in ${format} and adjusts citations`, async () => {
			assert.deepEqual((await extractDocument({ fileName: `blank.${format}`, data: utf8("\n \n  Keep spaces  \n\nNext\n \n") })).blocks, [
				{ text: "  Keep spaces  \n\nNext", citation: { format, fileName: `blank.${format}`, lineStart: 3, lineEnd: 5 } },
			]);
		});
	}

	it("anchors an empty ATX heading without adding empty heading text or metadata", async () => {
		assert.deepEqual((await extractDocument({ fileName: "empty-heading.md", data: utf8("Preamble\n#\n\nBody\n\n## Next\nMore") })).blocks, [
			{ text: "Preamble", citation: { format: "md", fileName: "empty-heading.md", lineStart: 1, lineEnd: 1 } },
			{ text: "Body", citation: { format: "md", fileName: "empty-heading.md", lineStart: 2, lineEnd: 4 } },
			{ text: "Next\nMore", citation: { format: "md", fileName: "empty-heading.md", heading: "Next", lineStart: 6, lineEnd: 7 }, section: ["Next"] },
		]);
	});

	for (const [label, fence, closer] of [["backtick", "```md", "````"], ["tilde", "~~~md", "~~~~"]]) {
		it(`keeps apparent ATX headings inside ${label} fences as section content`, async () => {
			assert.deepEqual((await extractDocument({ fileName: "fenced.md", data: utf8(`# Real\nBefore\n${fence}\n# Inside\n${closer}\n## Next\nAfter`) })).blocks, [
				{ text: `Real\nBefore\n${fence}\n# Inside\n${closer}`, citation: { format: "md", fileName: "fenced.md", heading: "Real", lineStart: 1, lineEnd: 5 }, section: ["Real"] },
				{ text: "Next\nAfter", citation: { format: "md", fileName: "fenced.md", heading: "Next", lineStart: 6, lineEnd: 7 }, section: ["Real", "Next"] },
			]);
		});
	}
});
