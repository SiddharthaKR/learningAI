import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Inflate, zipSync } from "fflate";
import { extractSelectedZipEntries, KnowledgeArchiveError } from "../src/knowledge/archive.ts";
import { parseOfficeXml } from "../src/knowledge/xml.ts";

const MiB = 1024 * 1024;
const encode = (text: string) => new TextEncoder().encode(text);

type Entry = {
	name: string;
	data?: Uint8Array;
	declaredSize?: number;
	compression?: number;
	streaming?: boolean | "unsigned";
	packed?: Uint8Array;
};

// Repackage real fflate output, changing only the headers under test. Reusing
// packed payloads keeps the actual-byte bomb tests small on disk and in memory.
function archive(entries: Entry[]): Uint8Array {
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const packed = entry.packed ?? zipSync({ [entry.name]: entry.data ?? encode("ok") });
		const source = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
		const end = packed.length - 22;
		const centralOffset = source.getUint32(end + 16, true);
		const localBytes = packed.slice(0, centralOffset);
		const centralBytes = packed.slice(centralOffset, end);
		const lv = new DataView(localBytes.buffer);
		const cv = new DataView(centralBytes.buffer);
		assert.equal(new TextDecoder().decode(localBytes.subarray(30, 30 + lv.getUint16(26, true))), entry.name);
		cv.setUint32(42, offset, true);
		if (entry.declaredSize !== undefined) {
			lv.setUint32(22, entry.declaredSize, true);
			cv.setUint32(24, entry.declaredSize, true);
		}
		if (entry.compression !== undefined) {
			lv.setUint16(8, entry.compression, true);
			cv.setUint16(10, entry.compression, true);
		}
		local.push(localBytes);
		offset += localBytes.length;
		if (entry.streaming) {
			const signatureSize = entry.streaming === "unsigned" ? 0 : 4;
			const descriptor = new Uint8Array(12 + signatureSize);
			const dv = new DataView(descriptor.buffer);
			if (signatureSize) dv.setUint32(0, 0x08074b50, true);
			dv.setUint32(signatureSize, lv.getUint32(14, true), true);
			dv.setUint32(signatureSize + 4, lv.getUint32(18, true), true);
			dv.setUint32(signatureSize + 8, lv.getUint32(22, true), true);
			lv.setUint16(6, lv.getUint16(6, true) | 8, true);
			cv.setUint16(8, cv.getUint16(8, true) | 8, true);
			lv.setUint32(14, 0, true);
			lv.setUint32(18, 0, true);
			lv.setUint32(22, 0, true);
			local.push(descriptor);
			offset += descriptor.length;
		}
		central.push(centralBytes);
	}
	const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
	const result = new Uint8Array(offset + centralSize + 22);
	let cursor = 0;
	for (const bytes of [...local, ...central]) {
		result.set(bytes, cursor);
		cursor += bytes.length;
	}
	const end = new DataView(result.buffer, cursor, 22);
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, entries.length, true);
	end.setUint16(10, entries.length, true);
	end.setUint32(12, centralSize, true);
	end.setUint32(16, offset, true);
	return result;
}

// The real EOCD comment contains a closer fake EOCD that fflate accepts even
// though its comment length does not reach EOF. Its directory under-reports
// sizes while retaining the real local-header names and offsets.
function withForgedCommentDirectory(bytes: Uint8Array): Uint8Array {
	const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const realEnd = bytes.length - 22;
	const central = bytes.slice(source.getUint32(realEnd + 16, true), realEnd);
	new DataView(central.buffer).setUint32(24, 1, true);
	const result = new Uint8Array(bytes.length + central.length + 23);
	result.set(bytes);
	result.set(central, bytes.length);
	result.set(bytes.subarray(realEnd), bytes.length + central.length);
	const view = new DataView(result.buffer);
	view.setUint16(realEnd + 20, central.length + 23, true);
	view.setUint32(bytes.length + central.length + 16, bytes.length, true);
	return result;
}

function withCompressedPadding(bytes: Uint8Array, padding: number): Uint8Array {
	const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const central = source.getUint32(bytes.length - 6, true);
	const compressedSize = source.getUint32(18, true);
	const result = new Uint8Array(bytes.length + padding);
	result.set(bytes.subarray(0, central));
	result.set(bytes.subarray(central), central + padding);
	const view = new DataView(result.buffer);
	view.setUint32(18, compressedSize + padding, true);
	view.setUint32(central + padding + 20, compressedSize + padding, true);
	view.setUint32(result.length - 6, central + padding, true);
	return result;
}

function rejectsCode(run: () => unknown, code: string): void {
	assert.throws(run, (error: unknown) => {
		assert.ok(error instanceof KnowledgeArchiveError);
		assert.equal(error.code, code);
		assert.match(error.message, /[a-z]+ [a-z]+/i, "UI errors include a readable explanation");
		return true;
	});
}

describe("secure selected ZIP extraction", () => {
	it("rejects more than 2,000 central-directory entries before selecting", () => {
		const bytes = archive(Array.from({ length: 2001 }, (_, i) => ({ name: `${i}.xml` })));
		rejectsCode(() => extractSelectedZipEntries(bytes, () => { assert.fail("selection must follow entry-count preflight"); }), "ZIP_ENTRY_LIMIT");
	});

	it("counts declared bytes in unselected entries toward the 100 MiB limit", () => {
		const bytes = archive([{ name: "media.bin", declaredSize: 100 * MiB + 1 }]);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => false), "ZIP_DECLARED_TOTAL_LIMIT");
	});

	it("sums declared bytes across the entire central directory", () => {
		const bytes = archive([{ name: "a.bin", declaredSize: 60 * MiB }, { name: "b.bin", declaredSize: 40 * MiB + 1 }]);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => false), "ZIP_DECLARED_TOTAL_LIMIT");
	});

	it("rejects selected declared output above 16 MiB even with missing local sizes", () => {
		const bytes = archive([{ name: "word/document.xml", declaredSize: 16 * MiB + 1, streaming: true }]);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_DECLARED_ENTRY_LIMIT");
	});

	it("accepts the exact 2,000-entry and 100 MiB declared boundaries for unselected files", () => {
		const entries = Array.from({ length: 2000 }, (_, i) => ({ name: `${i}.bin`, declaredSize: i === 0 ? 100 * MiB : 0 }));
		assert.equal(extractSelectedZipEntries(archive(entries), () => false).size, 0);
	});

	it("returns only selected paths and never inflates corrupt unselected payloads", () => {
		const bad = zipSync({ "media.bin": encode("unselected corrupt payload") });
		const view = new DataView(bad.buffer);
		bad.fill(255, 30 + view.getUint16(26, true) + view.getUint16(28, true), view.getUint32(bad.length - 6, true));
		const bytes = archive([
			{ name: "media.bin", packed: bad },
			{ name: "word/document.xml", data: encode("日本語 document") },
		]);
		const selected = extractSelectedZipEntries(bytes, (name) => name === "word/document.xml");
		assert.deepEqual([...selected.keys()], ["word/document.xml"]);
		assert.equal(new TextDecoder().decode(selected.get("word/document.xml")), "日本語 document");
	});

	it("extracts streaming entries with local sizes absent", () => {
		const bytes = archive([{ name: "word/document.xml", data: encode("streamed"), streaming: true }]);
		assert.equal(new TextDecoder().decode(extractSelectedZipEntries(bytes, () => true).get("word/document.xml")), "streamed");
	});

	it("enforces the validated 17 MiB selected declaration despite a forged EOCD in its comment", () => {
		const bytes = withForgedCommentDirectory(archive([{ name: "document.xml", declaredSize: 17 * MiB }]));
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_DECLARED_ENTRY_LIMIT");
	});

	it("enforces the validated 101 MiB total declaration despite a forged EOCD in its comment", () => {
		const bytes = withForgedCommentDirectory(archive([{ name: "media.bin", declaredSize: 101 * MiB }]));
		rejectsCode(() => extractSelectedZipEntries(bytes, () => false), "ZIP_DECLARED_TOTAL_LIMIT");
	});

	it("never discovers or inflates an embedded selected local header in unselected stored data", () => {
		const embedded = zipSync({ "document.xml": new Uint8Array(16 * MiB + 1) }, { level: 1 });
		const embeddedView = new DataView(embedded.buffer);
		const payload = embedded.slice(0, embeddedView.getUint32(embedded.length - 6, true));
		const bytes = archive([
			{ name: "media.bin", packed: zipSync({ "media.bin": payload }, { level: 0 }), streaming: true },
			{ name: "document.xml", data: encode("real document") },
		]);
		const result = extractSelectedZipEntries(bytes, (name) => name === "document.xml");
		assert.deepEqual([...result.keys()], ["document.xml"]);
		assert.equal(new TextDecoder().decode(result.get("document.xml")), "real document");
	});

	it("preserves descriptor signatures embedded in selected stored payloads", () => {
		const payload = new Uint8Array(80).fill(65);
		payload.set([0x50, 0x4b, 0x07, 0x08], 32);
		const bytes = archive([{ name: "document.xml", packed: zipSync({ "document.xml": payload }, { level: 0 }), streaming: true }]);
		assert.deepEqual(extractSelectedZipEntries(bytes, () => true).get("document.xml"), payload);
	});

	for (const level of [0, 6] as const) {
		it(`extracts a valid unsigned descriptor with compression level ${level}`, () => {
			const payload = encode("unsigned descriptor payload");
			const bytes = archive([{ name: "document.xml", packed: zipSync({ "document.xml": payload }, { level }), streaming: "unsigned" }]);
			assert.deepEqual(extractSelectedZipEntries(bytes, () => true).get("document.xml"), payload);
		});
	}

	it("rejects actual selected output above 16 MiB when both headers under-report", () => {
		const bytes = archive([{ name: "bomb.xml", data: new Uint8Array(16 * MiB + 1), declaredSize: 1 }]);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_ACTUAL_ENTRY_LIMIT");
	});

	it("rejects actual selected total above 100 MiB while each entry stays within 16 MiB", () => {
		const packed = zipSync({ "part.xml": new Uint8Array(16 * MiB) }, { level: 1 });
		const bytes = archive(Array.from({ length: 7 }, () => ({ name: "part.xml", packed, declaredSize: 1 })));
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_ACTUAL_TOTAL_LIMIT");
	});

	it("accepts exact 16 MiB actual output", () => {
		const bytes = archive([{ name: "boundary.xml", data: new Uint8Array(16 * MiB) }]);
		assert.equal(extractSelectedZipEntries(bytes, () => true).get("boundary.xml")?.length, 16 * MiB);
	});

	for (const [label, bytes] of [["non-ZIP", encode("not a zip")], ["empty", new Uint8Array()], ["truncated", zipSync({ "a.xml": encode("a") }).slice(0, -8)]] as const) {
		it(`rejects ${label} ZIP data with a stable error`, () => {
			rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
		});
	}

	it("rejects a broken central-directory signature", () => {
		const bytes = archive([{ name: "a.xml" }]);
		const view = new DataView(bytes.buffer);
		bytes[view.getUint32(bytes.length - 6, true)] = 0;
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
	});

	it("rejects corrupt selected deflate streams cleanly", () => {
		const bytes = archive([{ name: "broken.xml" }]);
		const view = new DataView(bytes.buffer);
		const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true);
		bytes.fill(255, payload, view.getUint32(bytes.length - 6, true));
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
	});

	it("rejects selected raw DEFLATE with padding after its final block", () => {
		const bytes = withCompressedPadding(archive([{ name: "document.xml", data: encode("valid final block") }]), 256 * 1024);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
	});

	it("bounds decoder pending input by rejecting a completed final block before feeding padding", (context) => {
		const originalPush = Inflate.prototype.push;
		let maxInput = 0;
		let pushes = 0;
		context.mock.method(Inflate.prototype, "push", function (this: Inflate, chunk: Uint8Array, final?: boolean) {
			// Observe the real pinned decoder, retaining its behavior. A stored
			// DEFLATE block may need 65,541 pending bytes plus one 1,024-byte push.
			const pending = (this as unknown as { p: Uint8Array }).p.length;
			maxInput = Math.max(maxInput, pending + chunk.length);
			pushes++;
			return originalPush.call(this, chunk, final);
		});
		const bytes = withCompressedPadding(archive([{ name: "document.xml", data: encode("valid final block") }]), 256 * 1024);
		try { extractSelectedZipEntries(bytes, () => true); } catch { /* Limits are asserted separately above. */ }
		assert.ok(maxInput <= 65541 + 1024, `decoder retained ${maxInput} bytes of pending input`);
		assert.equal(pushes, 1, "stop at the final block before copying any later padding");
	});

	it("accepts a maximum-length stored DEFLATE block across bounded input chunks", (context) => {
		const originalPush = Inflate.prototype.push;
		let maxInput = 0;
		context.mock.method(Inflate.prototype, "push", function (this: Inflate, chunk: Uint8Array, final?: boolean) {
			maxInput = Math.max(maxInput, (this as unknown as { p: Uint8Array }).p.length + chunk.length);
			return originalPush.call(this, chunk, final);
		});
		const payload = new Uint8Array(65535).fill(65);
		// One literal RFC 1951 BFINAL stored block, LEN=65,535, NLEN=0.
		const compressed = new Uint8Array(payload.length + 5);
		compressed.set([1, 255, 255, 0, 0]);
		compressed.set(payload, 5);
		const bytes = withCompressedPadding(zipSync({ "document.xml": payload }, { level: 0 }), compressed.length - payload.length);
		const view = new DataView(bytes.buffer);
		const central = view.getUint32(bytes.length - 6, true);
		bytes.set(compressed, 30 + view.getUint16(26, true) + view.getUint16(28, true));
		view.setUint16(8, 8, true);
		view.setUint16(central + 10, 8, true);
		assert.deepEqual(extractSelectedZipEntries(bytes, () => true).get("document.xml"), payload);
		assert.ok(maxInput <= 65541 + 1024, `decoder retained ${maxInput} bytes of pending input`);
	});

	it("rejects a selected stored payload whose bytes disagree with its central CRC", () => {
		const bytes = archive([{ name: "document.xml", packed: zipSync({ "document.xml": encode("original") }, { level: 0 }) }]);
		const view = new DataView(bytes.buffer);
		const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true);
		bytes[payload] = bytes[payload]! ^ 1;
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
	});

	it("rejects selected DEFLATE output whose CRC disagrees with the authoritative directory", () => {
		const bytes = archive([{ name: "document.xml", data: encode("original") }]);
		const view = new DataView(bytes.buffer);
		const central = view.getUint32(bytes.length - 6, true);
		view.setUint32(central + 16, view.getUint32(central + 16, true) ^ 1, true);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
	});

	it("rejects unsupported ZIP compression cleanly", () => {
		rejectsCode(() => extractSelectedZipEntries(archive([{ name: "a.xml", compression: 99 }]), () => true), "ZIP_UNSUPPORTED_COMPRESSION");
	});

	for (const kind of ["ZIP64", "multidisk", "encrypted"] as const) {
		it(`rejects unsupported ${kind} archive structures`, () => {
			const bytes = archive([{ name: "a.xml" }]);
			const view = new DataView(bytes.buffer);
			if (kind === "ZIP64") view.setUint32(bytes.length - 6, 0xffffffff, true);
			if (kind === "multidisk") view.setUint16(bytes.length - 18, 1, true);
			if (kind === "encrypted") {
				view.setUint16(6, view.getUint16(6, true) | 1, true);
				const central = view.getUint32(bytes.length - 6, true);
				view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
			}
			rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
		});
	}

	it("rejects a local filename absent from the central directory", () => {
		const bytes = archive([{ name: "a.xml" }]);
		bytes[30] = "b".charCodeAt(0);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
	});

	it("rejects local compressed sizes that disagree with the central directory", () => {
		const bytes = archive([{ name: "a.xml" }]);
		const view = new DataView(bytes.buffer);
		view.setUint32(18, view.getUint32(18, true) + 1, true);
		rejectsCode(() => extractSelectedZipEntries(bytes, () => true), "ZIP_INVALID");
	});
});

describe("safe Office XML", () => {
	it("preserves interleaved Office elements in opt-in ordered mode", () => {
		assert.deepEqual(parseOfficeXml(encode('<a:p><a:r><a:t>First</a:t></a:r><a:fld><a:t>Second</a:t></a:fld><a:r><a:t>Third</a:t></a:r></a:p>'), { preserveOrder: true }), [
			{ "a:p": [
				{ "a:r": [{ "a:t": [{ "#text": "First" }] }] },
				{ "a:fld": [{ "a:t": [{ "#text": "Second" }] }] },
				{ "a:r": [{ "a:t": [{ "#text": "Third" }] }] },
			] },
		]);
	});

	it("retains declaration rejection in ordered mode", () => {
		rejectsCode(() => parseOfficeXml(encode('<!DOCTYPE root><root/>'), { preserveOrder: true }), "XML_UNSAFE_DECLARATION");
	});

	it("retains distinct CDATA provenance in ordered mode", () => {
		assert.deepEqual(parseOfficeXml(encode('<w:t>Before &amp; <![CDATA[&amp; &#65; 日本]]> after &lt;</w:t>'), { preserveOrder: true }), [
			{ "w:t": [{ "#text": "Before &amp; " }, { "#cdata": [{ "#text": "&amp; &#65; 日本" }] }, { "#text": " after &lt;" }] },
		]);
	});

	for (const declaration of ["<!DOCTYPE root>", "<!dOcTyPe root>", "<!  DOCTYPE root>", "<!ENTITY x 'unsafe'>", "<!eNtItY x 'unsafe'>", "<!\nENTITY x 'unsafe'>"]) {
		it(`rejects declaration ${JSON.stringify(declaration)} before parsing`, () => {
			rejectsCode(() => parseOfficeXml(encode(`${declaration}<root>&x;</root>`)), "XML_UNSAFE_DECLARATION");
		});
	}

	it("preserves Office namespace prefixes, attributes, text whitespace, and entity references", () => {
		assert.deepEqual(parseOfficeXml(encode('<w:document><w:p w:style="01"><w:t>  日本語 &amp; 01  </w:t></w:p></w:document>')), {
			"w:document": { "w:p": { "w:t": "  日本語 &amp; 01  ", "@_w:style": "01" } },
		});
	});

	it("rejects malformed XML with a stable error", () => {
		rejectsCode(() => parseOfficeXml(encode("<root><unclosed></root>")), "XML_INVALID");
	});
});
