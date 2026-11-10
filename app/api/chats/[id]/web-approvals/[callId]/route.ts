import { withOfficeUser } from "@/src/server";
import { currentUserId } from "@/src/server";
﻿import { decideWebApproval } from "@/src/server";

async function POSTImpl(request: Request, { params }: { params: Promise<{ id: string; callId: string }> }) {
  const { id, callId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== "allow" && body.decision !== "deny") || (body.editedValue !== undefined && typeof body.editedValue !== "string")) {
    return Response.json({ error: "Expected decision allow|deny and optional editedValue string" }, { status: 400 });
  }
  try {
    const result = await decideWebApproval({ userId: currentUserId() }, id, callId, body.decision, body.editedValue);
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(result, { status: result.status === "expired" ? 409 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid web request" }, { status: 400 });
  }
}

export const POST = withOfficeUser(POSTImpl);
