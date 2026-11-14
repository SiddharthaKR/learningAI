/**
 * OPEN SECTION RESOLUTION (owner-approved plan, 2026-11-13): maps a file
 * name + heading path to one ready document across the owner's personal,
 * shared-upload and admin-index snapshots, then returns its section text.
 * Pure over the supplied snapshots; the caller (service.ts) loads them.
 */
import type { KnowledgeSnapshot } from "./index-store.ts";
import type { KnowledgeScope, KnowledgeSectionResponse } from "./map-contracts.ts";
import { sectionText } from "./map.ts";

export interface OpenSectionSource {
	scope: KnowledgeScope;
	/** Short label used only when listing ambiguous matches. */
	label: string;
	snapshot: KnowledgeSnapshot;
}

export type OpenSectionResult = KnowledgeSectionResponse | { ambiguous: string[] } | null;

/** Sources must be passed in precedence order; personal wins over shared. */
export function resolveOpenSection(sources: OpenSectionSource[], fileName: string, section: string[]): OpenSectionResult {
	for (const matches of [(name: string) => name === fileName, (name: string) => name.toLowerCase() === fileName.toLowerCase()]) {
		const found = sources.flatMap((source) =>
			source.snapshot.documents
				.filter((doc) => doc.status === "ready" && matches(doc.fileName))
				.map((doc) => ({ source, doc })));
		if (found.length === 0) continue;
		const personal = found.filter((entry) => entry.source.scope === "personal");
		const pool = personal.length > 0 ? personal : found;
		if (pool.length > 1) {
			return { ambiguous: pool.map(({ source, doc }) => `${doc.fileName} (${source.label}, id ${doc.id.slice(0, 8)})`) };
		}
		const { source, doc } = pool[0]!;
		const exact = sectionText(source.snapshot, source.scope, doc.id, section);
		if (exact || section.length === 0) return exact;
		// Agents often drop the leading segments (a PDF's single title
		// section) — owner report, 2026-11-14. Accept the path when exactly
		// one section in this document ends with it.
		const full = uniquePathEndingWith(source.snapshot, doc.id, section);
		return full ? sectionText(source.snapshot, source.scope, doc.id, full) : null;
	}
	return null;
}

/** The single full section path in a document that has `tail` as its last
 *  segments (any depth), or null when none or several match. */
function uniquePathEndingWith(snapshot: KnowledgeSnapshot, documentId: string, tail: string[]): string[] | null {
	const candidates = new Map<string, string[]>();
	for (const chunk of snapshot.chunks) {
		const path = chunk.sourceId === documentId ? chunk.section : undefined;
		if (!path || path.length <= tail.length) continue;
		for (let end = tail.length; end <= path.length; end++) {
			const prefix = path.slice(0, end);
			if (tail.every((segment, i) => prefix[end - tail.length + i] === segment)) candidates.set(prefix.join("\u001f"), prefix);
		}
	}
	return candidates.size === 1 ? [...candidates.values()][0]! : null;
}
