import { checkedStoresForUser, currentUserId, indexKnowledgeDocument, knowledgeVision, sharedKnowledgeStore, withOfficeUser } from "@/src/server";
import type { KnowledgeDocumentRecord } from "@/src/core";

export const runtime = "nodejs";

function publicDocument(document: KnowledgeDocumentRecord) {
  const { contentHash: _hash, error: _error, ...metadata } = document;
  return metadata;
}

/**
 * POST /api/knowledge/documents/[id]/pictures[?scope=shared] — read the pictures of a
 * saved document (the "Read pictures" action). Re-running it retries pictures that
 * failed before. Personal documents: the owner; shared documents: any signed-in user.
 */
export const POST = withOfficeUser(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const vision = knowledgeVision();
  if (!vision) return Response.json({ error: "vision_unavailable" }, { status: 503 });
  const store = new URL(request.url).searchParams.get("scope") === "shared" ? sharedKnowledgeStore : checkedStoresForUser(currentUserId()).knowledgeStore;
  const current = (await store.readSnapshot()).documents.find((document) => document.id === id);
  if (!current) return Response.json({ error: "not_found" }, { status: 404 });
  if (!current.hasPictures) return Response.json({ error: "no_pictures" }, { status: 409 });
  const upgraded = await store.reindexDocument(id, (fileName, data) => indexKnowledgeDocument({ fileName, data, vision }));
  if (!upgraded) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ document: publicDocument(upgraded.document), ...(upgraded.result.imageReport ? { imageReport: upgraded.result.imageReport } : {}) });
});
