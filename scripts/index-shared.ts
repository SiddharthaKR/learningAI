import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeKnowledgeSnapshotAtomic, type KnowledgeSnapshot } from "../src/knowledge/index-store.ts";
import { indexKnowledgeDocument, unreadableKnowledgeDocument } from "../src/knowledge/service.ts";
import { visionConfigFromEnv, type VisionConfig } from "../src/knowledge/vision-job.ts";

function ignored(name: string): boolean {
	return name.startsWith(".") || name.startsWith("~$") || name.endsWith("~") || /\.(tmp|part|swp)$/iu.test(name);
}

export async function indexSharedKnowledge({ sourceDir, indexFile, visionConfig }: { sourceDir: string; indexFile: string; visionConfig?: VisionConfig }): Promise<KnowledgeSnapshot> {
	// Win32 ordinary and extended-length paths must share the same namespace
	// before relative-path comparison; path.relative also handles casing.
	const source = path.toNamespacedPath(path.resolve(sourceDir));
	const output = path.toNamespacedPath(path.resolve(indexFile));
	const files: string[] = [];
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (ignored(entry.name) || entry.isSymbolicLink()) continue;
			const file = path.join(directory, entry.name);
			if (path.relative(output, file) === "") continue;
			if (entry.isDirectory()) await visit(file);
			else if (entry.isFile()) files.push(path.relative(source, file).split(path.sep).join("/"));
		}
	}
	await visit(source);
	files.sort();
	const snapshot: KnowledgeSnapshot = { version: 1, generatedAt: new Date().toISOString(), documents: [], chunks: [] };
	for (const fileName of files) {
		let data: Uint8Array;
		try { data = await readFile(path.join(source, fileName)); }
		catch { snapshot.documents.push(unreadableKnowledgeDocument(fileName)); continue; }
		const indexed = await indexKnowledgeDocument({ fileName, data, ...(visionConfig ? { vision: { config: visionConfig } } : {}) });
		const failed = indexed.imageReport?.failedSlides ?? [];
		if (failed.length) console.warn(`${fileName}: images on slides ${failed.join(", ")} could not be read; indexed the slide text.`);
		if (indexed.imageReport?.skipped) console.warn(`${fileName}: ${indexed.imageReport.skipped} images over the per-document limit were not read.`);
		snapshot.documents.push(indexed.document);
		snapshot.chunks.push(...indexed.chunks);
	}
	await writeKnowledgeSnapshotAtomic(output, snapshot);
	return snapshot;
}

export async function runIndexShared(env: Record<string, string | undefined> = process.env): Promise<void> {
	const sourceDir = env.KNOWLEDGE_SHARED_DIR?.trim();
	const indexFile = env.KNOWLEDGE_INDEX_FILE?.trim();
	if (!sourceDir) throw new Error("KNOWLEDGE_SHARED_DIR is required: set the shared source folder.");
	if (!indexFile) throw new Error("KNOWLEDGE_INDEX_FILE is required: set the shared snapshot file.");
	await indexSharedKnowledge({ sourceDir, indexFile, visionConfig: visionConfigFromEnv(env) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try { await runIndexShared(); }
	catch (error) { console.error(error instanceof Error ? error.message : "Shared knowledge indexing failed."); process.exitCode = 1; }
}
