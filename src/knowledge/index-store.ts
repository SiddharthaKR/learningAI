import { randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { KnowledgeChunk, KnowledgeFormat } from "./contracts.ts";

export interface KnowledgeDocumentRecord {
	id: string;
	fileName: string;
	format?: KnowledgeFormat;
	status: "ready" | "no_text_layer" | "rejected";
	error?: string;
	contentHash?: string;
}
export interface KnowledgeSnapshot {
	version: 1;
	generatedAt: string;
	documents: KnowledgeDocumentRecord[];
	chunks: KnowledgeChunk[];
}
const idSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const fileNameSchema = z.string().min(1).refine((name) => !name.includes("\\") && !name.includes("\0") && !/^[A-Za-z]:/u.test(name) && name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."));
export function normalizeKnowledgeFileName(fileName: string): string {
	const normalized = fileName.replaceAll("\\", "/");
	if (!fileNameSchema.safeParse(normalized).success) throw new Error("Knowledge file name must be a normalized relative path.");
	return normalized;
}

const formatSchema = z.enum(["pdf", "pptx", "docx", "md", "txt"]);
const positionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const citationSchema = z.discriminatedUnion("format", [
	z.strictObject({ format: z.literal("pdf"), fileName: fileNameSchema, page: positionSchema }),
	z.strictObject({ format: z.literal("pptx"), fileName: fileNameSchema, slide: positionSchema, title: z.string() }),
	z.strictObject({ format: z.literal("docx"), fileName: fileNameSchema, paragraph: positionSchema, heading: z.string().optional() }),
	z.strictObject({ format: z.enum(["md", "txt"]), fileName: fileNameSchema, lineStart: positionSchema, lineEnd: positionSchema, heading: z.string().optional() }).refine((citation) => citation.lineEnd >= citation.lineStart),
]);
const snapshotSchema = z.strictObject({
	version: z.literal(1),
	generatedAt: z.string().min(1),
	documents: z.array(z.strictObject({ id: idSchema, fileName: fileNameSchema, format: formatSchema.optional(), status: z.enum(["ready", "no_text_layer", "rejected"]), error: z.string().optional(), contentHash: idSchema.optional() }).refine((record) => record.status === "rejected" || record.format !== undefined)),
	chunks: z.array(z.strictObject({ id: idSchema, sourceId: idSchema, text: z.string().min(1), citation: citationSchema })),
});

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Parse into fresh objects before freezing; callers never retain mutable aliases. */
export function validateKnowledgeSnapshot(raw: unknown): KnowledgeSnapshot {
	const parsed = snapshotSchema.safeParse(raw);
	if (!parsed.success) throw new Error("Invalid knowledge snapshot: malformed v1 shape or unsupported version.");
	const snapshot = parsed.data;
	const documents = new Map(snapshot.documents.map((document) => [document.id, document]));
	const chunkIds = new Set(snapshot.chunks.map((chunk) => chunk.id));
	if (documents.size !== snapshot.documents.length || chunkIds.size !== snapshot.chunks.length) throw new Error("Invalid knowledge snapshot: duplicate document or chunk ID.");
	for (const chunk of snapshot.chunks) {
		const document = documents.get(chunk.sourceId);
		if (!document || document.status !== "ready" || document.fileName !== chunk.citation.fileName || document.format !== chunk.citation.format) throw new Error("Invalid knowledge snapshot: chunk source or citation does not match a ready document.");
	}
	return deepFreeze(snapshot);
}

/** A reader owns one open descriptor, so atomic replacements cannot mix generations. */
export async function readKnowledgeSnapshot(filePath: string): Promise<KnowledgeSnapshot> {
	let handle;
	try { handle = await open(filePath, "r"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return validateKnowledgeSnapshot({ version: 1, generatedAt: new Date(0).toISOString(), documents: [], chunks: [] });
	}
	try {
		const text = await handle.readFile("utf8");
		let raw: unknown;
		try { raw = JSON.parse(text); }
		catch { throw new Error("Invalid knowledge snapshot: malformed JSON."); }
		return validateKnowledgeSnapshot(raw);
	} finally { await handle.close(); }
}

/** Authorized writers only; the read path never calls this function. */
export async function writeKnowledgeSnapshotAtomic(filePath: string, snapshot: KnowledgeSnapshot, beforePublish?: () => void): Promise<void> {
	const serialized = JSON.stringify(validateKnowledgeSnapshot(snapshot));
	const directory = path.dirname(filePath);
	await mkdir(directory, { recursive: true });
	const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(serialized, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		// Keep authorization and replacement in one event-loop turn. A queued
		// account deletion must not run between this final check and publication.
		beforePublish?.();
		renameSync(temporary, filePath);
	} finally {
		try { if (handle) await handle.close(); }
		finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
	}
}
