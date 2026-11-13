import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeCitation } from "./contracts.ts";
import type { KnowledgeSnapshot } from "./index-store.ts";
import { buildKnowledgeMap, sectionText } from "./map.ts";
import type { KnowledgeMapNode } from "./map-contracts.ts";

/** Safe, deterministic note slug base: no Windows-reserved characters, <= 120 chars. */
export function slugify(raw: string): string {
	const cleaned = raw
		.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, 120)
		.replace(/[. ]+$/u, "");
	return cleaned || "note";
}

function pageOf(citation?: KnowledgeCitation): string[] {
	if (!citation) return [];
	if (citation.format === "pdf") return [`page: ${citation.page}`];
	if (citation.format === "pptx") return [`slide: ${citation.slide}`];
	return [];
}

/**
 * Rebuild `<root>/knowledge/vault/` from scratch: one Markdown note per
 * document and per section, linked by wikilinks. Built in a temp dir, then
 * swapped in so readers never see a half-built vault.
 */
export async function writeKnowledgeVault(root: string, snapshot: KnowledgeSnapshot): Promise<void> {
	const knowledgeDir = path.join(root, "knowledge");
	const vaultDir = path.join(knowledgeDir, "vault");
	const tempDir = path.join(knowledgeDir, `.vault-${randomUUID()}.tmp`);
	const oldDir = path.join(knowledgeDir, `.vault-old-${randomUUID()}.tmp`);
	const map = buildKnowledgeMap(snapshot, "shared"); // scope does not affect note naming
	const names = new Map<string, string>();
	const used = new Set<string>();
	for (const node of map.nodes) {
		const base = slugify(node.kind === "document" ? node.fileName : `${node.fileName} ${node.path.join(" ")}`);
		let name = base;
		for (let n = 2; used.has(name.toLowerCase()); n++) {
			const suffix = `-${n}`;
			name = `${base.slice(0, 120 - suffix.length).replace(/[. ]+$/u, "")}${suffix}`;
		}
		used.add(name.toLowerCase());
		names.set(node.id, name);
	}
	const parent = new Map<string, string>();
	const children = new Map<string, string[]>();
	for (const edge of map.edges) {
		parent.set(edge.to, edge.from);
		children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
	}
	const render = (node: KnowledgeMapNode): string => {
		const lines = ["---", `file: ${JSON.stringify(node.fileName)}`, `documentId: ${JSON.stringify(node.documentId)}`, `path: ${JSON.stringify(node.path)}`, ...pageOf(node.citation), "---", "", `# ${node.label}`, ""];
		const parentId = parent.get(node.id);
		if (parentId) lines.push(`Parent: [[${names.get(parentId)}]]`, "");
		const kids = children.get(node.id) ?? [];
		if (kids.length) lines.push("Children:", ...kids.map((id) => `- [[${names.get(id)}]]`), "");
		const section = sectionText(snapshot, "shared", node.documentId, node.path);
		if (section) lines.push(section.text, "");
		return lines.join("\n");
	};
	try {
		await mkdir(tempDir, { recursive: true });
		for (const node of map.nodes) await writeFile(path.join(tempDir, `${names.get(node.id)}.md`), render(node), "utf8");
		await renameWithRetry(vaultDir, oldDir).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
		await renameWithRetry(tempDir, vaultDir);
	} finally {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		await rm(oldDir, { recursive: true, force: true }).catch(() => {});
	}
}

/** Windows briefly locks freshly written files (indexer/antivirus), so a
 *  directory rename right after writing can fail with EPERM/EBUSY/EACCES.
 *  Retry with a short backoff; anything else (or the last attempt) throws. */
async function renameWithRetry(from: string, to: string): Promise<void> {
	const delays = [50, 100, 200, 400, 800, 1600];
	for (let attempt = 0; ; attempt++) {
		try {
			await rename(from, to);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (attempt >= delays.length || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
			await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
		}
	}
}
