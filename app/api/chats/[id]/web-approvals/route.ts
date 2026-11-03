import { withOfficeUser } from "@/src/server/route-scope";
import { currentUserId } from "@/src/server/user-scope";
﻿import { pendingApprovalsForChat } from "@/src/server";

export const dynamic = "force-dynamic";
async function GETImpl(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pending = pendingApprovalsForChat({ userId: currentUserId() }, id);
  return pending === null ? Response.json({ error: "Not found" }, { status: 404 }) : Response.json({ pending });
}

export const GET = withOfficeUser(GETImpl);
