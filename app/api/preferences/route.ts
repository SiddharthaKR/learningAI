import { withOfficeUser } from "@/src/server";
import { currentUserId } from "@/src/server";
import { createAccountStore } from "@/src/server";
import { PATHS } from "@/config";

const accounts = createAccountStore(PATHS.data);

async function GETImpl() {
  const account = await accounts.byId(currentUserId());
  return account ? Response.json({ preferences: { uiLanguage: account.uiLanguage, teachingLanguage: account.teachingLanguage, background: account.background ?? "", readPictures: account.readPictures ?? false } })
    : Response.json({ error: "Account not found" }, { status: 404 });
}

/** PATCH { readPictures: boolean } — remember the user's "read pictures" choice; other preferences untouched. */
async function PATCHImpl(request: Request) {
  const body = await request.json().catch(() => null) as { readPictures?: unknown } | null;
  if (!body || typeof body.readPictures !== "boolean") return Response.json({ error: "readPictures must be true or false" }, { status: 400 });
  try {
    const account = await accounts.updatePreferences(currentUserId(), { readPictures: body.readPictures });
    return Response.json({ preferences: { readPictures: account.readPictures ?? false } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid preferences" }, { status: 400 });
  }
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
export const PATCH = withOfficeUser(PATCHImpl);
