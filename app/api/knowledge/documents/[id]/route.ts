import { appendSharedKnowledgeAudit, checkedStoresForUser, currentUserId, sharedKnowledgeStore, usernameForUserId, withOfficeUser } from "@/src/server";

export const runtime = "nodejs";
export const DELETE = withOfficeUser(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  if (new URL(request.url).searchParams.get("scope") === "shared") {
    const userId = currentUserId();
    const snapshot = await sharedKnowledgeStore.readSnapshot();
    const target = snapshot.documents.find((document) => document.id === id);
    const deleted = await sharedKnowledgeStore.deleteDocument(id);
    if (!deleted || !target) return Response.json({ error: "not_found" }, { status: 404 });
    await appendSharedKnowledgeAudit({ at: new Date().toISOString(), userId, username: await usernameForUserId(userId), action: "delete", fileName: target.fileName, documentId: id });
    return Response.json({ deleted: true });
  }
  const deleted = await checkedStoresForUser(currentUserId()).knowledgeStore.deleteDocument(id);
  return deleted ? Response.json({ deleted: true }) : Response.json({ error: "not_found" }, { status: 404 });
});
