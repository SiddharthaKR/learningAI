import { Inflate, strFromU8 } from "fflate";

export type KnowledgeArchiveErrorCode =
	| "ZIP_ENTRY_LIMIT"
	| "ZIP_DECLARED_TOTAL_LIMIT"
	| "ZIP_DECLARED_ENTRY_LIMIT"
	| "ZIP_ACTUAL_TOTAL_LIMIT"
	| "ZIP_ACTUAL_ENTRY_LIMIT"
	| "ZIP_INVALID"
	| "ZIP_UNSUPPORTED_COMPRESSION"
	| "XML_UNSAFE_DECLARATION"
	| "XML_INVALID";

export class KnowledgeArchiveError extends Error {
	constructor(public readonly code: KnowledgeArchiveErrorCode, message: string) {
		super(message);
		this.name = "KnowledgeArchiveError";
	}
}

const MAX_ENTRIES = 2000;
const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_ENTRY = 16 * 1024 * 1024;
const INPUT_CHUNK_SIZE = 1024;
const MAX_PENDING_DEFLATE_INPUT = 65541;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
	let crc = value;
	for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	return crc >>> 0;
});

function invalid(): never {
	throw new KnowledgeArchiveError("ZIP_INVALID", "The ZIP archive is malformed or uses an unsupported ZIP structure.");
}

function pushDeflateChunk(inflate: Inflate, chunk: Uint8Array, final: boolean): void {
	// Pinned fflate 0.8.3: p is retained compressed input; s.p is its consumed
	// bit offset (reduced to 0..7 after push); s.f && !s.l means BFINAL ended.
	// A stored block can retain 65,535 data bytes plus at most six header
	// bytes. Thus a push holds at most 65,541 + 1,024 input bytes. Completion
	// must coincide with the exact span end, with at most its last partial
	// byte retained. Never feed more bytes after BFINAL: fflate otherwise
	// retains and repeatedly copies them instead of rejecting trailing data.
	const decoder = inflate as unknown as {
		p: Uint8Array;
		s: { p?: number; f?: number; l?: Uint16Array | null };
	};
	if (chunk.length > INPUT_CHUNK_SIZE || decoder.p.length > MAX_PENDING_DEFLATE_INPUT) invalid();
	inflate.push(chunk, final);
	if (decoder.p.length > MAX_PENDING_DEFLATE_INPUT) invalid();
	const finished = decoder.s.f === 1 && !decoder.s.l;
	if (finished) {
		if (!final || decoder.p.length !== (decoder.s.p ? 1 : 0)) invalid();
	} else if (final) invalid();
}

type ZipEntry = {
	name: string;
	compression: number;
	originalSize: number;
	localOffset: number;
	payloadStart: number;
	payloadEnd: number;
	flags: number;
	crc: number;
};

// Parse one validated directory. Names, declared sizes, and exact compressed
// spans stay authoritative through extraction; payload bytes are never scanned
// for ZIP headers or descriptor signatures.
function readDirectory(data: Uint8Array): ZipEntry[] {
	if (data.length < 22) invalid();
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let end = data.length - 22;
	const earliest = Math.max(0, end - 65535);
	for (; end >= earliest; end--) {
		if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === data.length) break;
	}
	if (end < earliest) invalid();
	const count = view.getUint16(end + 10, true);
	if (count > MAX_ENTRIES) {
		throw new KnowledgeArchiveError("ZIP_ENTRY_LIMIT", "The ZIP archive contains more than 2,000 entries.");
	}
	if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) invalid();
	const centralStart = view.getUint32(end + 16, true);
	const centralSize = view.getUint32(end + 12, true);
	if (centralStart + centralSize !== end) invalid();
	const entries: ZipEntry[] = [];
	let cursor = centralStart;
	for (let i = 0; i < count; i++) {
		if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) invalid();
		const flags = view.getUint16(cursor + 8, true);
		const compression = view.getUint16(cursor + 10, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const originalSize = view.getUint32(cursor + 24, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const next = cursor + 46 + nameLength + extraLength + view.getUint16(cursor + 32, true);
		const local = view.getUint32(cursor + 42, true);
		if (next > end || flags & 0x41 || view.getUint16(cursor + 34, true) || compressedSize === 0xffffffff || originalSize === 0xffffffff) invalid();
		// ZIP64 is outside the conventional single-disk Office ZIP contract.
		for (let extra = cursor + 46 + nameLength; extra < cursor + 46 + nameLength + extraLength;) {
			if (extra + 4 > next || view.getUint16(extra, true) === 1) invalid();
			extra += 4 + view.getUint16(extra + 2, true);
			if (extra > cursor + 46 + nameLength + extraLength) invalid();
		}
		if (local + 30 > centralStart || view.getUint32(local, true) !== 0x04034b50) invalid();
		if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== compression || view.getUint16(local + 26, true) !== nameLength) invalid();
		const payload = local + 30 + nameLength + view.getUint16(local + 28, true);
		const payloadEnd = payload + compressedSize;
		if (payloadEnd > centralStart) invalid();
		for (let j = 0; j < nameLength; j++) {
			if (data[local + 30 + j] !== data[cursor + 46 + j]) invalid();
		}
		if (!(flags & 8) && (view.getUint32(local + 18, true) !== compressedSize || view.getUint32(local + 22, true) !== originalSize)) invalid();
		entries.push({
			name: strFromU8(data.subarray(cursor + 46, cursor + 46 + nameLength), !(flags & 2048)),
			compression,
			originalSize,
			localOffset: local,
			payloadStart: payload,
			payloadEnd,
			flags,
			crc: view.getUint32(cursor + 16, true),
		});
		cursor = next;
	}
	if (cursor !== end) invalid();
	const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset);
	if ((ordered[0]?.localOffset ?? centralStart) !== 0) invalid();
	for (let i = 0; i < ordered.length; i++) {
		const entry = ordered[i]!;
		const next = ordered[i + 1]?.localOffset ?? centralStart;
		if (entry.payloadEnd > next) invalid();
		if (entry.flags & 8) {
			// The next validated local offset fixes descriptor length. This also
			// handles an unsigned descriptor whose CRC equals the signature.
			const length = next - entry.payloadEnd;
			if (length !== 12 && length !== 16) invalid();
			if (length === 16 && view.getUint32(entry.payloadEnd, true) !== 0x08074b50) invalid();
			const descriptor = entry.payloadEnd + (length === 16 ? 4 : 0);
			if (view.getUint32(descriptor, true) !== entry.crc || view.getUint32(descriptor + 4, true) !== entry.payloadEnd - entry.payloadStart || view.getUint32(descriptor + 8, true) !== entry.originalSize) invalid();
		} else if (entry.payloadEnd !== next) invalid();
	}
	return entries;
}

export function extractSelectedZipEntries(data: Uint8Array, select: (name: string) => boolean): Map<string, Uint8Array> {
	try {
		const entries = readDirectory(data);
		let declaredTotal = 0;
		for (const entry of entries) {
			declaredTotal += entry.originalSize;
			if (declaredTotal > MAX_TOTAL) {
				throw new KnowledgeArchiveError("ZIP_DECLARED_TOTAL_LIMIT", "The ZIP archive declares more than 100 MiB of uncompressed data.");
			}
			if (entry.compression !== 0 && entry.compression !== 8) {
				throw new KnowledgeArchiveError("ZIP_UNSUPPORTED_COMPRESSION", "The ZIP archive uses an unsupported compression method.");
			}
		}
		const selected = entries.filter((entry) => {
			if (!select(entry.name)) return false;
			if (entry.originalSize > MAX_ENTRY) {
				throw new KnowledgeArchiveError("ZIP_DECLARED_ENTRY_LIMIT", "A selected ZIP entry declares more than 16 MiB of uncompressed data.");
			}
			return true;
		}).sort((a, b) => a.localOffset - b.localOffset);
		const result = new Map<string, Uint8Array>();
		let actualTotal = 0;
		for (const entry of selected) {
			let size = 0;
			let crc = 0xffffffff;
			const chunks: Uint8Array[] = [];
			const ondata = (chunk: Uint8Array) => {
				size += chunk.length;
				actualTotal += chunk.length;
				if (size > MAX_ENTRY || actualTotal > MAX_TOTAL) {
					throw new KnowledgeArchiveError(size > MAX_ENTRY ? "ZIP_ACTUAL_ENTRY_LIMIT" : "ZIP_ACTUAL_TOTAL_LIMIT", size > MAX_ENTRY ? "A selected ZIP entry expands beyond 16 MiB." : "Selected ZIP entries expand beyond 100 MiB in total.");
				}
				for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
				chunks.push(chunk);
			};
			const inflate = entry.compression === 8 ? new Inflate(ondata) : undefined;
			// Read only this entry's validated compressed span. Descriptor bytes
			// and unselected payloads never enter any decompression stream.
			for (let offset = entry.payloadStart; offset < entry.payloadEnd; offset += INPUT_CHUNK_SIZE) {
				const end = Math.min(offset + INPUT_CHUNK_SIZE, entry.payloadEnd);
				const chunk = data.subarray(offset, end);
				if (inflate) pushDeflateChunk(inflate, chunk, end === entry.payloadEnd);
				else ondata(chunk);
			}
			if (inflate && entry.payloadStart === entry.payloadEnd) pushDeflateChunk(inflate, new Uint8Array(), true);
			if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) invalid();
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.length;
			}
			result.set(entry.name, bytes);
		}
		return result;
	} catch (error) {
		if (error instanceof KnowledgeArchiveError) throw error;
		invalid();
	}
}
