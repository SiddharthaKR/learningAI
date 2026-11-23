import { createAccountStore, isAdminUsername, withOfficeAdmin } from "@/src/server";
import { PATHS } from "@/config";

export const runtime = "nodejs";
export const DELETE = withOfficeAdmin(async (_request: Request, context: { params: Promise<{ username: string }> }) => {
  const username = decodeURIComponent((await context.params).username);
  const accounts = createAccountStore(PATHS.data);
  const target = await accounts.byUsername(username);
  if (!target) return Response.json({ error: "Account not found" }, { status: 404 });
  if (isAdminUsername(target.username)) return Response.json({ error: "Cannot delete an admin account" }, { status: 400 });
  await accounts.delete(username);
  return Response.json({ deleted: true });
});
