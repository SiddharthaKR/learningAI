import path from "node:path";
import { readKnowledgeSnapshot, writeKnowledgeSnapshotAtomic, type KnowledgeSnapshot } from "../knowledge/index-store.ts";

export function createKnowledgeStore(root: string, beforePublish: () => void) {
	const indexFile = path.join(root, "knowledge", "index.json");
	// Future uploaded bytes belong under root/knowledge/documents/.
	return {
		readSnapshot: () => readKnowledgeSnapshot(indexFile),
		writeSnapshot: (snapshot: KnowledgeSnapshot) => writeKnowledgeSnapshotAtomic(indexFile, snapshot, beforePublish),
	};
}
