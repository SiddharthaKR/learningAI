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
		return sectionText(source.snapshot, source.scope, doc.id, section);
	}
	return null;
}
