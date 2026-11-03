import { withOfficeUser } from "@/src/server/route-scope";
async function GETImpl() { return Response.json({ error: "Dictation is disabled" }, { status: 410 }); }

export const GET = withOfficeUser(GETImpl);
