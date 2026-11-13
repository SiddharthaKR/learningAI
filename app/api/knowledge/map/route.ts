import { withOfficeUser, currentUserId, checkedStoresForUser, sharedKnowledgeStore } from "@/src/server";
import { buildKnowledgeMap } from "@/src/knowledge/map";
import type { KnowledgeMapResponse } from "@/src/knowledge/map-contracts";

export const runtime = "nodejs";

export const GET = withOfficeUser(async () => {
  const shared = buildKnowledgeMap(await sharedKnowledgeStore.readSnapshot(), "shared");
  const personal = buildKnowledgeMap(await checkedStoresForUser(currentUserId()).knowledgeStore.readSnapshot(), "personal");
  const body: KnowledgeMapResponse = { nodes: [...shared.nodes, ...personal.nodes], edges: [...shared.edges, ...personal.edges] };
  return Response.json(body);
});
