import { currentUserId, isAdminUser, readSharedKnowledgeAudit, withOfficeUser } from "@/src/server";

export const runtime = "nodejs";

export const GET = withOfficeUser(async () => {
  if (!(await isAdminUser(currentUserId()))) return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json({ events: await readSharedKnowledgeAudit() });
});
