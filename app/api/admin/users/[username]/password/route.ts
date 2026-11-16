import { createAccountStore, withOfficeAdmin } from "@/src/server";
import { PATHS } from "@/config";

export const runtime = "nodejs";
export const PUT = withOfficeAdmin(async (request: Request, context: { params: Promise<{ username: string }> }) => {
  const { username } = await context.params;
  let body: { password?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.password !== "string") return Response.json({ error: "Password is required" }, { status: 400 });
  const accounts = createAccountStore(PATHS.data);
  if (!(await accounts.byUsername(decodeURIComponent(username)))) return Response.json({ error: "Account not found" }, { status: 404 });
  try {
    await accounts.resetPassword(decodeURIComponent(username), body.password);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Reset failed" }, { status: 400 });
  }
});
