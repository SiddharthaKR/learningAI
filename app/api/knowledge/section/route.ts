import { withOfficeUser, currentUserId, checkedStoresForUser, sharedKnowledgeStore, sectionText } from "@/src/server";

export const runtime = "nodejs";

function parsePath(raw: string | null): string[] | null {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((segment) => typeof segment === "string") ? value : null;
  } catch { return null; }
}

export const GET = withOfficeUser(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope");
  const doc = params.get("doc");
  const path = parsePath(params.get("path"));
  if ((scope !== "shared" && scope !== "personal") || !doc || path === null) return Response.json({ error: "invalid_request" }, { status: 400 });
  const store = scope === "shared" ? sharedKnowledgeStore : checkedStoresForUser(currentUserId()).knowledgeStore;
  const result = sectionText(await store.readSnapshot(), scope, doc, path);
  if (!result) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(result);
});
