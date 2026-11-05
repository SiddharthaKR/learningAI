import { withOfficeUser } from "@/src/server/route-scope";
import { currentUserId } from "@/src/server/user-scope";
import { checkedStoresForUser } from "@/src/server/stores";

export const runtime = "nodejs";
export const DELETE = withOfficeUser(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const deleted = await checkedStoresForUser(currentUserId()).knowledgeStore.deleteDocument(id);
  return deleted ? Response.json({ deleted: true }) : Response.json({ error: "not_found" }, { status: 404 });
});
