import { pendingApprovalsForChat } from "@/src/server";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pending = pendingApprovalsForChat({}, id);
  return pending === null ? Response.json({ error: "Not found" }, { status: 404 }) : Response.json({ pending });
}
