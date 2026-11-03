import { withOfficeUser } from "@/src/server/route-scope";
import { currentUserId } from "@/src/server/user-scope";
import { createAccountStore } from "@/src/server/accounts";
import { PATHS } from "@/config";

const accounts = createAccountStore(PATHS.data);

async function GETImpl() {
  const account = await accounts.byId(currentUserId());
  return account ? Response.json({ preferences: { uiLanguage: account.uiLanguage, teachingLanguage: account.teachingLanguage, background: account.background ?? "" } })
    : Response.json({ error: "Account not found" }, { status: 404 });
}

async function PUTImpl(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid preferences" }, { status: 400 });
  const { uiLanguage, teachingLanguage, background } = body as Record<string, unknown>;
  if (uiLanguage !== "en" && uiLanguage !== "ja") return Response.json({ error: "Invalid UI language" }, { status: 400 });
  if (teachingLanguage !== "en" && teachingLanguage !== "ja") return Response.json({ error: "Invalid teaching language" }, { status: 400 });
  if (typeof background !== "string") return Response.json({ error: "Invalid background" }, { status: 400 });
  try {
    const account = await accounts.updatePreferences(currentUserId(), { uiLanguage, teachingLanguage, background });
    return Response.json({ preferences: { uiLanguage: account.uiLanguage, teachingLanguage: account.teachingLanguage, background: account.background ?? "" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid preferences" }, { status: 400 });
  }
}

export const GET = withOfficeUser(GETImpl);
export const PUT = withOfficeUser(PUTImpl);
